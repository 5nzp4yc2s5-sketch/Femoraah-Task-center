// Cash Flow Command Centre: shared types, labels, money formatting and the cash forecast.
// Pure functions only, so the pages, the simulator and the tests use exactly the same rules.

export type Category =
  | 'inventory' | 'marketing' | 'salaries' | 'rent' | 'logistics' | 'vendor' | 'loan_emi' | 'credit_card' | 'taxes' | 'other_expense'
  | 'customer_receipt' | 'marketplace_settlement' | 'other_income' | 'transfer';

export const OUT_CATEGORIES: { key: Category; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'salaries', label: 'Salaries' },
  { key: 'rent', label: 'Rent' },
  { key: 'logistics', label: 'Logistics' },
  { key: 'vendor', label: 'Vendor payments' },
  { key: 'loan_emi', label: 'Loan EMI' },
  { key: 'credit_card', label: 'Credit card payments' },
  { key: 'taxes', label: 'Taxes' },
  { key: 'other_expense', label: 'Other operating expenses' },
];
export const IN_CATEGORIES: { key: Category; label: string }[] = [
  { key: 'customer_receipt', label: 'Customer receipts' },
  { key: 'marketplace_settlement', label: 'Marketplace settlements' },
  { key: 'other_income', label: 'Other income' },
];
export const TRANSFER: { key: Category; label: string } = { key: 'transfer', label: 'Transfer between own accounts' };
export const CATEGORY_LABELS = Object.fromEntries([...OUT_CATEGORIES, ...IN_CATEGORIES, TRANSFER].map((c) => [c.key, c.label])) as Record<Category, string>;
/** Payables can use every money-out category except EMIs, which come from loans. */
export const PAYABLE_CATEGORIES = OUT_CATEGORIES.filter((c) => c.key !== 'loan_emi');

export type PayPriority = 'critical' | 'high' | 'medium' | 'low';
export const PRIORITIES: { key: PayPriority; label: string; help: string }[] = [
  { key: 'critical', label: 'Critical', help: 'Cannot be delayed' },
  { key: 'high', label: 'High', help: 'Should be paid on time' },
  { key: 'medium', label: 'Medium', help: 'Can possibly be pushed' },
  { key: 'low', label: 'Low', help: 'Flexible' },
];
export const PRIORITY_LABELS = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label])) as Record<PayPriority, string>;
export const PRIORITY_RANK: Record<PayPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type Recurrence = 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export const RECURRENCES: { key: Recurrence; label: string }[] = [
  { key: 'none', label: 'One-time' },
  { key: 'weekly', label: 'Every week' },
  { key: 'monthly', label: 'Every month' },
  { key: 'quarterly', label: 'Every 3 months' },
  { key: 'yearly', label: 'Every year' },
];

export type AccountKind = 'current' | 'savings' | 'overdraft' | 'credit_card' | 'cash' | 'other';
export const ACCOUNT_KINDS: { key: AccountKind; label: string }[] = [
  { key: 'current', label: 'Current account' },
  { key: 'savings', label: 'Savings account' },
  { key: 'overdraft', label: 'Overdraft / cash credit' },
  { key: 'credit_card', label: 'Credit card' },
  { key: 'cash', label: 'Cash in hand' },
  { key: 'other', label: 'Other' },
];

export type ReceivableSource = 'customer' | 'marketplace' | 'other';
export const RECEIVABLE_SOURCES: { key: ReceivableSource; label: string }[] = [
  { key: 'customer', label: 'Customer' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'other', label: 'Other' },
];

export interface FinSettings { min_cash_paise: number; large_debit_paise: number }

export interface FinAccount {
  id: string;
  name: string;
  bank: string;
  last4: string;
  kind: AccountKind;
  notes: string;
  archived_at: string | null;
}

export interface FinBalance {
  id: string;
  account_id: string;
  as_of: string;
  balance_paise: number;
  source: 'manual' | 'gmail' | 'statement';
  note: string;
}

export interface FinTxn {
  id: string;
  account_id: string;
  txn_at: string;
  direction: 'in' | 'out';
  amount_paise: number;
  category: Category;
  counterparty: string;
  description: string;
  reference_no: string;
  source: 'manual' | 'gmail' | 'statement';
  review_status: 'confirmed' | 'needs_review';
  payable_id: string | null;
  receivable_id: string | null;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
}

export interface FinPayable {
  id: string;
  title: string;
  payee: string;
  amount_paise: number;
  paid_paise: number;
  due_date: string;
  original_due_date: string;
  category: Category;
  account_id: string | null;
  priority: PayPriority;
  state: 'open' | 'scheduled' | 'on_hold' | 'paid' | 'cancelled';
  recurrence: Recurrence;
  series_id: string;
  loan_id: string | null;
  emi_no: number | null;
  penalty: string;
  notes: string;
  state_reason: string;
  postpone_reason: string;
  updated_at: string;
}

export interface FinReceivable {
  id: string;
  party: string;
  source: ReceivableSource;
  reference_no: string;
  category: Category;
  amount_paise: number;
  received_paise: number;
  expected_date: string;
  original_expected_date: string;
  account_id: string | null;
  state: 'open' | 'disputed' | 'received' | 'written_off' | 'cancelled';
  notes: string;
  state_reason: string;
  delay_reason: string;
  updated_at: string;
}

export interface FinLoan {
  id: string;
  name: string;
  lender: string;
  principal_paise: number;
  outstanding_paise: number;
  annual_rate: number | null;
  emi_paise: number;
  first_emi_date: string;
  tenure_months: number;
  paid_before: number;
  account_id: string | null;
  notes: string;
  closed_at: string | null;
}

export interface FinEvent {
  id: string;
  entity: string;
  entity_id: string | null;
  action: string;
  actor_member_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹15,00,000 (Indian grouping). Paise are shown only when there are some, or when asked. */
export function inr(paise: number, opts: { paise?: boolean } = {}): string {
  const rupees = paise / 100;
  if (opts.paise || paise % 100 !== 0) return INR2.format(rupees);
  return INR0.format(rupees);
}

/** Short form for tight spaces: ₹15 L, ₹2.5 Cr, ₹45 K. */
export function inrShort(paise: number): string {
  const r = paise / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : '';
  const trim = (n: number) => (Math.round(n * 10) / 10).toString();
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)} K`;
  return `${sign}₹${Math.round(a)}`;
}

/** "1,50,000", "₹ 1,50,000.50" or "150000" → paise. Null when it is not an amount. */
export function parseRupees(input: string | null | undefined): number | null {
  const s = String(input ?? '').replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise)) return null;
  return s.startsWith('-') ? -paise : paise;
}

/** Paise as the plain rupee text a form field shows. */
export function rupeesField(paise: number | null | undefined): string {
  if (paise == null) return '';
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Dates (YYYY-MM-DD strings, compared as text)
// ---------------------------------------------------------------------------
export function todayIn(timeZone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function plusDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Same as Postgres date + interval 'n months': the day is kept, or the month's last day used. */
export function plusMonths(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function stepDate(d: string, r: Recurrence, n: number): string {
  if (r === 'weekly') return plusDays(d, 7 * n);
  if (r === 'monthly') return plusMonths(d, n);
  if (r === 'quarterly') return plusMonths(d, 3 * n);
  if (r === 'yearly') return plusMonths(d, 12 * n);
  return d;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Minutes the zone is ahead of UTC at a moment. */
function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** A local date and time in the company's time zone, as an ISO timestamp. */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const [h, mi] = (time || '12:00').split(':').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  const offset = zoneOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60_000).toISOString();
}

/** Local date and time of a timestamp in a time zone. */
export function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const at = new Date(iso);
  const date = todayIn(timeZone, at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return { date, time };
}

// ---------------------------------------------------------------------------
// Status shown to people
// ---------------------------------------------------------------------------
export type Tone = 'green' | 'amber' | 'red' | 'grey' | 'blue';

export function payableStatus(p: Pick<FinPayable, 'state' | 'paid_paise' | 'amount_paise' | 'due_date' | 'original_due_date'>, today: string): { key: string; label: string; tone: Tone } {
  if (p.state === 'paid') return { key: 'paid', label: 'Paid', tone: 'green' };
  if (p.state === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'grey' };
  if (p.state === 'on_hold') return { key: 'on_hold', label: 'On hold', tone: 'grey' };
  if (p.due_date < today) return { key: 'overdue', label: p.paid_paise > 0 ? 'Overdue, partly paid' : 'Overdue', tone: 'red' };
  if (p.paid_paise > 0) return { key: 'partial', label: 'Partially paid', tone: 'amber' };
  if (p.due_date === today) return { key: 'due_today', label: 'Due today', tone: 'amber' };
  if (p.state === 'scheduled') return { key: 'scheduled', label: 'Scheduled', tone: 'blue' };
  if (p.due_date > p.original_due_date) return { key: 'postponed', label: 'Postponed', tone: 'blue' };
  return { key: 'upcoming', label: 'Upcoming', tone: 'blue' };
}

export const PAYABLE_FILTERS = [
  { key: 'attention', label: 'Needs attention (overdue, due in 3 days, partial)' },
  { key: 'open', label: 'All still to pay' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'due_today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'partial', label: 'Partially paid' },
  { key: 'postponed', label: 'Postponed' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'Everything' },
] as const;

export function receivableStatus(r: Pick<FinReceivable, 'state' | 'received_paise' | 'expected_date'>, today: string): { key: string; label: string; tone: Tone } {
  if (r.state === 'received') return { key: 'received', label: 'Received', tone: 'green' };
  if (r.state === 'written_off') return { key: 'written_off', label: 'Written off', tone: 'grey' };
  if (r.state === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'grey' };
  if (r.state === 'disputed') return { key: 'disputed', label: 'Disputed', tone: 'red' };
  if (r.expected_date < today) return { key: 'overdue', label: r.received_paise > 0 ? 'Overdue, partly received' : 'Overdue', tone: 'red' };
  if (r.received_paise > 0) return { key: 'partial', label: 'Partially received', tone: 'amber' };
  if (r.expected_date === today) return { key: 'due', label: 'Due today', tone: 'amber' };
  return { key: 'expected', label: 'Expected', tone: 'blue' };
}

export const RECEIVABLE_FILTERS = [
  { key: 'open', label: 'All still to come' },
  { key: 'expected', label: 'Expected' },
  { key: 'due', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'partial', label: 'Partially received' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'received', label: 'Received' },
  { key: 'written_off', label: 'Written off' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'Everything' },
] as const;

export const TONE_BADGE: Record<Tone, string> = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-800',
  grey: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-800',
};

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------
export interface AccountBalance {
  account: FinAccount;
  balance: number;
  /** The reading it starts from. */
  reading: FinBalance | null;
  /** Confirmed transactions after the reading that it adds up. */
  movedSince: number;
  /** True when the latest reading came from a bank email rather than a person. */
  reported: boolean;
}

/** Each account's balance: its latest reading plus confirmed transactions after it. */
export function accountBalances(accounts: FinAccount[], readings: FinBalance[], txns: FinTxn[]): AccountBalance[] {
  return accounts.map((account) => {
    const reading = readings.filter((b) => b.account_id === account.id).sort((a, b) => b.as_of.localeCompare(a.as_of))[0] ?? null;
    const since = txns.filter(
      (t) => t.account_id === account.id && !t.voided_at && t.review_status === 'confirmed' && (!reading || Date.parse(t.txn_at) > Date.parse(reading.as_of)),
    );
    const net = since.reduce((s, t) => s + (t.direction === 'in' ? t.amount_paise : -t.amount_paise), 0);
    return { account, balance: (reading?.balance_paise ?? 0) + net, reading, movedSince: since.length, reported: reading?.source === 'gmail' };
  });
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------
export interface Flow {
  key: string;
  kind: 'payable' | 'emi' | 'recurring' | 'receivable' | 'what_if';
  title: string;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  priority?: PayPriority;
  /** The payable or receivable it comes from (absent for future occurrences and what-ifs). */
  sourceId?: string;
  /** Overdue money still owed is planned for today. */
  overdue?: boolean;
}

export interface ForecastDay {
  date: string;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  flows: Flow[];
}

export interface Forecast {
  days: ForecastDay[];
  lowest: { date: string; balance: number };
  firstBelowMin: string | null;
  firstNegative: string | null;
  inflow: number;
  outflow: number;
  closing: number;
}

/**
 * Money expected to move from today to `until`, from what is on record:
 * - payables still to pay (open or scheduled) on their due date; overdue ones today; on-hold ones left out;
 * - the next occurrences of recurring payments that are not on record yet;
 * - receivables still to come (not disputed) on their expected date; overdue ones are left out until
 *   someone gives them a new date, so the forecast never counts on money that is already late.
 */
export function expectedFlows(payables: FinPayable[], receivables: FinReceivable[], today: string, until: string): Flow[] {
  const flows: Flow[] = [];
  for (const p of payables) {
    if (p.state !== 'open' && p.state !== 'scheduled') continue;
    const left = p.amount_paise - p.paid_paise;
    if (left <= 0) continue;
    const overdue = p.due_date < today;
    const date = overdue ? today : p.due_date;
    if (date > until) continue;
    flows.push({ key: `p:${p.id}`, kind: p.loan_id ? 'emi' : 'payable', title: p.title, date, direction: 'out', amount: left, priority: p.priority, sourceId: p.id, overdue });
  }
  // Recurring series: repeat the latest occurrence on record until the horizon.
  const latest = new Map<string, FinPayable>();
  for (const p of payables) {
    if (p.recurrence === 'none' || p.loan_id || p.state === 'cancelled') continue;
    const cur = latest.get(p.series_id);
    if (!cur || p.original_due_date > cur.original_due_date) latest.set(p.series_id, p);
  }
  for (const p of latest.values()) {
    for (let n = 1; n < 400; n++) {
      const date = stepDate(p.original_due_date, p.recurrence, n);
      if (date > until) break;
      if (date < today) continue;
      flows.push({ key: `r:${p.series_id}:${date}`, kind: 'recurring', title: p.title, date, direction: 'out', amount: p.amount_paise, priority: p.priority });
    }
  }
  for (const r of receivables) {
    if (r.state !== 'open') continue;
    const left = r.amount_paise - r.received_paise;
    if (left <= 0 || r.expected_date < today || r.expected_date > until) continue;
    flows.push({ key: `c:${r.id}`, kind: 'receivable', title: r.party, date: r.expected_date, direction: 'in', amount: left, sourceId: r.id });
  }
  return flows.sort((a, b) => a.date.localeCompare(b.date) || (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1));
}

/** Day-by-day balance from `opening` today through `days` days ahead. */
export function forecast(opening: number, flows: Flow[], today: string, days: number, minCash = 0): Forecast {
  const out: ForecastDay[] = [];
  let bal = opening;
  let lowest = { date: today, balance: opening };
  let firstBelowMin: string | null = null;
  let firstNegative: string | null = null;
  let inflow = 0;
  let outflow = 0;
  const byDate = new Map<string, Flow[]>();
  for (const f of flows) byDate.set(f.date, [...(byDate.get(f.date) ?? []), f]);
  for (let i = 0; i <= days; i++) {
    const date = plusDays(today, i);
    const list = byDate.get(date) ?? [];
    const din = list.filter((f) => f.direction === 'in').reduce((s, f) => s + f.amount, 0);
    const dout = list.filter((f) => f.direction === 'out').reduce((s, f) => s + f.amount, 0);
    const opened = bal;
    bal = bal + din - dout;
    inflow += din;
    outflow += dout;
    out.push({ date, opening: opened, inflow: din, outflow: dout, closing: bal, flows: list });
    if (bal < lowest.balance) lowest = { date, balance: bal };
    if (firstBelowMin === null && minCash > 0 && bal < minCash) firstBelowMin = date;
    if (firstNegative === null && bal < 0) firstNegative = date;
  }
  return { days: out, lowest, firstBelowMin, firstNegative, inflow, outflow, closing: bal };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export interface CashAlert {
  key: string;
  tone: 'red' | 'amber';
  title: string;
  detail: string;
  href: string;
}

export function cashAlerts(input: {
  today: string;
  available: number;
  settings: FinSettings;
  payables: FinPayable[];
  receivables: FinReceivable[];
  recentTxns: FinTxn[];
  forecast30: Forecast;
  fmtDate: (d: string) => string;
  /** The local calendar day of a transaction time. */
  dayOf: (iso: string) => string;
}): CashAlert[] {
  const { today, available, settings, payables, receivables, recentTxns, forecast30, fmtDate, dayOf } = input;
  const alerts: CashAlert[] = [];
  if (forecast30.firstNegative) {
    alerts.push({
      key: 'deficit', tone: 'red', title: 'Cash runs out',
      detail: `On what is planned, the balance goes below zero on ${fmtDate(forecast30.firstNegative)} and reaches ${inr(forecast30.lowest.balance)} on ${fmtDate(forecast30.lowest.date)}.`,
      href: '/finance/payables?status=open',
    });
  } else if (forecast30.firstBelowMin) {
    alerts.push({
      key: 'below-min', tone: 'amber', title: 'Cash falls below your minimum',
      detail: `On what is planned, the balance drops under ${inr(settings.min_cash_paise)} on ${fmtDate(forecast30.firstBelowMin)} (lowest ${inr(forecast30.lowest.balance)}).`,
      href: '/finance/payables?status=open',
    });
  }
  if (settings.min_cash_paise > 0 && available < settings.min_cash_paise) {
    alerts.push({ key: 'low', tone: 'red', title: 'Low cash balance', detail: `${inr(available)} available, under your minimum of ${inr(settings.min_cash_paise)}.`, href: '/finance/accounts' });
  }
  const open = payables.filter((p) => p.state === 'open' || p.state === 'scheduled');
  for (const p of open.filter((p) => p.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    alerts.push({
      key: `over:${p.id}`, tone: 'red', title: p.loan_id ? 'EMI overdue' : 'Payment overdue',
      detail: `${p.title}: ${inr(p.amount_paise - p.paid_paise)} was due ${fmtDate(p.due_date)}.`, href: `/finance/payables/${p.id}`,
    });
  }
  for (const p of open.filter((p) => p.due_date >= today && (p.loan_id ? daysBetween(today, p.due_date) <= 7 : daysBetween(today, p.due_date) <= 3)).sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    alerts.push({
      key: `soon:${p.id}`, tone: 'amber', title: p.loan_id ? 'EMI coming up' : p.due_date === today ? 'Payment due today' : 'Payment due within 3 days',
      detail: `${p.title}: ${inr(p.amount_paise - p.paid_paise)} due ${p.due_date === today ? 'today' : fmtDate(p.due_date)}.`, href: `/finance/payables/${p.id}`,
    });
  }
  for (const r of receivables.filter((r) => r.state === 'open' && r.expected_date < today).sort((a, b) => a.expected_date.localeCompare(b.expected_date))) {
    alerts.push({
      key: `late:${r.id}`, tone: 'amber', title: 'Expected payment not received',
      detail: `${r.party}: ${inr(r.amount_paise - r.received_paise)} was expected ${fmtDate(r.expected_date)}. It is left out of the forecast until you give it a new date.`,
      href: `/finance/receivables/${r.id}`,
    });
  }
  if (settings.large_debit_paise > 0) {
    for (const t of recentTxns.filter((t) => !t.voided_at && t.direction === 'out' && t.category !== 'transfer' && !t.payable_id && t.amount_paise >= settings.large_debit_paise)) {
      alerts.push({
        key: `debit:${t.id}`, tone: 'amber', title: 'Large unplanned debit',
        detail: `${inr(t.amount_paise)} ${t.counterparty ? `to ${t.counterparty} ` : ''}on ${fmtDate(dayOf(t.txn_at))}, not linked to a planned payment.`,
        href: `/finance/transactions/${t.id}`,
      });
    }
  }
  return alerts;
}
