import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  accountBalances,
  expectedFlows,
  forecast,
  plusDays,
  todayIn,
  type Flow,
  type Forecast,
  type AccountBalance,
  type FinAccount,
  type FinBalance,
  type FinEvent,
  type FinLoan,
  type FinPayable,
  type FinReceivable,
  type FinSettings,
  type FinTxn,
} from '@/lib/finance';

type Client = Awaited<ReturnType<typeof createClient>>;

const num = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T => {
  const copy = { ...row };
  for (const k of keys) if (copy[k] != null) copy[k] = Number(copy[k]) as T[keyof T];
  return copy;
};

export async function loadSettings(supabase: Client): Promise<FinSettings> {
  const { data } = await supabase.from('fin_settings').select('min_cash_paise, large_debit_paise').maybeSingle();
  return { min_cash_paise: Number(data?.min_cash_paise ?? 0), large_debit_paise: Number(data?.large_debit_paise ?? 0) };
}

export async function loadAccounts(supabase: Client, includeArchived = false): Promise<FinAccount[]> {
  let q = supabase.from('fin_accounts').select('id, name, bank, last4, kind, notes, archived_at').order('created_at');
  if (!includeArchived) q = q.is('archived_at', null);
  const { data } = await q;
  return (data ?? []) as FinAccount[];
}

export async function loadReadings(supabase: Client, accountId?: string): Promise<FinBalance[]> {
  let q = supabase.from('fin_balances').select('id, account_id, as_of, balance_paise, source, note').is('voided_at', null).order('as_of', { ascending: false }).limit(2000);
  if (accountId) q = q.eq('account_id', accountId);
  const { data } = await q;
  return (data ?? []).map((b) => num(b, ['balance_paise'])) as FinBalance[];
}

const TXN_COLS = 'id, account_id, txn_at, direction, amount_paise, category, counterparty, description, reference_no, source, review_status, payable_id, receivable_id, voided_at, void_reason, created_at';

export async function loadTxns(supabase: Client, opts: { since?: string; until?: string; accountId?: string; payableId?: string; receivableId?: string; includeVoided?: boolean; limit?: number } = {}): Promise<FinTxn[]> {
  let q = supabase.from('fin_transactions').select(TXN_COLS).order('txn_at', { ascending: false }).limit(opts.limit ?? 5000);
  if (!opts.includeVoided) q = q.is('voided_at', null);
  if (opts.since) q = q.gte('txn_at', opts.since);
  if (opts.until) q = q.lt('txn_at', opts.until);
  if (opts.accountId) q = q.eq('account_id', opts.accountId);
  if (opts.payableId) q = q.eq('payable_id', opts.payableId);
  if (opts.receivableId) q = q.eq('receivable_id', opts.receivableId);
  const { data } = await q;
  return (data ?? []).map((t) => num(t, ['amount_paise'])) as FinTxn[];
}

const PAY_COLS = 'id, title, payee, amount_paise, paid_paise, due_date, original_due_date, category, account_id, priority, state, recurrence, series_id, loan_id, emi_no, penalty, notes, state_reason, postpone_reason, updated_at';

export async function loadPayables(supabase: Client, opts: { openOnly?: boolean; loanId?: string } = {}): Promise<FinPayable[]> {
  let q = supabase.from('fin_payables').select(PAY_COLS).order('due_date').limit(5000);
  if (opts.openOnly) q = q.in('state', ['open', 'scheduled', 'on_hold']);
  if (opts.loanId) q = q.eq('loan_id', opts.loanId);
  const { data } = await q;
  return (data ?? []).map((p) => num(p, ['amount_paise', 'paid_paise'])) as FinPayable[];
}

const REC_COLS = 'id, party, source, reference_no, category, amount_paise, received_paise, expected_date, original_expected_date, account_id, state, notes, state_reason, delay_reason, updated_at';

export async function loadReceivables(supabase: Client, opts: { openOnly?: boolean } = {}): Promise<FinReceivable[]> {
  let q = supabase.from('fin_receivables').select(REC_COLS).order('expected_date').limit(5000);
  if (opts.openOnly) q = q.in('state', ['open', 'disputed']);
  const { data } = await q;
  return (data ?? []).map((r) => num(r, ['amount_paise', 'received_paise'])) as FinReceivable[];
}

export async function loadLoans(supabase: Client, includeClosed = false): Promise<FinLoan[]> {
  let q = supabase.from('fin_loans').select('id, name, lender, principal_paise, outstanding_paise, annual_rate, emi_paise, first_emi_date, tenure_months, paid_before, account_id, notes, closed_at').order('created_at');
  if (!includeClosed) q = q.is('closed_at', null);
  const { data } = await q;
  return (data ?? []).map((l) => num(l, ['principal_paise', 'outstanding_paise', 'emi_paise', 'annual_rate'])) as FinLoan[];
}

export async function loadEvents(supabase: Client, entityId: string): Promise<FinEvent[]> {
  const { data } = await supabase.from('fin_events').select('id, entity, entity_id, action, actor_member_id, details, created_at').eq('entity_id', entityId).order('created_at', { ascending: false }).limit(100);
  return (data ?? []) as FinEvent[];
}

/** Current balances of the accounts in use, from their latest readings and the transactions after them. */
export async function loadBalances(supabase: Client): Promise<{ accounts: FinAccount[]; balances: AccountBalance[]; available: number }> {
  const [accounts, readings] = await Promise.all([loadAccounts(supabase), loadReadings(supabase)]);
  const latest = new Map<string, string>();
  for (const r of readings) if (!latest.has(r.account_id) || r.as_of > latest.get(r.account_id)!) latest.set(r.account_id, r.as_of);
  const since = [...latest.values()].sort()[0];
  const txns = since ? await loadTxns(supabase, { since }) : [];
  const balances = accountBalances(accounts, readings, txns);
  return { accounts, balances, available: balances.reduce((s, b) => s + b.balance, 0) };
}

/** Keeps planned EMIs in place; safe to call on every visit. */
export async function refreshPlans(supabase: Client): Promise<void> {
  await supabase.rpc('fin_refresh');
}

export function financeToday(timeZone: string): string {
  return todayIn(timeZone);
}

/** Everything the overview and the forecast need: balances, what is due, and the day-by-day projection. */
export async function loadPlan(supabase: Client, today: string, days: number) {
  await refreshPlans(supabase);
  const [settings, bal, payables, receivables] = await Promise.all([
    loadSettings(supabase),
    loadBalances(supabase),
    loadPayables(supabase),
    loadReceivables(supabase),
  ]);
  const flows: Flow[] = expectedFlows(payables, receivables, today, plusDays(today, days));
  const projection: Forecast = forecast(bal.available, flows, today, days, settings.min_cash_paise);
  return { settings, ...bal, payables, receivables, flows, projection };
}
