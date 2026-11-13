-- OpsPulse Workspace: Cash Flow, bank statement upload (13-Nov-2026).
--
-- HDFC does not email every transaction (UPI and auto-debits often come by SMS only), so the
-- transactions from bank emails leave gaps. A statement downloaded from net banking fills them:
-- each statement line is matched to a transaction already recorded on the account (same direction
-- and amount, the same day first, then a day either side; a matching reference number wins).
-- Lines with no match are added as transactions waiting to be checked, like bank emails. The bank's
-- balance at the end of each day in the statement is recorded too, so every day can be checked
-- against the bank. Lines dated today are left out until the day is over, so the statement never
-- covers part of a day. Uploading the same statement again changes nothing. The file itself is never
-- stored; only the facts are.
--
-- A bank email that arrives after a statement already brought in the same payment is marked as a
-- duplicate instead of being recorded twice.
--
-- Safe for a live database: adds one column (empty by default), one index and two functions, and
-- updates how a bank email is recorded. No row is removed or changed by this migration.

alter table public.fin_transactions add column if not exists import_key text not null default ''
  check (import_key ~ '^([0-9a-f]{16,64})?$');

create unique index if not exists fin_transactions_import_key
  on public.fin_transactions (account_id, import_key) where import_key <> '';

-- The recorded transaction a statement line stands for, if any. p_days: how many days apart the
-- statement date and the recorded date may be. A matching reference number is allowed 3 days.
create or replace function private.fin_statement_match(p_account uuid, p_tz text, p_date date, p_direction text,
                                                       p_amount bigint, p_ref text, p_days integer)
returns uuid language sql security definer set search_path = '' as $$
  select x.id from public.fin_transactions x
   where x.account_id = p_account and x.voided_at is null and x.import_key = ''
     and x.direction = p_direction and x.amount_paise = p_amount
     and case when p_ref <> '' and ltrim(lower(x.reference_no), '0') = ltrim(lower(p_ref), '0')
              then abs((x.txn_at at time zone p_tz)::date - p_date) <= 3
              else (p_ref = '' or x.reference_no = '') and abs((x.txn_at at time zone p_tz)::date - p_date) <= p_days end
   order by (p_ref <> '' and ltrim(lower(x.reference_no), '0') = ltrim(lower(p_ref), '0')) desc,
            abs((x.txn_at at time zone p_tz)::date - p_date), x.txn_at
   limit 1
$$;
revoke execute on function private.fin_statement_match(uuid, text, date, text, bigint, text, integer) from public, anon, authenticated;

-- p_lines: [{date, direction, amount_paise, reference_no, counterparty, kind, balance_paise, key}],
-- oldest first, as read by the app server from the uploaded file.
create or replace function public.fin_statement_import(p_account uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_tz text;
  v_today date;
  e record;
  t public.fin_transactions;
  v_pass integer;
  v_done boolean[] := '{}';
  v_prev date;
  v_date date;
  v_dir text;
  v_amount bigint;
  v_ref text;
  v_who text;
  v_kind text;
  v_key text;
  v_id uuid;
  v_new_ref text;
  v_new_who text;
  v_from date;
  v_to date;
  v_eod jsonb := '{}'::jsonb;
  d record;
  v_as_of timestamptz;
  v_counts jsonb := '{"lines": 0, "already": 0, "matched": 0, "added": 0, "today": 0, "balances": 0}'::jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The statement has no transactions' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'The statement has too many lines; upload a shorter period' using errcode = '22023';
  end if;
  perform 1 from public.fin_accounts where id = p_account and archived_at is null for update;
  if not found then raise exception 'Choose a bank account that is in use' using errcode = '22023'; end if;
  v_tz := coalesce((select timezone from public.app_settings limit 1), 'Asia/Kolkata');
  v_today := (now() at time zone v_tz)::date;

  -- Check every line, and set aside today's lines and lines brought in before.
  for e in select j, n::integer as n from jsonb_array_elements(p_lines) with ordinality as l(j, n) order by n loop
    if coalesce(e.j->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(e.j->>'direction', '') not in ('in', 'out')
       or coalesce(e.j->>'amount_paise', '') !~ '^\d{1,15}$' or (e.j->>'amount_paise')::bigint <= 0
       or coalesce(e.j->>'key', '') !~ '^[0-9a-f]{16,64}$'
       or (e.j->>'balance_paise' is not null and e.j->>'balance_paise' !~ '^-?\d{1,15}$') then
      raise exception 'Line % of the statement could not be read', e.n using errcode = '22023';
    end if;
    v_date := (e.j->>'date')::date;
    if v_prev is not null and v_date < v_prev then
      raise exception 'The statement lines are not in date order' using errcode = '22023';
    end if;
    v_prev := v_date;
    if v_date >= v_today then
      v_done[e.n] := true;
      v_counts := jsonb_set(v_counts, '{today}', to_jsonb((v_counts->>'today')::integer + 1));
      continue;
    end if;
    v_from := coalesce(v_from, v_date);
    v_to := v_date;
    if e.j->>'balance_paise' is not null then
      v_eod := v_eod || jsonb_build_object(v_date::text, (e.j->>'balance_paise')::bigint);
    end if;
    v_counts := jsonb_set(v_counts, '{lines}', to_jsonb((v_counts->>'lines')::integer + 1));
    if exists (select 1 from public.fin_transactions x where x.account_id = p_account and x.import_key = e.j->>'key') then
      v_done[e.n] := true;
      v_counts := jsonb_set(v_counts, '{already}', to_jsonb((v_counts->>'already')::integer + 1));
    end if;
  end loop;

  -- Match to what is recorded: the same day (or the same reference number) first, then a day either
  -- side, so a payment is not taken by the line of a neighbouring day with the same amount.
  for v_pass in 0..1 loop
    for e in select j, n::integer as n from jsonb_array_elements(p_lines) with ordinality as l(j, n) order by n loop
      continue when coalesce(v_done[e.n], false);
      v_ref := left(btrim(coalesce(e.j->>'reference_no', '')), 80);
      v_id := private.fin_statement_match(p_account, v_tz, (e.j->>'date')::date, e.j->>'direction',
                                          (e.j->>'amount_paise')::bigint, v_ref, v_pass);
      continue when v_id is null;
      select * into t from public.fin_transactions where id = v_id for update;
      v_who := left(btrim(coalesce(e.j->>'counterparty', '')), 120);
      v_new_ref := case when t.reference_no = '' and v_ref <> ''
                         and not exists (select 1 from public.fin_transactions o where o.account_id = p_account and o.id <> t.id
                                           and lower(o.reference_no) = lower(v_ref) and o.voided_at is null)
                        then v_ref else t.reference_no end;
      v_new_who := case when t.counterparty = '' then v_who else t.counterparty end;
      update public.fin_transactions
         set import_key = e.j->>'key', reference_no = v_new_ref, counterparty = v_new_who, updated_by = v_me, updated_at = now()
       where id = t.id;
      if t.review_status = 'confirmed' and (v_new_ref <> t.reference_no or v_new_who <> t.counterparty) then
        perform private.fin_event('transaction', t.id, 'details_filled', jsonb_build_object(
          'by', 'statement', 'reference_no', jsonb_build_object('before', t.reference_no, 'after', v_new_ref),
          'counterparty', jsonb_build_object('before', t.counterparty, 'after', v_new_who)));
      end if;
      v_done[e.n] := true;
      v_counts := jsonb_set(v_counts, '{matched}', to_jsonb((v_counts->>'matched')::integer + 1));
    end loop;
  end loop;

  -- Not recorded yet: add it, waiting to be checked. A statement gives the day, not the time, so it
  -- is placed at midday, in the statement's order.
  for e in select j, n::integer as n from jsonb_array_elements(p_lines) with ordinality as l(j, n) order by n loop
    continue when coalesce(v_done[e.n], false);
    v_date := (e.j->>'date')::date;
    v_dir := e.j->>'direction';
    v_amount := (e.j->>'amount_paise')::bigint;
    v_key := e.j->>'key';
    v_ref := left(btrim(coalesce(e.j->>'reference_no', '')), 80);
    v_who := left(btrim(coalesce(e.j->>'counterparty', '')), 120);
    v_kind := left(coalesce(nullif(btrim(coalesce(e.j->>'kind', '')), ''), 'Other'), 40);
    if v_ref <> '' and exists (select 1 from public.fin_transactions o where o.account_id = p_account
                                 and lower(o.reference_no) = lower(v_ref) and o.voided_at is null) then
      v_ref := '';
    end if;
    insert into public.fin_transactions (account_id, txn_at, direction, amount_paise, category, counterparty, description, reference_no,
                                         source, review_status, import_key, created_by, updated_by)
    values (p_account, ((v_date + time '12:00') at time zone v_tz) + make_interval(secs => e.n), v_dir, v_amount,
            case when v_dir = 'in' then 'other_income' else 'other_expense' end,
            v_who, 'Bank statement: ' || v_kind, v_ref, 'statement', 'needs_review', v_key, v_me, v_me)
    returning id into v_id;
    perform private.fin_event('transaction', v_id, 'created',
      jsonb_build_object('amount', v_amount, 'direction', v_dir, 'source', 'statement'));
    v_counts := jsonb_set(v_counts, '{added}', to_jsonb((v_counts->>'added')::integer + 1));
  end loop;

  -- The bank's balance at the end of each day, from the last line of that day.
  for d in select key::date as day, value::bigint as balance from jsonb_each_text(v_eod) order by 1 loop
    v_as_of := ((d.day + 1) + time '00:00') at time zone v_tz - interval '1 second';
    if not exists (select 1 from public.fin_balances b where b.account_id = p_account and b.voided_at is null
                     and b.as_of = v_as_of and b.balance_paise = d.balance) then
      insert into public.fin_balances (account_id, as_of, balance_paise, source, note, created_by)
      values (p_account, v_as_of, d.balance, 'statement', 'End-of-day balance from a bank statement', v_me);
      v_counts := jsonb_set(v_counts, '{balances}', to_jsonb((v_counts->>'balances')::integer + 1));
    end if;
  end loop;

  v_counts := v_counts || jsonb_build_object('from', v_from, 'to', v_to);
  perform private.fin_event('account', p_account, 'statement_imported', v_counts);
  return v_counts;
end $$;

revoke execute on function public.fin_statement_import(uuid, jsonb) from public, anon;
grant execute on function public.fin_statement_import(uuid, jsonb) to authenticated;

-- A bank email for a payment a statement already brought in (same day, amount and direction, and no
-- conflicting reference number) is a duplicate. Its balance is still a real reading, so it is kept.
create or replace function private.fin_gmail_apply(p_alert uuid, p_account uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  a public.fin_gmail_alerts;
  v_txn uuid;
  v_bal uuid;
  v_status text;
  v_note text := '';
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'Asia/Kolkata');
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
      v_note := 'Already recorded on this account with the same reference number';
    elsif exists (select 1 from public.fin_transactions t where t.account_id = p_account and t.voided_at is null and t.source = 'statement'
                    and t.direction = a.direction and t.amount_paise = a.amount_paise
                    and (t.txn_at at time zone v_tz)::date = (a.received_at at time zone v_tz)::date
                    and (a.reference_no = '' or t.reference_no = '')) then
      v_status := 'duplicate';
      v_note := 'Already on this account from a bank statement';
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

  if a.balance_paise is not null and (v_status <> 'duplicate' or v_note like '%bank statement') then
    insert into public.fin_balances (account_id, as_of, balance_paise, source, note, created_by)
    values (p_account, a.received_at, a.balance_paise, 'gmail', 'From a bank alert email', p_actor)
    returning id into v_bal;
    insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
    values ('account', p_account, 'balance_recorded', p_actor,
            jsonb_build_object('balance', a.balance_paise, 'as_of', a.received_at, 'source', 'gmail', 'alert', a.id));
  end if;

  update public.fin_gmail_alerts
     set status = v_status, account_id = p_account, transaction_id = v_txn, balance_id = v_bal, note = v_note
   where id = p_alert;
  return v_status;
end $$;
revoke execute on function private.fin_gmail_apply(uuid, uuid, uuid) from public, anon, authenticated;
