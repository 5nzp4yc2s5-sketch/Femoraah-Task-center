-- PIN-only sign-in: username + 3-digit PIN, no password.
-- Supabase Auth still issues the session (the server mints it with a one-time magic-link token after the
-- PIN checks out), so RLS, verified_sessions and deactivation work exactly as before.
-- Because the PIN is now the only secret, five wrong PINs lock the account until an admin resets the PIN.

-- Sign-in check, called by the server with the service role before any session exists.
create or replace function public.service_pin_login(p_identifier text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid;
  v_email text;
  v_pin public.member_pins;
  c_max_attempts constant int := 5;
begin
  select m.id, u.email::text into v_member, v_email
  from public.members m join auth.users u on u.id = m.user_id
  where m.is_active and (m.username = lower(p_identifier) or lower(u.email) = lower(p_identifier))
  limit 1;
  if v_member is not null then
    select * into v_pin from public.member_pins where member_id = v_member for update;
  end if;
  if v_pin.member_id is null then
    -- Same bcrypt cost as a real check, so an unknown username can't be told apart by timing.
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if p_pin ~ '^[0-9]{3}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    update public.member_pins set failed_attempts = 0, locked_until = null where member_id = v_member;
    return jsonb_build_object('ok', true, 'email', v_email);
  end if;

  if v_pin.failed_attempts + 1 >= c_max_attempts then
    update public.member_pins set failed_attempts = 0, locked_until = 'infinity' where member_id = v_member;
    insert into public.audit_events (entity, entity_id, action) values ('member', v_member, 'pin_locked');
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  update public.member_pins set failed_attempts = failed_attempts + 1 where member_id = v_member;
  insert into public.audit_events (entity, entity_id, action) values ('member', v_member, 'pin_failed');
  return jsonb_build_object('ok', false, 'error', 'invalid');
end $$;

-- The 12-hour PIN re-check now uses the same lock: five wrong PINs lock until an admin resets the PIN.
create or replace function public.verify_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := private.member_for_user();
  v_session uuid := private.jwt_session_id();
  v_pin public.member_pins;
  c_max_attempts constant int := 5;
  c_session_ttl constant interval := interval '12 hours';
begin
  if auth.uid() is null or v_session is null or v_member is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  select * into v_pin from public.member_pins where member_id = v_member for update;
  if v_pin.member_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if p_pin is not null and p_pin ~ '^[0-9]{3}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    update public.member_pins set failed_attempts = 0, locked_until = null where member_id = v_member;
    insert into public.verified_sessions (session_id, user_id, member_id, verified_at, expires_at)
    values (v_session, auth.uid(), v_member, now(), now() + c_session_ttl)
    on conflict (session_id) do update set verified_at = now(), expires_at = excluded.expires_at
      where public.verified_sessions.user_id = auth.uid();
    perform private.audit('member', v_member, 'pin_verified', '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;

  if v_pin.failed_attempts + 1 >= c_max_attempts then
    update public.member_pins set failed_attempts = 0, locked_until = 'infinity' where member_id = v_member;
    perform private.audit('member', v_member, 'pin_locked', '{}'::jsonb);
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  update public.member_pins set failed_attempts = failed_attempts + 1 where member_id = v_member;
  perform private.audit('member', v_member, 'pin_failed', '{}'::jsonb);
  return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'remaining', c_max_attempts - v_pin.failed_attempts - 1);
end $$;

-- Lets the admin see on the Team page that someone is locked out (reset PIN clears it).
create or replace function public.admin_pin_locked(p_member uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return exists (select 1 from public.member_pins where member_id = p_member and locked_until > now());
end $$;

revoke execute on function public.service_pin_login(text, text), public.admin_pin_locked(uuid) from public, anon, authenticated;
grant execute on function public.service_pin_login(text, text) to service_role;
grant execute on function public.admin_pin_locked(uuid) to authenticated;
