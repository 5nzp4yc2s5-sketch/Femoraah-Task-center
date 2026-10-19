-- OpsPulse Workspace: phase 4b, the credential manager.
--
-- Shared logins (site, link, username, password, notes) that the Super Admin or a Credentials admin
-- shares with chosen people or teams. Passwords and notes are encrypted in the app server with
-- AES-256-GCM before they reach the database; the key lives only in the app's server environment
-- (CREDENTIALS_ENCRYPTION_KEY), never here. Encrypted values sit in a table nobody can read
-- directly: only the functions below hand them out, after checking access and the person's PIN,
-- and every reveal, copy, change and share is recorded.
--
-- Safe for a live database: this migration only adds tables, functions and one trigger on members
-- (it revokes a person's credential access when they are deactivated or their role changes).
-- No existing function, policy or row changes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.credentials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  url text not null default '' check (length(url) <= 2000 and (url = '' or url ~ '^https?://[^[:space:]<>"''\\]+$')),
  username text not null default '' check (length(username) <= 200),
  category text not null default '' check (length(category) <= 60),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  password_changed_by uuid references public.members (id) on delete set null,
  password_changed_at timestamptz not null default now(),
  archived_by uuid references public.members (id) on delete set null,
  archived_at timestamptz
);

-- Encrypted values: "v1.<iv>.<ciphertext>.<tag>" in base64url, bound to the credential and field.
-- RLS on and no policy or grant at all, so only the security-definer functions below touch it.
create table if not exists public.credential_secrets (
  credential_id uuid primary key references public.credentials (id) on delete restrict,
  password_ct text not null check (length(password_ct) <= 4000 and password_ct ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'),
  notes_ct text check (notes_ct is null or (length(notes_ct) <= 8000 and notes_ct ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$')),
  key_id text not null check (key_id ~ '^[0-9a-f]{16}$'),
  updated_at timestamptz not null default now()
);

-- Who may use a credential: a person or a team ("use": see, show and copy it), or a person who
-- manages it ("manage": also change it and share it). Removing access keeps the row as history.
create table if not exists public.credential_access (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references public.credentials (id) on delete restrict,
  member_id uuid references public.members (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  level text not null check (level in ('use', 'manage')),
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.members (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (length(revoke_reason) <= 200),
  check (num_nonnulls(member_id, team_id) = 1),
  check (level = 'use' or member_id is not null)
);
create unique index if not exists credential_access_member_active on public.credential_access (credential_id, member_id)
  where revoked_at is null and member_id is not null;
create unique index if not exists credential_access_team_active on public.credential_access (credential_id, team_id)
  where revoked_at is null and team_id is not null;
create index if not exists credential_access_by_member on public.credential_access (member_id) where revoked_at is null;

-- Append-only history: created, updated, password or notes changed, shown, copied, refused, shared,
-- access removed, removed from use, restored.
create table if not exists public.credential_events (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references public.credentials (id) on delete restrict,
  actor_member_id uuid references public.members (id) on delete set null,
  action text not null,
  member_id uuid references public.members (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists credential_events_by_credential on public.credential_events (credential_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The signed-in person's access to a credential: 'admin' (Super Admin or Credentials admin),
-- 'manage', 'use', or null. Team access follows the team the person is in today.
create or replace function private.cred_level(p_cred uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when private.me() is null then null
    when private.has_area('credentials') then 'admin'
    when exists (select 1 from public.credential_access a
                  where a.credential_id = p_cred and a.revoked_at is null and a.member_id = private.me() and a.level = 'manage')
      then 'manage'
    when exists (select 1 from public.credential_access a
                  where a.credential_id = p_cred and a.revoked_at is null
                    and (a.member_id = private.me()
                         or (a.team_id is not null and a.team_id = private.team_for(private.me(), private.today()))))
      then 'use'
  end
$$;

create or replace function private.cred_event(p_cred uuid, p_action text, p_member uuid default null, p_team uuid default null,
                                              p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.credential_events (credential_id, actor_member_id, action, member_id, team_id, details)
  values (p_cred, private.me(), p_action, p_member, p_team, coalesce(p_details, '{}'::jsonb))
$$;

-- PIN re-check before a password is shown, copied or changed. Same lockout counter as sign-in
-- (5 wrong PINs lock the account until the Super Admin resets the PIN), without starting a session.
create or replace function private.check_pin(p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid := private.me();
  v_pin public.member_pins;
  c_max_attempts constant int := 5;
begin
  if v_member is null then return 'not_allowed'; end if;
  select * into v_pin from public.member_pins where member_id = v_member for update;
  if v_pin.member_id is null then return 'no_pin'; end if;
  if v_pin.locked_until is not null and v_pin.locked_until > now() then return 'locked'; end if;
  if p_pin is not null and p_pin ~ '^[0-9]{3}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    if v_pin.failed_attempts <> 0 then
      update public.member_pins set failed_attempts = 0 where member_id = v_member;
    end if;
    return 'ok';
  end if;
  if v_pin.failed_attempts + 1 >= c_max_attempts then
    update public.member_pins set failed_attempts = 0, locked_until = 'infinity' where member_id = v_member;
    perform private.audit('member', v_member, 'pin_locked', jsonb_build_object('during', 'credential'));
    return 'locked';
  end if;
  update public.member_pins set failed_attempts = failed_attempts + 1 where member_id = v_member;
  perform private.audit('member', v_member, 'pin_failed', jsonb_build_object('during', 'credential'));
  return 'wrong:' || (c_max_attempts - v_pin.failed_attempts - 1);
end $$;

create or replace function private.cred_check_fields(p_name text, p_url text, p_username text, p_category text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Give the login a name of up to 120 characters' using errcode = '22023';
  end if;
  if length(coalesce(p_url, '')) > 2000 or (btrim(coalesce(p_url, '')) <> '' and btrim(p_url) !~ '^https?://[^[:space:]<>"''\\]+$') then
    raise exception 'The website must be a full link starting with https:// or http://' using errcode = '22023';
  end if;
  if length(coalesce(p_username, '')) > 200 then raise exception 'Keep the username under 200 characters' using errcode = '22023'; end if;
  if length(coalesce(p_category, '')) > 60 then raise exception 'Keep the category under 60 characters' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------
-- p_id is chosen by the app server so the encrypted values can be bound to it.
create or replace function public.cred_create(p_id uuid, p_name text, p_url text, p_username text, p_category text,
                                              p_password_ct text, p_notes_ct text, p_key_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_area('credentials') then
    raise exception 'Only the Super Admin or a Credentials admin can add logins' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'Missing id' using errcode = '22023'; end if;
  perform private.cred_check_fields(p_name, p_url, p_username, p_category);
  insert into public.credentials (id, name, url, username, category, created_by, updated_by, password_changed_by)
  values (p_id, btrim(p_name), btrim(coalesce(p_url, '')), btrim(coalesce(p_username, '')), btrim(coalesce(p_category, '')),
          private.me(), private.me(), private.me());
  insert into public.credential_secrets (credential_id, password_ct, notes_ct, key_id) values (p_id, p_password_ct, p_notes_ct, p_key_id);
  perform private.cred_event(p_id, 'created', null, null, jsonb_build_object('name', btrim(p_name)));
  return p_id;
end $$;

create or replace function public.cred_update(p_id uuid, p_name text, p_url text, p_username text, p_category text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old public.credentials;
  v_level text := private.cred_level(p_id);
begin
  select * into v_old from public.credentials where id = p_id for update;
  if v_old.id is null or v_level is null or (v_old.archived_at is not null and v_level <> 'admin') then
    raise exception 'Login not found' using errcode = 'P0002';
  end if;
  if v_level not in ('admin', 'manage') then
    raise exception 'Only an access manager or a Credentials admin can change this login' using errcode = '42501';
  end if;
  if v_old.archived_at is not null then raise exception 'Restore the login before changing it' using errcode = '22023'; end if;
  perform private.cred_check_fields(p_name, p_url, p_username, p_category);
  update public.credentials
     set name = btrim(p_name), url = btrim(coalesce(p_url, '')), username = btrim(coalesce(p_username, '')),
         category = btrim(coalesce(p_category, '')), updated_by = private.me(), updated_at = now()
   where id = p_id;
  perform private.cred_event(p_id, 'updated', null, null, jsonb_build_object(
    'before', jsonb_build_object('name', v_old.name, 'url', v_old.url, 'username', v_old.username, 'category', v_old.category),
    'after', jsonb_build_object('name', btrim(p_name), 'url', btrim(coalesce(p_url, '')), 'username', btrim(coalesce(p_username, '')),
                                'category', btrim(coalesce(p_category, '')))));
end $$;

-- Hands the encrypted password (and, to view, the notes) to the app server after checking access
-- and the PIN. Returns {ok:false, error} instead of raising, so a wrong PIN still counts.
create or replace function public.cred_reveal(p_id uuid, p_pin text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cred public.credentials;
  v_secret public.credential_secrets;
  v_level text := private.cred_level(p_id);
  v_pin text;
begin
  if p_purpose not in ('view', 'copy') then raise exception 'Unknown purpose' using errcode = '22023'; end if;
  select * into v_cred from public.credentials where id = p_id;
  if v_cred.id is null or v_level is null or (v_cred.archived_at is not null and v_level <> 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_pin := private.check_pin(p_pin);
  if v_pin <> 'ok' then
    perform private.cred_event(p_id, 'refused', null, null, jsonb_build_object('purpose', p_purpose, 'reason', split_part(v_pin, ':', 1)));
    return jsonb_build_object('ok', false, 'error', split_part(v_pin, ':', 1), 'remaining', nullif(split_part(v_pin, ':', 2), '')::int);
  end if;
  select * into v_secret from public.credential_secrets where credential_id = p_id;
  perform private.cred_event(p_id, case p_purpose when 'view' then 'shown' else 'copied' end);
  return jsonb_build_object('ok', true, 'password_ct', v_secret.password_ct, 'key_id', v_secret.key_id,
                            'notes_ct', case when p_purpose = 'view' then v_secret.notes_ct end);
end $$;

-- Change the password or the notes (an access manager or a Credentials admin, with their PIN).
create or replace function public.cred_set_secret(p_id uuid, p_pin text, p_field text, p_ct text, p_key_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cred public.credentials;
  v_secret public.credential_secrets;
  v_level text := private.cred_level(p_id);
  v_pin text;
begin
  if p_field not in ('password', 'notes') then raise exception 'Unknown field' using errcode = '22023'; end if;
  select * into v_cred from public.credentials where id = p_id for update;
  if v_cred.id is null or v_level is null or (v_cred.archived_at is not null and v_level <> 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_level not in ('admin', 'manage') then
    raise exception 'Only an access manager or a Credentials admin can change this login' using errcode = '42501';
  end if;
  if v_cred.archived_at is not null then raise exception 'Restore the login before changing it' using errcode = '22023'; end if;
  select * into v_secret from public.credential_secrets where credential_id = p_id for update;
  if v_secret.key_id <> p_key_id then
    raise exception 'This login was saved with a different encryption key' using errcode = '22023';
  end if;
  v_pin := private.check_pin(p_pin);
  if v_pin <> 'ok' then
    perform private.cred_event(p_id, 'refused', null, null, jsonb_build_object('purpose', 'change_' || p_field, 'reason', split_part(v_pin, ':', 1)));
    return jsonb_build_object('ok', false, 'error', split_part(v_pin, ':', 1), 'remaining', nullif(split_part(v_pin, ':', 2), '')::int);
  end if;
  if p_field = 'password' then
    update public.credential_secrets set password_ct = p_ct, updated_at = now() where credential_id = p_id;
    update public.credentials set password_changed_by = private.me(), password_changed_at = now(), updated_by = private.me(), updated_at = now()
     where id = p_id;
  else
    update public.credential_secrets set notes_ct = p_ct, updated_at = now() where credential_id = p_id;
    update public.credentials set updated_by = private.me(), updated_at = now() where id = p_id;
  end if;
  perform private.cred_event(p_id, case p_field when 'password' then 'password_changed' else 'notes_changed' end);
  return jsonb_build_object('ok', true);
end $$;

-- Give a person or a team access. A Credentials admin can make someone an access manager; an
-- access manager can share "use" access. Changing a level closes the old row and opens a new one.
create or replace function public.cred_share(p_id uuid, p_member uuid, p_team uuid, p_level text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_cred public.credentials;
  v_level text := private.cred_level(p_id);
  v_old public.credential_access;
begin
  select * into v_cred from public.credentials where id = p_id for update;
  if v_cred.id is null or v_level is null or v_cred.archived_at is not null then raise exception 'Login not found' using errcode = 'P0002'; end if;
  if v_level not in ('admin', 'manage') then
    raise exception 'Only an access manager or a Credentials admin can share this login' using errcode = '42501';
  end if;
  if num_nonnulls(p_member, p_team) <> 1 then raise exception 'Choose one person or one team' using errcode = '22023'; end if;
  if p_level not in ('use', 'manage') then raise exception 'Unknown access level' using errcode = '22023'; end if;
  if p_level = 'manage' and p_team is not null then raise exception 'Only a person can be an access manager' using errcode = '22023'; end if;
  if p_level = 'manage' and v_level <> 'admin' then
    raise exception 'Only a Credentials admin can make someone an access manager' using errcode = '42501';
  end if;
  if p_member is not null and not exists (select 1 from public.members m where m.id = p_member and m.is_active) then
    raise exception 'Choose an active team member' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from public.teams t where t.id = p_team and t.is_active) then
    raise exception 'Choose an active team' using errcode = '22023';
  end if;
  select * into v_old from public.credential_access a
   where a.credential_id = p_id and a.revoked_at is null
     and ((p_member is not null and a.member_id = p_member) or (p_team is not null and a.team_id = p_team))
   for update;
  if v_old.id is not null then
    if v_old.level = p_level then return; end if;
    if v_old.level = 'manage' and v_level <> 'admin' then
      raise exception 'Only a Credentials admin can change an access manager' using errcode = '42501';
    end if;
    update public.credential_access set revoked_at = now(), revoked_by = private.me(), revoke_reason = 'level changed' where id = v_old.id;
  end if;
  insert into public.credential_access (credential_id, member_id, team_id, level, granted_by)
  values (p_id, p_member, p_team, p_level, private.me());
  perform private.cred_event(p_id, 'shared', p_member, p_team, jsonb_build_object('level', p_level));
end $$;

create or replace function public.cred_unshare(p_access uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.credential_access;
  v_level text;
begin
  select * into v_row from public.credential_access where id = p_access for update;
  if v_row.id is null then raise exception 'Access not found' using errcode = 'P0002'; end if;
  v_level := private.cred_level(v_row.credential_id);
  if v_level is null or v_level not in ('admin', 'manage') then
    raise exception 'Only an access manager or a Credentials admin can remove access' using errcode = '42501';
  end if;
  if v_row.level = 'manage' and v_level <> 'admin' then
    raise exception 'Only a Credentials admin can remove an access manager' using errcode = '42501';
  end if;
  if v_row.revoked_at is not null then return; end if;
  update public.credential_access set revoked_at = now(), revoked_by = private.me(), revoke_reason = 'removed' where id = p_access;
  perform private.cred_event(v_row.credential_id, 'unshared', v_row.member_id, v_row.team_id, jsonb_build_object('level', v_row.level));
end $$;

-- Taking a login out of use hides it from everyone but Credentials admins. Nothing is deleted.
create or replace function public.cred_set_archived(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cred public.credentials;
begin
  if not private.has_area('credentials') then
    raise exception 'Only the Super Admin or a Credentials admin can remove or restore logins' using errcode = '42501';
  end if;
  select * into v_cred from public.credentials where id = p_id for update;
  if v_cred.id is null then raise exception 'Login not found' using errcode = 'P0002'; end if;
  if coalesce(p_archived, true) then
    update public.credentials set archived_at = coalesce(archived_at, now()), archived_by = coalesce(archived_by, private.me()) where id = p_id;
  else
    update public.credentials set archived_at = null, archived_by = null, updated_by = private.me(), updated_at = now() where id = p_id;
  end if;
  perform private.cred_event(p_id, case when coalesce(p_archived, true) then 'archived' else 'restored' end);
end $$;

-- A person who is deactivated or whose role changes loses every credential they were given
-- directly (kept as history with the reason). Team access follows their team automatically.
create or replace function private.members_credential_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  r record;
begin
  if old.is_active and not new.is_active then v_reason := 'deactivated';
  elsif new.access_role is distinct from old.access_role then v_reason := 'role changed';
  else return null;
  end if;
  for r in
    update public.credential_access set revoked_at = now(), revoked_by = private.me(), revoke_reason = v_reason
     where member_id = new.id and revoked_at is null
    returning credential_id, level
  loop
    perform private.cred_event(r.credential_id, 'access_removed', new.id, null, jsonb_build_object('level', r.level, 'reason', v_reason));
  end loop;
  return null;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'members_credential_cleanup' and tgrelid = 'public.members'::regclass) then
    create trigger members_credential_cleanup after update of access_role, is_active on public.members
      for each row execute function private.members_credential_cleanup();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.credentials enable row level security;
alter table public.credential_secrets enable row level security;
alter table public.credential_access enable row level security;
alter table public.credential_events enable row level security;
revoke all on public.credentials, public.credential_secrets, public.credential_access, public.credential_events from anon, authenticated;
grant select on public.credentials, public.credential_access, public.credential_events to authenticated;

create policy credentials_read on public.credentials for select to authenticated
  using (private.cred_level(id) = 'admin' or (archived_at is null and private.cred_level(id) is not null));
create policy credential_access_read on public.credential_access for select to authenticated
  using (private.has_area('credentials') or member_id = private.me() or private.cred_level(credential_id) = 'manage');
create policy credential_events_read on public.credential_events for select to authenticated
  using (private.has_area('credentials') or private.cred_level(credential_id) = 'manage');

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function
  public.cred_create(uuid, text, text, text, text, text, text, text),
  public.cred_update(uuid, text, text, text, text),
  public.cred_reveal(uuid, text, text),
  public.cred_set_secret(uuid, text, text, text, text),
  public.cred_share(uuid, uuid, uuid, text),
  public.cred_unshare(uuid),
  public.cred_set_archived(uuid, boolean)
from public, anon;
grant execute on function
  public.cred_create(uuid, text, text, text, text, text, text, text),
  public.cred_update(uuid, text, text, text, text),
  public.cred_reveal(uuid, text, text),
  public.cred_set_secret(uuid, text, text, text, text),
  public.cred_share(uuid, uuid, uuid, text),
  public.cred_unshare(uuid),
  public.cred_set_archived(uuid, boolean)
to authenticated;
