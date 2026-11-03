-- OpsPulse Workspace: Cash Flow Command Centre, phase 1 (3-Nov-2026).
--
-- Bank accounts and their balances, bank transactions, payables (money going out), receivables
-- (money coming in), and loans whose EMIs become payables automatically. Only the Super Admin and
-- people the Super Admin gives Finance access can see or change any of it. Every table is read-only
-- to the app; changes go through the functions below, which check access and record each change in
-- fin_events. Amounts are whole paise (bigint). Bank accounts keep only their last 4 digits.
--
-- Safe for a live database: this migration only adds tables, functions and one trigger on members
-- (it removes Finance access from someone who is deactivated). No existing function, policy or row
-- changes.

-- ---------------------------------------------------------------------------
-- Who can use Finance
-- ---------------------------------------------------------------------------
create table if not exists public.finance_access (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.members (id) on delete set null,
  revoked_at timestamptz
);
create unique index if not exists finance_access_active on public.finance_access (member_id) where revoked_at is null;

create or replace function private.has_finance()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or exists (
    select 1 from public.finance_access f join public.members m on m.id = f.member_id
     where f.member_id = private.me() and f.revoked_at is null and m.is_active)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.fin_settings (
  id boolean primary key default true check (id),
  min_cash_paise bigint not null default 0 check (min_cash_paise >= 0),
  large_debit_paise bigint not null default 0 check (large_debit_paise >= 0),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.fin_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  bank text not null default '' check (length(bank) <= 80),
  last4 text not null default '' check (last4 ~ '^([0-9]{4})?$'),
  kind text not null default 'current' check (kind in ('current', 'savings', 'overdraft', 'credit_card', 'cash', 'other')),
  notes text not null default '' check (length(notes) <= 500),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  archived_by uuid references public.members (id) on delete set null,
  archived_at timestamptz
);

-- A balance someone read from the bank (or, later, from a bank email) at a moment in time. The
-- current balance is the latest one plus the confirmed transactions after it.
create table if not exists public.fin_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.fin_accounts (id) on delete restrict,
  as_of timestamptz not null,
  balance_paise bigint not null,
  source text not null default 'manual' check (source in ('manual', 'gmail', 'statement')),
  note text not null default '' check (length(note) <= 300),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_by uuid references public.members (id) on delete set null,
  voided_at timestamptz
);
create index if not exists fin_balances_by_account on public.fin_balances (account_id, as_of desc) where voided_at is null;

create table if not exists public.fin_loans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  lender text not null default '' check (length(lender) <= 120),
  principal_paise bigint not null check (principal_paise > 0),
  outstanding_paise bigint not null check (outstanding_paise >= 0),
  annual_rate numeric(6, 3) check (annual_rate is null or annual_rate between 0 and 100),
  emi_paise bigint not null check (emi_paise > 0),
  first_emi_date date not null,
  tenure_months integer not null check (tenure_months between 1 and 600),
  paid_before integer not null default 0 check (paid_before >= 0),
  account_id uuid references public.fin_accounts (id) on delete restrict,
  notes text not null default '' check (length(notes) <= 1000),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  closed_by uuid references public.members (id) on delete set null,
  closed_at timestamptz,
  check (paid_before <= tenure_months)
);

-- Money going out. state is what a person decided; the app shows Upcoming, Due today, Overdue,
-- Partially paid and Postponed from it and the dates. A recurring payment's next occurrence and a
-- loan's EMIs share a series_id, and each date of a series exists once.
create table if not exists public.fin_payables (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  payee text not null default '' check (length(payee) <= 120),
  amount_paise bigint not null check (amount_paise > 0),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  due_date date not null,
  original_due_date date not null,
  category text not null check (category in ('inventory', 'marketing', 'salaries', 'rent', 'logistics', 'vendor', 'loan_emi',
                                             'credit_card', 'taxes', 'other_expense')),
  account_id uuid references public.fin_accounts (id) on delete restrict,
  priority text not null default 'high' check (priority in ('critical', 'high', 'medium', 'low')),
  state text not null default 'open' check (state in ('open', 'scheduled', 'on_hold', 'paid', 'cancelled')),
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly', 'quarterly', 'yearly')),
  series_id uuid not null default gen_random_uuid(),
  loan_id uuid references public.fin_loans (id) on delete restrict,
  emi_no integer check (emi_no is null or emi_no > 0),
  penalty text not null default '' check (length(penalty) <= 300),
  notes text not null default '' check (length(notes) <= 1000),
  state_reason text not null default '' check (length(state_reason) <= 300),
  postpone_reason text not null default '' check (length(postpone_reason) <= 300),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (paid_paise <= amount_paise),
  check ((loan_id is null) = (emi_no is null))
);
create unique index if not exists fin_payables_series_date on public.fin_payables (series_id, original_due_date)
  where state <> 'cancelled' and loan_id is null;
create unique index if not exists fin_payables_emi on public.fin_payables (loan_id, emi_no) where loan_id is not null;
create index if not exists fin_payables_open on public.fin_payables (due_date) where state in ('open', 'scheduled', 'on_hold');

-- Money coming in.
create table if not exists public.fin_receivables (
  id uuid primary key default gen_random_uuid(),
  party text not null check (length(btrim(party)) between 1 and 120),
  source text not null default 'customer' check (source in ('customer', 'marketplace', 'other')),
  reference_no text not null default '' check (length(reference_no) <= 80),
  category text not null default 'customer_receipt' check (category in ('customer_receipt', 'marketplace_settlement', 'other_income')),
  amount_paise bigint not null check (amount_paise > 0),
  received_paise bigint not null default 0 check (received_paise >= 0),
  expected_date date not null,
  original_expected_date date not null,
  account_id uuid references public.fin_accounts (id) on delete restrict,
  state text not null default 'open' check (state in ('open', 'disputed', 'received', 'written_off', 'cancelled')),
  notes text not null default '' check (length(notes) <= 1000),
  state_reason text not null default '' check (length(state_reason) <= 300),
  delay_reason text not null default '' check (length(delay_reason) <= 300),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (received_paise <= amount_paise)
);
create index if not exists fin_receivables_open on public.fin_receivables (expected_date) where state in ('open', 'disputed');

-- Confirmed money in or out of a bank account. Mistakes are voided, never deleted.
create table if not exists public.fin_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.fin_accounts (id) on delete restrict,
  txn_at timestamptz not null,
  direction text not null check (direction in ('in', 'out')),
  amount_paise bigint not null check (amount_paise > 0),
  category text not null check (category in ('inventory', 'marketing', 'salaries', 'rent', 'logistics', 'vendor', 'loan_emi',
                                             'credit_card', 'taxes', 'other_expense', 'customer_receipt', 'marketplace_settlement',
                                             'other_income', 'transfer')),
  counterparty text not null default '' check (length(counterparty) <= 120),
  description text not null default '' check (length(description) <= 500),
  reference_no text not null default '' check (length(reference_no) <= 80),
  source text not null default 'manual' check (source in ('manual', 'gmail', 'statement')),
  review_status text not null default 'confirmed' check (review_status in ('confirmed', 'needs_review')),
  payable_id uuid references public.fin_payables (id) on delete restrict,
  receivable_id uuid references public.fin_receivables (id) on delete restrict,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  voided_by uuid references public.members (id) on delete set null,
  voided_at timestamptz,
  void_reason text not null default '' check (length(void_reason) <= 300)
);
create unique index if not exists fin_transactions_reference on public.fin_transactions (account_id, lower(reference_no))
  where reference_no <> '' and voided_at is null;
create index if not exists fin_transactions_by_date on public.fin_transactions (txn_at desc) where voided_at is null;
create index if not exists fin_transactions_by_payable on public.fin_transactions (payable_id) where payable_id is not null;
create index if not exists fin_transactions_by_receivable on public.fin_transactions (receivable_id) where receivable_id is not null;

-- Append-only history of every change.
create table if not exists public.fin_events (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid,
  action text not null,
  actor_member_id uuid references public.members (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists fin_events_by_entity on public.fin_events (entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.fin_guard()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if private.me() is null or not private.has_finance() then
    raise exception 'Only the Super Admin and people with Finance access can do this' using errcode = '42501';
  end if;
  return private.me();
end $$;

create or replace function private.fin_event(p_entity text, p_id uuid, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
  values (p_entity, p_id, p_action, private.me(), coalesce(p_details, '{}'::jsonb))
$$;

create or replace function private.fin_check_account(p_account uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account is not null and not exists (select 1 from public.fin_accounts a where a.id = p_account and a.archived_at is null) then
    raise exception 'Choose a bank account that is in use' using errcode = '22023';
  end if;
end $$;

-- The date of the n-th step of a repeating schedule, keeping the day of the month where it exists.
create or replace function private.fin_step(p_date date, p_recurrence text, p_n integer)
returns date language sql immutable set search_path = '' as $$
  select case p_recurrence
    when 'weekly' then p_date + 7 * p_n
    when 'monthly' then (p_date + make_interval(months => p_n))::date
    when 'quarterly' then (p_date + make_interval(months => 3 * p_n))::date
    when 'yearly' then (p_date + make_interval(years => p_n))::date
    else p_date end
$$;

-- EMIs due up to 90 days ahead become payables (each instalment once). Instalments already paid
-- before the loan was added are skipped.
create or replace function private.fin_loan_sync(p_loan uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  l public.fin_loans;
  v_n integer;
  v_due date;
  v_added integer := 0;
  v_horizon date := private.today() + 90;
begin
  select * into l from public.fin_loans where id = p_loan;
  if l.id is null or l.closed_at is not null then return 0; end if;
  for v_n in (l.paid_before + 1) .. l.tenure_months loop
    v_due := private.fin_step(l.first_emi_date, 'monthly', v_n - 1);
    exit when v_due > v_horizon;
    insert into public.fin_payables (title, payee, amount_paise, due_date, original_due_date, category, account_id, priority,
                                     series_id, loan_id, emi_no, created_by, updated_by)
    values (format('EMI %s of %s: %s', v_n, l.tenure_months, l.name), l.lender, l.emi_paise, v_due, v_due, 'loan_emi',
            l.account_id, 'critical', l.id, l.id, v_n, private.me(), private.me())
    on conflict do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;
  return v_added;
end $$;

-- A recurring payment that is paid or cancelled gets its next occurrence (once).
create or replace function private.fin_next_occurrence(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.fin_payables;
begin
  select * into p from public.fin_payables where id = p_id;
  if p.recurrence = 'none' or p.loan_id is not null then return; end if;
  insert into public.fin_payables (title, payee, amount_paise, due_date, original_due_date, category, account_id, priority,
                                   recurrence, series_id, penalty, notes, created_by, updated_by)
  values (p.title, p.payee, p.amount_paise, private.fin_step(p.original_due_date, p.recurrence, 1),
          private.fin_step(p.original_due_date, p.recurrence, 1), p.category, p.account_id, p.priority, p.recurrence,
          p.series_id, p.penalty, p.notes, private.me(), private.me())
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Access functions
-- ---------------------------------------------------------------------------
create or replace function public.my_finance_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.me() is not null and private.has_finance()
$$;

create or replace function public.finance_set_access(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.members;
begin
  if not private.is_admin() then raise exception 'Only the Super Admin can change Finance access' using errcode = '42501'; end if;
  select * into m from public.members where id = p_member;
  if m.id is null then raise exception 'Team member not found' using errcode = 'P0002'; end if;
  if p_on then
    if not m.is_active then raise exception 'Only an active team member can have Finance access' using errcode = '22023'; end if;
    if m.access_role = 'admin' then return; end if;
    insert into public.finance_access (member_id, granted_by) values (p_member, private.me()) on conflict do nothing;
    if found then perform private.fin_event('finance_access', p_member, 'granted', jsonb_build_object('name', m.name)); end if;
  else
    update public.finance_access set revoked_at = now(), revoked_by = private.me() where member_id = p_member and revoked_at is null;
    if found then perform private.fin_event('finance_access', p_member, 'removed', jsonb_build_object('name', m.name)); end if;
  end if;
end $$;

create or replace function private.members_finance_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_active then
    update public.finance_access set revoked_at = now(), revoked_by = private.me() where member_id = new.id and revoked_at is null;
    if found then
      insert into public.fin_events (entity, entity_id, action, actor_member_id, details)
      values ('finance_access', new.id, 'removed', private.me(), jsonb_build_object('name', new.name, 'reason', 'deactivated'));
    end if;
  end if;
  return null;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'members_finance_cleanup' and tgrelid = 'public.members'::regclass) then
    create trigger members_finance_cleanup after update of is_active on public.members
      for each row execute function private.members_finance_cleanup();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Settings and bank accounts
-- ---------------------------------------------------------------------------
create or replace function public.fin_settings_save(p_min_cash bigint, p_large_debit bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
begin
  if p_min_cash is null or p_min_cash < 0 or p_large_debit is null or p_large_debit < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '22023';
  end if;
  update public.fin_settings set min_cash_paise = p_min_cash, large_debit_paise = p_large_debit, updated_by = v_me, updated_at = now() where id;
  perform private.fin_event('settings', null, 'updated', jsonb_build_object('min_cash', p_min_cash, 'large_debit', p_large_debit));
end $$;

create or replace function public.fin_account_save(p_id uuid, p_name text, p_bank text, p_last4 text, p_kind text, p_notes text,
                                                   p_balance bigint, p_as_of timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_id uuid;
begin
  if p_id is null then
    if p_balance is null then raise exception 'Enter the current balance' using errcode = '22023'; end if;
    insert into public.fin_accounts (name, bank, last4, kind, notes, created_by, updated_by)
    values (btrim(p_name), btrim(coalesce(p_bank, '')), btrim(coalesce(p_last4, '')), coalesce(p_kind, 'current'),
            btrim(coalesce(p_notes, '')), v_me, v_me)
    returning id into v_id;
    insert into public.fin_balances (account_id, as_of, balance_paise, source, note, created_by)
    values (v_id, coalesce(p_as_of, now()), p_balance, 'manual', 'Opening balance', v_me);
    perform private.fin_event('account', v_id, 'created', jsonb_build_object('name', btrim(p_name), 'balance', p_balance));
    return v_id;
  end if;
  update public.fin_accounts
     set name = btrim(p_name), bank = btrim(coalesce(p_bank, '')), last4 = btrim(coalesce(p_last4, '')),
         kind = coalesce(p_kind, kind), notes = btrim(coalesce(p_notes, '')), updated_by = v_me, updated_at = now()
   where id = p_id and archived_at is null;
  if not found then raise exception 'Bank account not found' using errcode = 'P0002'; end if;
  perform private.fin_event('account', p_id, 'updated', jsonb_build_object('name', btrim(p_name)));
  return p_id;
end $$;

create or replace function public.fin_account_set_archived(p_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
begin
  update public.fin_accounts set archived_at = case when p_archived then now() end, archived_by = case when p_archived then v_me end,
         updated_by = v_me, updated_at = now()
   where id = p_id and (archived_at is null) = p_archived;
  if not found then raise exception 'Bank account not found' using errcode = 'P0002'; end if;
  perform private.fin_event('account', p_id, case when p_archived then 'archived' else 'restored' end);
end $$;

create or replace function public.fin_balance_record(p_account uuid, p_balance bigint, p_as_of timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_id uuid;
begin
  perform private.fin_check_account(p_account);
  if p_account is null then raise exception 'Choose a bank account' using errcode = '22023'; end if;
  if p_balance is null then raise exception 'Enter the balance' using errcode = '22023'; end if;
  if coalesce(p_as_of, now()) > now() + interval '5 minutes' then raise exception 'A balance cannot be in the future' using errcode = '22023'; end if;
  insert into public.fin_balances (account_id, as_of, balance_paise, source, note, created_by)
  values (p_account, coalesce(p_as_of, now()), p_balance, 'manual', btrim(coalesce(p_note, '')), v_me)
  returning id into v_id;
  perform private.fin_event('account', p_account, 'balance_recorded', jsonb_build_object('balance', p_balance, 'as_of', coalesce(p_as_of, now())));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create or replace function private.fin_check_category(p_direction text, p_category text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_category = 'transfer' then return; end if;
  if p_direction = 'in' and p_category not in ('customer_receipt', 'marketplace_settlement', 'other_income') then
    raise exception 'Choose a money-in category for money coming in' using errcode = '22023';
  end if;
  if p_direction = 'out' and p_category in ('customer_receipt', 'marketplace_settlement', 'other_income') then
    raise exception 'Choose a money-out category for money going out' using errcode = '22023';
  end if;
end $$;

create or replace function public.fin_txn_save(p_id uuid, p_account uuid, p_at timestamptz, p_direction text, p_amount bigint,
                                               p_category text, p_counterparty text, p_description text, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_old public.fin_transactions;
  v_id uuid;
  v_ref text := btrim(coalesce(p_reference, ''));
begin
  perform private.fin_check_account(p_account);
  if p_account is null then raise exception 'Choose a bank account' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Choose money in or money out' using errcode = '22023'; end if;
  perform private.fin_check_category(p_direction, p_category);
  if p_at is null or p_at > now() + interval '1 day' then raise exception 'Enter a date that is not in the future' using errcode = '22023'; end if;
  if v_ref <> '' and exists (select 1 from public.fin_transactions t where t.account_id = p_account and lower(t.reference_no) = lower(v_ref)
                                and t.voided_at is null and t.id is distinct from p_id) then
    raise exception 'A transaction with this reference number is already recorded for this account' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.fin_transactions (account_id, txn_at, direction, amount_paise, category, counterparty, description, reference_no,
                                         created_by, updated_by)
    values (p_account, p_at, p_direction, p_amount, p_category, btrim(coalesce(p_counterparty, '')), btrim(coalesce(p_description, '')),
            v_ref, v_me, v_me)
    returning id into v_id;
    perform private.fin_event('transaction', v_id, 'created', jsonb_build_object('amount', p_amount, 'direction', p_direction, 'category', p_category));
    return v_id;
  end if;
  select * into v_old from public.fin_transactions where id = p_id for update;
  if v_old.id is null or v_old.voided_at is not null then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if (v_old.payable_id is not null or v_old.receivable_id is not null)
     and (p_amount <> v_old.amount_paise or p_direction <> v_old.direction or p_account <> v_old.account_id) then
    raise exception 'This transaction records a payment. Undo the payment to change its amount or account' using errcode = '22023';
  end if;
  update public.fin_transactions
     set account_id = p_account, txn_at = p_at, direction = p_direction, amount_paise = p_amount, category = p_category,
         counterparty = btrim(coalesce(p_counterparty, '')), description = btrim(coalesce(p_description, '')), reference_no = v_ref,
         review_status = 'confirmed', updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('transaction', p_id, 'updated', jsonb_build_object(
    'before', jsonb_build_object('amount', v_old.amount_paise, 'direction', v_old.direction, 'category', v_old.category, 'at', v_old.txn_at),
    'after', jsonb_build_object('amount', p_amount, 'direction', p_direction, 'category', p_category, 'at', p_at)));
  return p_id;
end $$;

-- Undoes a transaction. One that records a payment or receipt also takes that amount back off the
-- payable or receivable.
create or replace function public.fin_txn_void(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  t public.fin_transactions;
begin
  select * into t from public.fin_transactions where id = p_id and voided_at is null for update;
  if t.id is null then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  update public.fin_transactions set voided_at = now(), voided_by = v_me, void_reason = btrim(coalesce(p_reason, '')) where id = p_id;
  if t.payable_id is not null then
    update public.fin_payables
       set paid_paise = paid_paise - t.amount_paise, state = case when state = 'paid' then 'open' else state end,
           updated_by = v_me, updated_at = now()
     where id = t.payable_id;
  end if;
  if t.receivable_id is not null then
    update public.fin_receivables
       set received_paise = received_paise - t.amount_paise, state = case when state = 'received' then 'open' else state end,
           updated_by = v_me, updated_at = now()
     where id = t.receivable_id;
  end if;
  perform private.fin_event('transaction', p_id, 'voided', jsonb_build_object('amount', t.amount_paise, 'reason', btrim(coalesce(p_reason, '')),
                                                                             'payable', t.payable_id, 'receivable', t.receivable_id));
end $$;

-- ---------------------------------------------------------------------------
-- Payables
-- ---------------------------------------------------------------------------
create or replace function public.fin_payable_save(p_id uuid, p_title text, p_payee text, p_amount bigint, p_due date, p_category text,
                                                   p_account uuid, p_priority text, p_recurrence text, p_penalty text, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_old public.fin_payables;
  v_id uuid;
begin
  perform private.fin_check_account(p_account);
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_category = 'loan_emi' and p_id is null then raise exception 'Add a loan to plan its EMIs' using errcode = '22023'; end if;
  if p_id is null then
    if p_due is null then raise exception 'Choose a due date' using errcode = '22023'; end if;
    insert into public.fin_payables (title, payee, amount_paise, due_date, original_due_date, category, account_id, priority, recurrence,
                                     penalty, notes, created_by, updated_by)
    values (btrim(p_title), btrim(coalesce(p_payee, '')), p_amount, p_due, p_due, p_category, p_account, coalesce(p_priority, 'high'),
            coalesce(p_recurrence, 'none'), btrim(coalesce(p_penalty, '')), btrim(coalesce(p_notes, '')), v_me, v_me)
    returning id into v_id;
    perform private.fin_event('payable', v_id, 'created', jsonb_build_object('title', btrim(p_title), 'amount', p_amount, 'due', p_due));
    return v_id;
  end if;
  select * into v_old from public.fin_payables where id = p_id for update;
  if v_old.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v_old.state in ('paid', 'cancelled') then raise exception 'This payment is closed' using errcode = '22023'; end if;
  if p_amount < v_old.paid_paise then raise exception 'The amount cannot be less than what is already paid' using errcode = '22023'; end if;
  if v_old.loan_id is not null and p_category <> 'loan_emi' then raise exception 'An EMI stays in the Loan EMI category' using errcode = '22023'; end if;
  if v_old.loan_id is null and p_category = 'loan_emi' then raise exception 'Add a loan to plan its EMIs' using errcode = '22023'; end if;
  update public.fin_payables
     set title = btrim(p_title), payee = btrim(coalesce(p_payee, '')), amount_paise = p_amount, category = p_category, account_id = p_account,
         priority = coalesce(p_priority, priority), recurrence = case when loan_id is null then coalesce(p_recurrence, recurrence) else 'none' end,
         penalty = btrim(coalesce(p_penalty, '')), notes = btrim(coalesce(p_notes, '')), updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('payable', p_id, 'updated', jsonb_build_object(
    'before', jsonb_build_object('title', v_old.title, 'amount', v_old.amount_paise, 'priority', v_old.priority, 'category', v_old.category),
    'after', jsonb_build_object('title', btrim(p_title), 'amount', p_amount, 'priority', p_priority, 'category', p_category)));
  return p_id;
end $$;

-- Pays all or part of a payable from a bank account and records the bank transaction with it.
create or replace function public.fin_payable_pay(p_id uuid, p_amount bigint, p_paid_on date, p_account uuid, p_reference text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  p public.fin_payables;
  l public.fin_loans;
  v_txn uuid;
  v_interest bigint;
begin
  select * into p from public.fin_payables where id = p_id for update;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if p.state in ('paid', 'cancelled') then raise exception 'This payment is closed' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_amount > p.amount_paise - p.paid_paise then raise exception 'That is more than the amount still to pay' using errcode = '22023'; end if;
  if p_paid_on is null or p_paid_on > private.today() then raise exception 'Enter the date it was paid, not a future date' using errcode = '22023'; end if;
  v_txn := public.fin_txn_save(null, coalesce(p_account, p.account_id), (p_paid_on + time '12:00') at time zone
                               coalesce((select timezone from public.app_settings limit 1), 'UTC'),
                               'out', p_amount, p.category, p.payee, btrim(p.title || case when btrim(coalesce(p_note, '')) <> '' then ': ' || btrim(p_note) else '' end),
                               p_reference);
  update public.fin_transactions set payable_id = p_id where id = v_txn;
  update public.fin_payables
     set paid_paise = paid_paise + p_amount, state = case when paid_paise + p_amount = amount_paise then 'paid' else state end,
         updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('payable', p_id, 'paid', jsonb_build_object('amount', p_amount, 'on', p_paid_on, 'transaction', v_txn,
                                                                       'full', p.paid_paise + p_amount = p.amount_paise));
  if p.paid_paise + p_amount = p.amount_paise then
    perform private.fin_next_occurrence(p_id);
    if p.loan_id is not null then
      select * into l from public.fin_loans where id = p.loan_id for update;
      v_interest := case when l.annual_rate is null then null else round(l.outstanding_paise * l.annual_rate / 1200) end;
      if v_interest is not null then
        update public.fin_loans set outstanding_paise = greatest(0, outstanding_paise - greatest(0, p.amount_paise - v_interest)),
               updated_at = now() where id = l.id;
      end if;
      perform private.fin_loan_sync(l.id);
    end if;
  end if;
  return v_txn;
end $$;

-- Moves a payment to another date. A later date needs a reason; it is kept with the payment.
create or replace function public.fin_payable_reschedule(p_id uuid, p_due date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  p public.fin_payables;
begin
  select * into p from public.fin_payables where id = p_id for update;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if p.state in ('paid', 'cancelled') then raise exception 'This payment is closed' using errcode = '22023'; end if;
  if p_due is null then raise exception 'Choose the new date' using errcode = '22023'; end if;
  if p_due > p.due_date and btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for postponing' using errcode = '22023'; end if;
  update public.fin_payables
     set due_date = p_due, postpone_reason = case when p_due > p.due_date then btrim(p_reason) else postpone_reason end,
         updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('payable', p_id, case when p_due > p.due_date then 'postponed' else 'date_changed' end,
                            jsonb_build_object('from', p.due_date, 'to', p_due, 'reason', btrim(coalesce(p_reason, ''))));
end $$;

create or replace function public.fin_payable_set_state(p_id uuid, p_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  p public.fin_payables;
begin
  if p_state not in ('open', 'scheduled', 'on_hold', 'cancelled') then raise exception 'Unknown status' using errcode = '22023'; end if;
  select * into p from public.fin_payables where id = p_id for update;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if p.state in ('paid', 'cancelled') then raise exception 'This payment is closed' using errcode = '22023'; end if;
  if p_state in ('on_hold', 'cancelled') and btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason' using errcode = '22023'; end if;
  if p_state = 'cancelled' and p.paid_paise > 0 then raise exception 'Part of this is paid. Undo those payments first, or change the amount' using errcode = '22023'; end if;
  update public.fin_payables set state = p_state, state_reason = btrim(coalesce(p_reason, '')), updated_by = v_me, updated_at = now() where id = p_id;
  perform private.fin_event('payable', p_id, 'status_' || p_state, jsonb_build_object('from', p.state, 'reason', btrim(coalesce(p_reason, ''))));
  if p_state = 'cancelled' then perform private.fin_next_occurrence(p_id); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Receivables
-- ---------------------------------------------------------------------------
create or replace function public.fin_receivable_save(p_id uuid, p_party text, p_source text, p_reference text, p_category text,
                                                      p_amount bigint, p_expected date, p_account uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_old public.fin_receivables;
  v_id uuid;
begin
  perform private.fin_check_account(p_account);
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_id is null then
    if p_expected is null then raise exception 'Choose the expected date' using errcode = '22023'; end if;
    insert into public.fin_receivables (party, source, reference_no, category, amount_paise, expected_date, original_expected_date, account_id,
                                        notes, created_by, updated_by)
    values (btrim(p_party), coalesce(p_source, 'customer'), btrim(coalesce(p_reference, '')), coalesce(p_category, 'customer_receipt'), p_amount,
            p_expected, p_expected, p_account, btrim(coalesce(p_notes, '')), v_me, v_me)
    returning id into v_id;
    perform private.fin_event('receivable', v_id, 'created', jsonb_build_object('party', btrim(p_party), 'amount', p_amount, 'expected', p_expected));
    return v_id;
  end if;
  select * into v_old from public.fin_receivables where id = p_id for update;
  if v_old.id is null then raise exception 'Receivable not found' using errcode = 'P0002'; end if;
  if v_old.state in ('received', 'written_off', 'cancelled') then raise exception 'This receivable is closed' using errcode = '22023'; end if;
  if p_amount < v_old.received_paise then raise exception 'The amount cannot be less than what is already received' using errcode = '22023'; end if;
  update public.fin_receivables
     set party = btrim(p_party), source = coalesce(p_source, source), reference_no = btrim(coalesce(p_reference, '')),
         category = coalesce(p_category, category), amount_paise = p_amount, account_id = p_account, notes = btrim(coalesce(p_notes, '')),
         updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('receivable', p_id, 'updated', jsonb_build_object(
    'before', jsonb_build_object('party', v_old.party, 'amount', v_old.amount_paise),
    'after', jsonb_build_object('party', btrim(p_party), 'amount', p_amount)));
  return p_id;
end $$;

create or replace function public.fin_receivable_receive(p_id uuid, p_amount bigint, p_received_on date, p_account uuid, p_reference text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  r public.fin_receivables;
  v_txn uuid;
begin
  select * into r from public.fin_receivables where id = p_id for update;
  if r.id is null then raise exception 'Receivable not found' using errcode = 'P0002'; end if;
  if r.state in ('received', 'written_off', 'cancelled') then raise exception 'This receivable is closed' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = '22023'; end if;
  if p_amount > r.amount_paise - r.received_paise then raise exception 'That is more than the amount still to come' using errcode = '22023'; end if;
  if p_received_on is null or p_received_on > private.today() then raise exception 'Enter the date it arrived, not a future date' using errcode = '22023'; end if;
  v_txn := public.fin_txn_save(null, coalesce(p_account, r.account_id), (p_received_on + time '12:00') at time zone
                               coalesce((select timezone from public.app_settings limit 1), 'UTC'),
                               'in', p_amount, r.category, r.party,
                               btrim(coalesce(nullif(r.reference_no, ''), r.party) || case when btrim(coalesce(p_note, '')) <> '' then ': ' || btrim(p_note) else '' end),
                               p_reference);
  update public.fin_transactions set receivable_id = p_id where id = v_txn;
  update public.fin_receivables
     set received_paise = received_paise + p_amount, state = case when received_paise + p_amount = amount_paise then 'received' else state end,
         updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('receivable', p_id, 'received', jsonb_build_object('amount', p_amount, 'on', p_received_on, 'transaction', v_txn,
                                                                             'full', r.received_paise + p_amount = r.amount_paise));
  return v_txn;
end $$;

create or replace function public.fin_receivable_reschedule(p_id uuid, p_expected date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  r public.fin_receivables;
begin
  select * into r from public.fin_receivables where id = p_id for update;
  if r.id is null then raise exception 'Receivable not found' using errcode = 'P0002'; end if;
  if r.state in ('received', 'written_off', 'cancelled') then raise exception 'This receivable is closed' using errcode = '22023'; end if;
  if p_expected is null then raise exception 'Choose the new date' using errcode = '22023'; end if;
  update public.fin_receivables
     set expected_date = p_expected, delay_reason = case when p_expected > r.expected_date then btrim(coalesce(p_reason, '')) else delay_reason end,
         updated_by = v_me, updated_at = now()
   where id = p_id;
  perform private.fin_event('receivable', p_id, 'date_changed', jsonb_build_object('from', r.expected_date, 'to', p_expected, 'reason', btrim(coalesce(p_reason, ''))));
end $$;

create or replace function public.fin_receivable_set_state(p_id uuid, p_state text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  r public.fin_receivables;
begin
  if p_state not in ('open', 'disputed', 'written_off', 'cancelled') then raise exception 'Unknown status' using errcode = '22023'; end if;
  select * into r from public.fin_receivables where id = p_id for update;
  if r.id is null then raise exception 'Receivable not found' using errcode = 'P0002'; end if;
  if r.state in ('received', 'written_off', 'cancelled') then raise exception 'This receivable is closed' using errcode = '22023'; end if;
  if p_state <> 'open' and btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason' using errcode = '22023'; end if;
  if p_state = 'cancelled' and r.received_paise > 0 then raise exception 'Part of this has arrived. Write off the rest instead' using errcode = '22023'; end if;
  update public.fin_receivables set state = p_state, state_reason = btrim(coalesce(p_reason, '')), updated_by = v_me, updated_at = now() where id = p_id;
  perform private.fin_event('receivable', p_id, 'status_' || p_state, jsonb_build_object('from', r.state, 'reason', btrim(coalesce(p_reason, ''))));
end $$;

-- ---------------------------------------------------------------------------
-- Loans and EMIs
-- ---------------------------------------------------------------------------
create or replace function public.fin_loan_save(p_id uuid, p_name text, p_lender text, p_principal bigint, p_outstanding bigint, p_rate numeric,
                                                p_emi bigint, p_first_emi date, p_tenure integer, p_paid_before integer, p_account uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
  v_old public.fin_loans;
  v_id uuid;
begin
  perform private.fin_check_account(p_account);
  if p_principal is null or p_principal <= 0 then raise exception 'Enter the loan amount' using errcode = '22023'; end if;
  if p_emi is null or p_emi <= 0 then raise exception 'Enter the EMI amount' using errcode = '22023'; end if;
  if p_outstanding is null or p_outstanding < 0 then raise exception 'Enter the outstanding principal' using errcode = '22023'; end if;
  if p_first_emi is null then raise exception 'Choose the first EMI date' using errcode = '22023'; end if;
  if p_tenure is null or p_tenure < 1 then raise exception 'Enter the number of EMIs' using errcode = '22023'; end if;
  if coalesce(p_paid_before, 0) > p_tenure then raise exception 'EMIs already paid cannot be more than the total' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.fin_loans (name, lender, principal_paise, outstanding_paise, annual_rate, emi_paise, first_emi_date, tenure_months,
                                  paid_before, account_id, notes, created_by, updated_by)
    values (btrim(p_name), btrim(coalesce(p_lender, '')), p_principal, p_outstanding, p_rate, p_emi, p_first_emi, p_tenure,
            coalesce(p_paid_before, 0), p_account, btrim(coalesce(p_notes, '')), v_me, v_me)
    returning id into v_id;
    perform private.fin_event('loan', v_id, 'created', jsonb_build_object('name', btrim(p_name), 'emi', p_emi, 'tenure', p_tenure));
    perform private.fin_loan_sync(v_id);
    return v_id;
  end if;
  select * into v_old from public.fin_loans where id = p_id for update;
  if v_old.id is null or v_old.closed_at is not null then raise exception 'Loan not found' using errcode = 'P0002'; end if;
  update public.fin_loans
     set name = btrim(p_name), lender = btrim(coalesce(p_lender, '')), principal_paise = p_principal, outstanding_paise = p_outstanding,
         annual_rate = p_rate, emi_paise = p_emi, first_emi_date = p_first_emi, tenure_months = p_tenure, paid_before = coalesce(p_paid_before, 0),
         account_id = p_account, notes = btrim(coalesce(p_notes, '')), updated_by = v_me, updated_at = now()
   where id = p_id;
  -- EMIs not yet paid or started follow the new terms; paid ones stay as they were.
  update public.fin_payables p
     set amount_paise = p_emi, account_id = p_account, payee = btrim(coalesce(p_lender, '')),
         title = format('EMI %s of %s: %s', p.emi_no, p_tenure, btrim(p_name)),
         due_date = case when p.due_date = p.original_due_date then private.fin_step(p_first_emi, 'monthly', p.emi_no - 1) else p.due_date end,
         original_due_date = private.fin_step(p_first_emi, 'monthly', p.emi_no - 1),
         updated_by = v_me, updated_at = now()
   where p.loan_id = p_id and p.paid_paise = 0 and p.state in ('open', 'scheduled', 'on_hold');
  update public.fin_payables p set state = 'cancelled', state_reason = 'Outside the loan''s EMIs after its terms changed', updated_by = v_me, updated_at = now()
   where p.loan_id = p_id and p.paid_paise = 0 and p.state in ('open', 'scheduled', 'on_hold')
     and (p.emi_no > p_tenure or p.emi_no <= coalesce(p_paid_before, 0));
  perform private.fin_event('loan', p_id, 'updated', jsonb_build_object(
    'before', jsonb_build_object('emi', v_old.emi_paise, 'tenure', v_old.tenure_months, 'outstanding', v_old.outstanding_paise),
    'after', jsonb_build_object('emi', p_emi, 'tenure', p_tenure, 'outstanding', p_outstanding)));
  perform private.fin_loan_sync(p_id);
  return p_id;
end $$;

create or replace function public.fin_loan_close(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.fin_guard();
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason' using errcode = '22023'; end if;
  update public.fin_loans set closed_at = now(), closed_by = v_me, updated_by = v_me, updated_at = now() where id = p_id and closed_at is null;
  if not found then raise exception 'Loan not found' using errcode = 'P0002'; end if;
  update public.fin_payables set state = 'cancelled', state_reason = 'Loan closed: ' || btrim(p_reason), updated_by = v_me, updated_at = now()
   where loan_id = p_id and paid_paise = 0 and state in ('open', 'scheduled', 'on_hold');
  perform private.fin_event('loan', p_id, 'closed', jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- Keeps EMIs planned 90 days ahead and recurring payments' next occurrences in place. The finance
-- pages call it when they open; it only adds what is missing.
create or replace function public.fin_refresh()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_added integer := 0;
  r record;
begin
  perform private.fin_guard();
  for r in select id from public.fin_loans where closed_at is null loop
    v_added := v_added + private.fin_loan_sync(r.id);
  end loop;
  return v_added;
end $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.finance_access enable row level security;
alter table public.fin_settings enable row level security;
alter table public.fin_accounts enable row level security;
alter table public.fin_balances enable row level security;
alter table public.fin_loans enable row level security;
alter table public.fin_payables enable row level security;
alter table public.fin_receivables enable row level security;
alter table public.fin_transactions enable row level security;
alter table public.fin_events enable row level security;
revoke all on public.finance_access, public.fin_settings, public.fin_accounts, public.fin_balances, public.fin_loans, public.fin_payables,
  public.fin_receivables, public.fin_transactions, public.fin_events from anon, authenticated;
grant select on public.finance_access, public.fin_settings, public.fin_accounts, public.fin_balances, public.fin_loans, public.fin_payables,
  public.fin_receivables, public.fin_transactions, public.fin_events to authenticated;

create policy finance_access_read on public.finance_access for select to authenticated using (private.is_admin() or member_id = private.me());
create policy fin_settings_read on public.fin_settings for select to authenticated using (private.has_finance());
create policy fin_accounts_read on public.fin_accounts for select to authenticated using (private.has_finance());
create policy fin_balances_read on public.fin_balances for select to authenticated using (private.has_finance());
create policy fin_loans_read on public.fin_loans for select to authenticated using (private.has_finance());
create policy fin_payables_read on public.fin_payables for select to authenticated using (private.has_finance());
create policy fin_receivables_read on public.fin_receivables for select to authenticated using (private.has_finance());
create policy fin_transactions_read on public.fin_transactions for select to authenticated using (private.has_finance());
create policy fin_events_read on public.fin_events for select to authenticated using (private.has_finance());

revoke execute on function private.has_finance(), private.fin_guard(), private.fin_event(text, uuid, text, jsonb),
  private.fin_check_account(uuid), private.fin_step(date, text, integer), private.fin_loan_sync(uuid), private.fin_next_occurrence(uuid),
  private.members_finance_cleanup(), private.fin_check_category(text, text)
from public, anon;
grant execute on function private.has_finance(), private.fin_guard(), private.fin_event(text, uuid, text, jsonb),
  private.fin_check_account(uuid), private.fin_step(date, text, integer), private.fin_loan_sync(uuid), private.fin_next_occurrence(uuid),
  private.fin_check_category(text, text)
to authenticated;

revoke execute on function
  public.my_finance_access(), public.finance_set_access(uuid, boolean), public.fin_settings_save(bigint, bigint),
  public.fin_account_save(uuid, text, text, text, text, text, bigint, timestamptz), public.fin_account_set_archived(uuid, boolean),
  public.fin_balance_record(uuid, bigint, timestamptz, text),
  public.fin_txn_save(uuid, uuid, timestamptz, text, bigint, text, text, text, text), public.fin_txn_void(uuid, text),
  public.fin_payable_save(uuid, text, text, bigint, date, text, uuid, text, text, text, text),
  public.fin_payable_pay(uuid, bigint, date, uuid, text, text), public.fin_payable_reschedule(uuid, date, text),
  public.fin_payable_set_state(uuid, text, text),
  public.fin_receivable_save(uuid, text, text, text, text, bigint, date, uuid, text),
  public.fin_receivable_receive(uuid, bigint, date, uuid, text, text), public.fin_receivable_reschedule(uuid, date, text),
  public.fin_receivable_set_state(uuid, text, text),
  public.fin_loan_save(uuid, text, text, bigint, bigint, numeric, bigint, date, integer, integer, uuid, text),
  public.fin_loan_close(uuid, text), public.fin_refresh()
from public, anon;
grant execute on function
  public.my_finance_access(), public.finance_set_access(uuid, boolean), public.fin_settings_save(bigint, bigint),
  public.fin_account_save(uuid, text, text, text, text, text, bigint, timestamptz), public.fin_account_set_archived(uuid, boolean),
  public.fin_balance_record(uuid, bigint, timestamptz, text),
  public.fin_txn_save(uuid, uuid, timestamptz, text, bigint, text, text, text, text), public.fin_txn_void(uuid, text),
  public.fin_payable_save(uuid, text, text, bigint, date, text, uuid, text, text, text, text),
  public.fin_payable_pay(uuid, bigint, date, uuid, text, text), public.fin_payable_reschedule(uuid, date, text),
  public.fin_payable_set_state(uuid, text, text),
  public.fin_receivable_save(uuid, text, text, text, text, bigint, date, uuid, text),
  public.fin_receivable_receive(uuid, bigint, date, uuid, text, text), public.fin_receivable_reschedule(uuid, date, text),
  public.fin_receivable_set_state(uuid, text, text),
  public.fin_loan_save(uuid, text, text, bigint, bigint, numeric, bigint, date, integer, integer, uuid, text),
  public.fin_loan_close(uuid, text), public.fin_refresh()
to authenticated;
