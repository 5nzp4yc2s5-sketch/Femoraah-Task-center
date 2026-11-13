-- OpsPulse Workspace: Cash Flow, bank emails read better (13-Nov-2026).
--
-- 1. A bank account can also carry the last 4 digits of its debit card. HDFC's debit card alerts name
--    only the card, so with this set they land in the right account instead of waiting to be sorted.
-- 2. "Read again": when the reader improves, emails already read can be read again. Alerts that were
--    not used yet are worked out afresh; transactions still waiting to be checked get the reference
--    number and payee filled in. Nothing that a person confirmed, chose or set aside is changed.
--
-- Safe for a live database: adds one column (empty by default) and functions, and replaces
-- fin_gmail_record with the same inputs and outputs. No row is removed.

alter table public.fin_accounts add column if not exists card_last4 text not null default ''
  check (card_last4 ~ '^([0-9]{4})?$');

-- Alerts now match an account by its own last 4 digits or its debit card's.
create or replace function public.fin_gmail_record(p_connection uuid, p_actor uuid, p_alerts jsonb, p_seen_until timestamptz,
                                                   p_ok boolean, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.fin_gmail_connections;
  r record;
  v_id uuid;
  v_acc uuid;
  v_matches integer;
  v_status text;
  v_last4 text;
  v_counts jsonb := '{"new": 0, "recorded": 0, "balance_only": 0, "duplicate": 0, "no_account": 0, "unreadable": 0}'::jsonb;
begin
  select * into c from public.fin_gmail_connections where id = p_connection and disconnected_at is null for update;
  if c.id is null then raise exception 'Mailbox connection not found' using errcode = 'P0002'; end if;
  if p_actor is not null and not exists (select 1 from public.members m where m.id = p_actor and m.is_active) then
    raise exception 'Unknown team member' using errcode = '22023';
  end if;

  for r in
    select * from jsonb_to_recordset(case when jsonb_typeof(p_alerts) = 'array' then p_alerts else '[]'::jsonb end)
      as x(message_id text, received_at timestamptz, sender text, subject text, readable boolean, direction text, amount_paise bigint,
           last4 text, reference_no text, counterparty text, balance_paise bigint, note text)
  loop
    continue when r.message_id is null or r.message_id !~ '^[0-9A-Za-z_-]{6,64}$' or r.received_at is null;
    v_last4 := case when coalesce(r.last4, '') ~ '^[0-9]{4}$' then r.last4 else '' end;
    v_status := case
      when coalesce(r.readable, false) and ((r.direction in ('in', 'out') and r.amount_paise > 0) or r.balance_paise is not null) then 'no_account'
      else 'unreadable' end;
    v_id := null;
    insert into public.fin_gmail_alerts (connection_id, message_id, received_at, sender, subject, status, direction, amount_paise, last4,
                                         reference_no, counterparty, balance_paise, note)
    values (p_connection, r.message_id, r.received_at, left(coalesce(r.sender, ''), 254), left(btrim(coalesce(r.subject, '')), 200), v_status,
            case when v_status = 'no_account' and r.direction in ('in', 'out') and r.amount_paise > 0 then r.direction end,
            case when v_status = 'no_account' and r.direction in ('in', 'out') and r.amount_paise > 0 then r.amount_paise end,
            v_last4, left(btrim(coalesce(r.reference_no, '')), 80), left(btrim(coalesce(r.counterparty, '')), 120),
            case when v_status = 'no_account' then r.balance_paise end,
            case when v_status = 'unreadable'
                 then coalesce(nullif(left(btrim(coalesce(r.note, '')), 300), ''), 'The app could not read the amount from this email') else '' end)
    on conflict (message_id) do nothing
    returning id into v_id;
    continue when v_id is null;
    v_counts := jsonb_set(v_counts, '{new}', to_jsonb((v_counts->>'new')::integer + 1));

    if v_status = 'no_account' then
      v_acc := null;
      v_matches := 0;
      if v_last4 <> '' then
        select count(*), min(x.id::text)::uuid into v_matches, v_acc
          from public.fin_accounts x where x.archived_at is null and (x.last4 = v_last4 or x.card_last4 = v_last4);
      end if;
      if v_matches = 1 then
        v_status := private.fin_gmail_apply(v_id, v_acc, p_actor);
      else
        update public.fin_gmail_alerts
           set note = case
             when v_last4 = '' then 'The email does not say which account. Choose one'
             when v_matches = 0 then 'No bank account or debit card in use ends in ' || v_last4 || '. Choose the account it belongs to'
             else 'More than one bank account or card ends in ' || v_last4 || '. Choose one' end
         where id = v_id;
      end if;
    end if;
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb((v_counts->>v_status)::integer + 1));
  end loop;

  update public.fin_gmail_connections
     set last_sync_at = now(), last_sync_ok = coalesce(p_ok, false), last_sync_message = left(coalesce(p_message, ''), 300),
         seen_until = greatest(seen_until, p_seen_until)
   where id = p_connection;
  if (v_counts->>'new')::integer > 0 or not coalesce(p_ok, false) then
    insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
    values ('gmail', p_connection, 'checked', p_actor, v_counts || jsonb_build_object('ok', coalesce(p_ok, false), 'message', left(coalesce(p_message, ''), 300)));
  end if;
  return v_counts;
end $$;


-- Links a debit card to an account (or unlinks it with an empty value), then records every alert
-- still waiting to be sorted that names that card. Returns how many alerts were recorded.
create or replace function public.fin_account_link_card(p_account uuid, p_last4 text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_last4 text := btrim(coalesce(p_last4, ''));
  v_before text;
  v_alert uuid;
  v_n integer := 0;
begin
  if v_last4 !~ '^([0-9]{4})?$' then raise exception 'Enter only the last 4 digits of the card' using errcode = '22023'; end if;
  select card_last4 into v_before from public.fin_accounts where id = p_account and archived_at is null for update;
  if not found then raise exception 'Bank account not found' using errcode = 'P0002'; end if;
  if v_last4 <> '' and exists (select 1 from public.fin_accounts x where x.id <> p_account and x.archived_at is null
                                  and (x.last4 = v_last4 or x.card_last4 = v_last4)) then
    raise exception 'Another bank account already ends in %', v_last4 using errcode = '23505';
  end if;
  update public.fin_accounts set card_last4 = v_last4, updated_by = v_me, updated_at = now() where id = p_account;
  perform private.fin_event('account', p_account, 'card_linked', jsonb_build_object('before', v_before, 'after', v_last4));
  if v_last4 <> '' then
    for v_alert in
      select a.id from public.fin_gmail_alerts a where a.status = 'no_account' and a.last4 = v_last4 order by a.received_at
    loop
      perform private.fin_gmail_apply(v_alert, p_account, v_me);
      update public.fin_gmail_alerts set handled_by = v_me, handled_at = now() where id = v_alert;
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;
end $$;

-- Takes what the server read again from emails already on file (same list as fin_gmail_record).
-- Used only by the app server (service role).
create or replace function public.fin_gmail_reread(p_connection uuid, p_actor uuid, p_alerts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.fin_gmail_connections;
  a public.fin_gmail_alerts;
  r record;
  v_status text;
  v_last4 text;
  v_ref text;
  v_who text;
  v_acc uuid;
  v_matches integer;
  v_counts jsonb := '{"read": 0, "filled_in": 0, "recorded": 0, "balance_only": 0, "duplicate": 0, "no_account": 0, "unreadable": 0, "unchanged": 0}'::jsonb;
begin
  select * into c from public.fin_gmail_connections where id = p_connection and disconnected_at is null;
  if c.id is null then raise exception 'Mailbox connection not found' using errcode = 'P0002'; end if;
  if p_actor is not null and not exists (select 1 from public.members m where m.id = p_actor and m.is_active) then
    raise exception 'Unknown team member' using errcode = '22023';
  end if;

  for r in
    select * from jsonb_to_recordset(case when jsonb_typeof(p_alerts) = 'array' then p_alerts else '[]'::jsonb end)
      as x(message_id text, received_at timestamptz, sender text, subject text, readable boolean, direction text, amount_paise bigint,
           last4 text, reference_no text, counterparty text, balance_paise bigint, note text)
  loop
    select * into a from public.fin_gmail_alerts where message_id = r.message_id and connection_id = p_connection for update;
    continue when a.id is null;
    v_counts := jsonb_set(v_counts, '{read}', to_jsonb((v_counts->>'read')::integer + 1));
    v_last4 := case when coalesce(r.last4, '') ~ '^[0-9]{4}$' then r.last4 else '' end;
    v_ref := left(btrim(coalesce(r.reference_no, '')), 80);
    v_who := left(btrim(coalesce(r.counterparty, '')), 120);

    if a.status in ('recorded', 'balance_only', 'duplicate') then
      -- Already in an account: only fill in what was missing, and only on a transaction still waiting
      -- to be checked whose amount and direction the email confirms.
      update public.fin_transactions t
         set reference_no = case when t.reference_no = '' and v_ref <> ''
                                  and not exists (select 1 from public.fin_transactions o where o.account_id = t.account_id and o.id <> t.id
                                                    and lower(o.reference_no) = lower(v_ref) and o.voided_at is null)
                                 then v_ref else t.reference_no end,
             counterparty = case when t.counterparty = '' then v_who else t.counterparty end,
             updated_at = now()
       where t.id = a.transaction_id and t.review_status = 'needs_review' and t.voided_at is null
         and t.amount_paise = r.amount_paise and t.direction = r.direction
         and ((t.reference_no = '' and v_ref <> '') or (t.counterparty = '' and v_who <> ''));
      if found then
        v_counts := jsonb_set(v_counts, '{filled_in}', to_jsonb((v_counts->>'filled_in')::integer + 1));
        update public.fin_gmail_alerts
           set reference_no = case when reference_no = '' then v_ref else reference_no end,
               counterparty = case when counterparty = '' then v_who else counterparty end
         where id = a.id;
      else
        v_counts := jsonb_set(v_counts, '{unchanged}', to_jsonb((v_counts->>'unchanged')::integer + 1));
      end if;
      continue;
    end if;

    -- Set aside, or already handled by a person: leave it.
    if a.status not in ('no_account', 'unreadable') or a.handled_at is not null then
      v_counts := jsonb_set(v_counts, '{unchanged}', to_jsonb((v_counts->>'unchanged')::integer + 1));
      continue;
    end if;

    -- Not used yet: work it out afresh, exactly as a first read would.
    v_status := case
      when coalesce(r.readable, false) and ((r.direction in ('in', 'out') and r.amount_paise > 0) or r.balance_paise is not null) then 'no_account'
      else 'unreadable' end;
    update public.fin_gmail_alerts
       set status = v_status,
           direction = case when v_status = 'no_account' and r.direction in ('in', 'out') and r.amount_paise > 0 then r.direction end,
           amount_paise = case when v_status = 'no_account' and r.direction in ('in', 'out') and r.amount_paise > 0 then r.amount_paise end,
           last4 = v_last4, reference_no = v_ref, counterparty = v_who,
           balance_paise = case when v_status = 'no_account' then r.balance_paise end,
           note = case when v_status = 'unreadable'
                       then coalesce(nullif(left(btrim(coalesce(r.note, '')), 300), ''), 'The app could not read the amount from this email') else '' end
     where id = a.id;

    if v_status = 'no_account' then
      v_acc := null;
      v_matches := 0;
      if v_last4 <> '' then
        select count(*), min(x.id::text)::uuid into v_matches, v_acc
          from public.fin_accounts x where x.archived_at is null and (x.last4 = v_last4 or x.card_last4 = v_last4);
      end if;
      if v_matches = 1 then
        v_status := private.fin_gmail_apply(a.id, v_acc, p_actor);
      else
        update public.fin_gmail_alerts
           set note = case
             when v_last4 = '' then 'The email does not say which account. Choose one'
             when v_matches = 0 then 'No bank account or debit card in use ends in ' || v_last4 || '. Choose the account it belongs to'
             else 'More than one bank account or card ends in ' || v_last4 || '. Choose one' end
         where id = a.id;
      end if;
    end if;
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb((v_counts->>v_status)::integer + 1));
  end loop;

  insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
  values ('gmail', p_connection, 'read_again', p_actor, v_counts);
  return v_counts;
end $$;

revoke execute on function public.fin_account_link_card(uuid, text), public.fin_gmail_reread(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fin_account_link_card(uuid, text) to authenticated;
grant execute on function public.fin_gmail_reread(uuid, uuid, jsonb) to service_role;
