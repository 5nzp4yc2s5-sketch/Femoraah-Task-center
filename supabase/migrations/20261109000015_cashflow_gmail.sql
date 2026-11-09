-- OpsPulse Workspace: Cash Flow phase 2, bank alerts from Gmail (9-Nov-2026).
--
-- The Super Admin connects a Gmail mailbox with Google's read-only permission. The app server then
-- reads only the emails sent by the bank alert addresses listed on the connection, picks out the
-- amount, money in or out, the account's last 4 digits, the reference number and the available
-- balance, and records them here. Email bodies are never stored.
--
-- Google's refresh token is kept in Supabase Vault (encrypted, with its key held outside the
-- database). Only the server's service role can read it back; nobody signed in to the app can.
--
-- Each alert becomes a bank transaction marked "needs checking" until a person confirms it, and an
-- alert that states the available balance also becomes a balance reading. A reference number already
-- recorded on that account is not recorded again, and each email is read once.
--
-- Safe for a live database: this migration only adds two tables and functions. No existing table,
-- function, policy or row changes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.fin_gmail_connections (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and length(email) <= 254),
  senders text[] not null default array['alerts@hdfcbank.net', 'alerts@hdfcbank.bank.in']
    check (cardinality(senders) between 1 and 20),
  import_from date not null,
  token_secret_id uuid,
  connected_by uuid references public.members (id),
  connected_at timestamptz not null default now(),
  disconnected_by uuid references public.members (id),
  disconnected_at timestamptz,
  last_sync_at timestamptz,
  last_sync_ok boolean,
  last_sync_message text not null default '' check (length(last_sync_message) <= 300),
  seen_until timestamptz
);
create unique index if not exists fin_gmail_connections_active on public.fin_gmail_connections (lower(email)) where disconnected_at is null;

-- One row per bank alert email that was read. Only the facts picked out of it are kept.
create table if not exists public.fin_gmail_alerts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.fin_gmail_connections (id),
  message_id text not null check (message_id ~ '^[0-9A-Za-z_-]{6,64}$'),
  received_at timestamptz not null,
  sender text not null default '' check (length(sender) <= 254),
  subject text not null default '' check (length(subject) <= 200),
  status text not null check (status in ('recorded', 'balance_only', 'duplicate', 'no_account', 'unreadable', 'ignored')),
  direction text check (direction in ('in', 'out')),
  amount_paise bigint check (amount_paise > 0),
  last4 text not null default '' check (last4 ~ '^([0-9]{4})?$'),
  reference_no text not null default '' check (length(reference_no) <= 80),
  counterparty text not null default '' check (length(counterparty) <= 120),
  balance_paise bigint,
  account_id uuid references public.fin_accounts (id),
  transaction_id uuid references public.fin_transactions (id),
  balance_id uuid references public.fin_balances (id),
  note text not null default '' check (length(note) <= 300),
  handled_by uuid references public.members (id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists fin_gmail_alerts_message on public.fin_gmail_alerts (message_id);
create index if not exists fin_gmail_alerts_recent on public.fin_gmail_alerts (received_at desc);
create index if not exists fin_gmail_alerts_open on public.fin_gmail_alerts (status) where status in ('no_account', 'unreadable');

-- ---------------------------------------------------------------------------
-- Recording an alert against a bank account
-- ---------------------------------------------------------------------------
-- The transaction is timed at the moment the email arrived, and so is the balance reading. A
-- transaction counts towards the balance only after its reading's moment, so one alert carrying both
-- is never counted twice.
create or replace function private.fin_gmail_apply(p_alert uuid, p_account uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  a public.fin_gmail_alerts;
  v_txn uuid;
  v_bal uuid;
  v_status text;
begin
  select * into a from public.fin_gmail_alerts where id = p_alert for update;
  if a.id is null then raise exception 'Bank alert not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.fin_accounts x where x.id = p_account and x.archived_at is null) then
    raise exception 'Choose a bank account that is in use' using errcode = '22023';
  end if;

  if a.direction is not null and a.amount_paise is not null then
    if a.reference_no <> '' and exists (select 1 from public.fin_transactions t where t.account_id = p_account
                                           and lower(t.reference_no) = lower(a.reference_no) and t.voided_at is null) then
      v_status := 'duplicate';
    else
      insert into public.fin_transactions (account_id, txn_at, direction, amount_paise, category, counterparty, description, reference_no,
                                           source, review_status, created_by, updated_by)
      values (p_account, a.received_at, a.direction, a.amount_paise,
              case when a.direction = 'in' then 'other_income' else 'other_expense' end,
              left(a.counterparty, 120), left(btrim('Bank alert: ' || a.subject), 500), a.reference_no, 'gmail', 'needs_review', p_actor, p_actor)
      returning id into v_txn;
      insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
      values ('transaction', v_txn, 'created', p_actor,
              jsonb_build_object('amount', a.amount_paise, 'direction', a.direction, 'source', 'gmail', 'alert', a.id));
      v_status := 'recorded';
    end if;
  else
    v_status := 'balance_only';
  end if;

  if a.balance_paise is not null and v_status <> 'duplicate' then
    insert into public.fin_balances (account_id, as_of, balance_paise, source, note, created_by)
    values (p_account, a.received_at, a.balance_paise, 'gmail', 'From a bank alert email', p_actor)
    returning id into v_bal;
    insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
    values ('account', p_account, 'balance_recorded', p_actor,
            jsonb_build_object('balance', a.balance_paise, 'as_of', a.received_at, 'source', 'gmail', 'alert', a.id));
  end if;

  update public.fin_gmail_alerts
     set status = v_status, account_id = p_account, transaction_id = v_txn, balance_id = v_bal,
         note = case when v_status = 'duplicate' then 'Already recorded on this account with the same reference number' else '' end
   where id = p_alert;
  return v_status;
end $$;

-- ---------------------------------------------------------------------------
-- Connecting and disconnecting a mailbox (Super Admin only)
-- ---------------------------------------------------------------------------
create or replace function public.fin_gmail_connect(p_email text, p_refresh_token text, p_import_from date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.fin_gmail_connections;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_secret uuid;
begin
  if not private.is_admin() then raise exception 'Only the Super Admin can connect a mailbox' using errcode = '42501'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'Google did not return a valid email address' using errcode = '22023'; end if;
  if length(coalesce(p_refresh_token, '')) < 20 then raise exception 'Google did not return a lasting permission. Try connecting again' using errcode = '22023'; end if;
  if p_import_from is null or p_import_from > private.today() or p_import_from < private.today() - 90 then
    raise exception 'Choose a start date within the last 90 days' using errcode = '22023';
  end if;

  select * into c from public.fin_gmail_connections where lower(email) = v_email and disconnected_at is null for update;
  if c.id is not null then
    perform vault.update_secret(c.token_secret_id, p_refresh_token);
    update public.fin_gmail_connections
       set connected_by = private.me(), connected_at = now(), last_sync_ok = null, last_sync_message = ''
     where id = c.id;
    perform private.fin_event('gmail', c.id, 'reconnected', jsonb_build_object('email', v_email));
    return c.id;
  end if;

  v_id := gen_random_uuid();
  v_secret := vault.create_secret(p_refresh_token, 'opspulse-gmail-' || v_id::text, 'OpsPulse Cash Flow: Gmail read-only permission for ' || v_email);
  insert into public.fin_gmail_connections (id, email, import_from, token_secret_id, connected_by)
  values (v_id, v_email, p_import_from, v_secret, private.me());
  perform private.fin_event('gmail', v_id, 'connected', jsonb_build_object('email', v_email, 'import_from', p_import_from));
  return v_id;
end $$;

-- The stored permission is overwritten (not kept) and the mailbox is no longer read.
create or replace function public.fin_gmail_disconnect(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.fin_gmail_connections;
begin
  if not private.is_admin() then raise exception 'Only the Super Admin can disconnect a mailbox' using errcode = '42501'; end if;
  select * into c from public.fin_gmail_connections where id = p_id and disconnected_at is null for update;
  if c.id is null then raise exception 'Mailbox connection not found' using errcode = 'P0002'; end if;
  if c.token_secret_id is not null then perform vault.update_secret(c.token_secret_id, 'disconnected'); end if;
  update public.fin_gmail_connections set disconnected_at = now(), disconnected_by = private.me() where id = p_id;
  perform private.fin_event('gmail', p_id, 'disconnected', jsonb_build_object('email', c.email));
end $$;

create or replace function public.fin_gmail_set_senders(p_id uuid, p_senders text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_list text[];
  c public.fin_gmail_connections;
begin
  if not private.is_admin() then raise exception 'Only the Super Admin can change which emails are read' using errcode = '42501'; end if;
  select array_agg(distinct s order by s) into v_list
    from (select lower(btrim(x)) as s from unnest(coalesce(p_senders, '{}'::text[])) x) y where s <> '';
  if coalesce(cardinality(v_list), 0) = 0 then raise exception 'Enter at least one sender address' using errcode = '22023'; end if;
  if cardinality(v_list) > 20 then raise exception 'Enter at most 20 sender addresses' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_list) s where s !~ '^([^@[:space:]"()]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$' or length(s) > 254) then
    raise exception 'Enter sender addresses like alerts@hdfcbank.net' using errcode = '22023';
  end if;
  select * into c from public.fin_gmail_connections where id = p_id and disconnected_at is null for update;
  if c.id is null then raise exception 'Mailbox connection not found' using errcode = 'P0002'; end if;
  update public.fin_gmail_connections set senders = v_list where id = p_id;
  perform private.fin_event('gmail', p_id, 'senders_changed', jsonb_build_object('before', c.senders, 'after', v_list));
end $$;

-- ---------------------------------------------------------------------------
-- Used only by the app server (service role)
-- ---------------------------------------------------------------------------
create or replace function public.fin_gmail_token(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
    from public.fin_gmail_connections c
    join vault.decrypted_secrets s on s.id = c.token_secret_id
   where c.id = p_id and c.disconnected_at is null
$$;

-- Records what the server read in one check of a mailbox. p_alerts is a list of
-- {message_id, received_at, sender, subject, readable, direction, amount_paise, last4, reference_no,
-- counterparty, balance_paise, note}; note says why an unreadable one was not used. Emails already read are skipped. p_actor is the person whose visit or
-- button started the check (null when it ran on its own).
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
          from public.fin_accounts x where x.archived_at is null and x.last4 = v_last4;
      end if;
      if v_matches = 1 then
        v_status := private.fin_gmail_apply(v_id, v_acc, p_actor);
      else
        update public.fin_gmail_alerts
           set note = case
             when v_last4 = '' then 'The email does not say which account. Choose one'
             when v_matches = 0 then 'No bank account in use ends in ' || v_last4 || '. Add it under Banks, or choose one'
             else 'More than one bank account ends in ' || v_last4 || '. Choose one' end
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

-- ---------------------------------------------------------------------------
-- Reviewing (Super Admin and Finance access)
-- ---------------------------------------------------------------------------
-- An alert whose account could not be told apart is recorded against the account a person chooses.
create or replace function public.fin_gmail_alert_assign(p_alert uuid, p_account uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  a public.fin_gmail_alerts;
  v_status text;
begin
  select * into a from public.fin_gmail_alerts where id = p_alert for update;
  if a.id is null then raise exception 'Bank alert not found' using errcode = 'P0002'; end if;
  if a.status <> 'no_account' then raise exception 'This alert is already handled' using errcode = '22023'; end if;
  v_status := private.fin_gmail_apply(p_alert, p_account, v_me);
  update public.fin_gmail_alerts set handled_by = v_me, handled_at = now() where id = p_alert;
  perform private.fin_event('gmail_alert', p_alert, 'account_chosen', jsonb_build_object('account', p_account, 'result', v_status));
  return v_status;
end $$;

create or replace function public.fin_gmail_alert_ignore(p_alert uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  a public.fin_gmail_alerts;
begin
  select * into a from public.fin_gmail_alerts where id = p_alert for update;
  if a.id is null then raise exception 'Bank alert not found' using errcode = 'P0002'; end if;
  if a.status not in ('no_account', 'unreadable') then raise exception 'This alert is already handled' using errcode = '22023'; end if;
  update public.fin_gmail_alerts
     set status = 'ignored', note = left(btrim(coalesce(p_reason, '')), 300), handled_by = v_me, handled_at = now()
   where id = p_alert;
  perform private.fin_event('gmail_alert', p_alert, 'ignored', jsonb_build_object('reason', btrim(coalesce(p_reason, '')), 'was', a.status));
end $$;

-- Marks transactions read from bank emails as checked. Returns how many changed.
create or replace function public.fin_txn_confirm(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_id uuid;
  v_n integer := 0;
begin
  if coalesce(cardinality(p_ids), 0) > 500 then raise exception 'Confirm at most 500 at a time' using errcode = '22023'; end if;
  for v_id in
    update public.fin_transactions set review_status = 'confirmed', updated_by = v_me, updated_at = now()
     where id = any(coalesce(p_ids, '{}'::uuid[])) and review_status = 'needs_review' and voided_at is null
    returning id
  loop
    perform private.fin_event('transaction', v_id, 'confirmed');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.fin_gmail_connections enable row level security;
alter table public.fin_gmail_alerts enable row level security;
revoke all on public.fin_gmail_connections, public.fin_gmail_alerts from anon, authenticated;
grant select on public.fin_gmail_connections, public.fin_gmail_alerts to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fin_gmail_connections' and policyname = 'fin_gmail_connections_read') then
    create policy fin_gmail_connections_read on public.fin_gmail_connections for select to authenticated using (private.has_finance());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fin_gmail_alerts' and policyname = 'fin_gmail_alerts_read') then
    create policy fin_gmail_alerts_read on public.fin_gmail_alerts for select to authenticated using (private.has_finance());
  end if;
end $$;

revoke execute on function private.fin_gmail_apply(uuid, uuid, uuid) from public, anon, authenticated;

revoke execute on function
  public.fin_gmail_connect(text, text, date), public.fin_gmail_disconnect(uuid), public.fin_gmail_set_senders(uuid, text[]),
  public.fin_gmail_alert_assign(uuid, uuid), public.fin_gmail_alert_ignore(uuid, text), public.fin_txn_confirm(uuid[]),
  public.fin_gmail_token(uuid), public.fin_gmail_record(uuid, uuid, jsonb, timestamptz, boolean, text)
from public, anon, authenticated;
grant execute on function
  public.fin_gmail_connect(text, text, date), public.fin_gmail_disconnect(uuid), public.fin_gmail_set_senders(uuid, text[]),
  public.fin_gmail_alert_assign(uuid, uuid), public.fin_gmail_alert_ignore(uuid, text), public.fin_txn_confirm(uuid[])
to authenticated;
grant execute on function public.fin_gmail_token(uuid), public.fin_gmail_record(uuid, uuid, jsonb, timestamptz, boolean, text) to service_role;
