'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireFinance } from '@/lib/session';
import { friendlyError, isIsoDate } from '@/lib/format';
import { parseRupees, zonedIso } from '@/lib/finance';
import { importSummary, parseStatement, type ImportCounts } from '@/lib/bank-statement';
import type { ActionState } from '@/lib/types';

const UUID = z.uuid();
const optionalId = z.preprocess((v) => (v === '' || v == null ? null : v), z.uuid().nullable());
const text = (max: number, msg?: string) => z.string().trim().max(max, msg ?? `Keep it under ${max} characters`).default('');
const date = (msg: string) => z.string().refine(isIsoDate, msg);
const time = z.preprocess((v) => (v === '' || v == null ? '12:00' : v), z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time like 14:30'));

/** Rupees typed by a person ("1,50,000" or "1500.50") as paise. */
function amount(label: string, opts: { allowZero?: boolean; allowNegative?: boolean } = {}) {
  return z.string().transform((v, ctx) => {
    const p = parseRupees(v);
    if (p === null) {
      ctx.addIssue({ code: 'custom', message: `Enter the ${label} in rupees, like 1,50,000` });
      return z.NEVER;
    }
    if (p < 0 && !opts.allowNegative) {
      ctx.addIssue({ code: 'custom', message: `The ${label} cannot be negative` });
      return z.NEVER;
    }
    if (p === 0 && !opts.allowZero) {
      ctx.addIssue({ code: 'custom', message: `Enter the ${label}: it must be above zero` });
      return z.NEVER;
    }
    return p;
  });
}

function done(paths: string[]) {
  for (const p of paths) revalidatePath(p, 'layout');
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { data: null, error: friendlyError(error.message) } : { data };
}

// ---------------------------------------------------------------------------
// Settings and accounts
// ---------------------------------------------------------------------------
export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z
    .object({ min_cash: amount('minimum cash', { allowZero: true }), large_debit: amount('large debit amount', { allowZero: true }) })
    .safeParse({ min_cash: formData.get('min_cash') || '0', large_debit: formData.get('large_debit') || '0' });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await rpc('fin_settings_save', { p_min_cash: parsed.data.min_cash, p_large_debit: parsed.data.large_debit });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Saved. Alerts use these amounts from now on.' };
}

const accountSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, 'Give the account a name').max(80, 'Keep the name under 80 characters'),
  bank: text(80),
  last4: z.string().trim().regex(/^(\d{4})?$/, 'Enter only the last 4 digits of the account number, or leave it empty').default(''),
  kind: z.enum(['current', 'savings', 'overdraft', 'credit_card', 'cash', 'other']),
  notes: text(500),
});

export async function saveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireFinance();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const a = parsed.data;
  let balance: number | null = null;
  let asOf: string | null = null;
  if (!a.id) {
    const b = amount('current balance', { allowZero: true, allowNegative: true }).safeParse(String(formData.get('balance') ?? ''));
    if (!b.success) return { error: b.error.issues[0].message };
    const d = String(formData.get('as_of_date') ?? '');
    if (!isIsoDate(d)) return { error: 'Choose the date of this balance' };
    const t = time.safeParse(formData.get('as_of_time'));
    if (!t.success) return { error: t.error.issues[0].message };
    balance = b.data;
    asOf = zonedIso(d, t.data, me.timezone);
  }
  const r = await rpc('fin_account_save', { p_id: a.id, p_name: a.name, p_bank: a.bank, p_last4: a.last4, p_kind: a.kind, p_notes: a.notes, p_balance: balance, p_as_of: asOf });
  if (r.error) return { error: r.error };
  done(['/finance']);
  if (!a.id) redirect('/finance/accounts?added=1');
  return { ok: 'Account saved.' };
}

export async function archiveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const id = UUID.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown account.' };
  const archived = formData.get('archived') !== '0';
  const r = await rpc('fin_account_set_archived', { p_id: id.data, p_archived: archived });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: archived ? 'Account removed from use. Its history is kept.' : 'Account back in use.' };
}

export async function linkCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const id = UUID.safeParse(formData.get('account'));
  if (!id.success) return { error: 'Bank account not found' };
  const last4 = String(formData.get('card_last4') ?? '').trim();
  if (!/^(\d{4})?$/.test(last4)) return { error: 'Enter only the last 4 digits of the card, or leave it empty' };
  const r = await rpc('fin_account_link_card', { p_account: id.data, p_last4: last4 });
  if (r.error) return { error: r.error };
  done(['/finance']);
  const n = Number(r.data ?? 0);
  if (!last4) return { ok: 'Card removed from this account.' };
  return { ok: n ? `Saved. ${n} bank email${n === 1 ? '' : 's'} for this card recorded; check them under Transactions.` : 'Saved. Alerts for this card now land in this account.' };
}

export async function recordBalanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireFinance();
  const parsed = z
    .object({ account: UUID, balance: amount('balance', { allowZero: true, allowNegative: true }), as_of_date: date('Choose the date of this balance'), as_of_time: time, note: text(300) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message === 'Invalid UUID' ? 'Choose a bank account' : parsed.error.issues[0].message };
  const b = parsed.data;
  const r = await rpc('fin_balance_record', { p_account: b.account, p_balance: b.balance, p_as_of: zonedIso(b.as_of_date, b.as_of_time, me.timezone), p_note: b.note });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Balance recorded. Transactions after this moment are added to it.' };
}

const STATEMENT_MAX_BYTES = 2_500_000;

/** A bank statement downloaded from net banking. The file is read here and not kept; only the facts reach the database. */
export async function importStatementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const id = UUID.safeParse(formData.get('account'));
  if (!id.success) return { error: 'Bank account not found' };
  const file = formData.get('statement');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose the statement file you downloaded from net banking' };
  if (file.size > STATEMENT_MAX_BYTES) return { error: 'This file is too big. Download a shorter period, such as 3 months, and upload that.' };
  const kind = /\.pdf$/i.test(file.name) ? 'a PDF' : /\.xlsx?$/i.test(file.name) ? 'an Excel file' : '';
  if (kind) return { error: `This is ${kind}. In net banking, download the statement in the Delimited format (a .txt file) and upload that.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.subarray(0, 8192).includes(0)) return { error: 'This is not a text file. In net banking, download the statement in the Delimited format and upload that.' };
  const parsed = parseStatement(new TextDecoder('utf-8').decode(bytes));
  if (parsed.problem) return { error: parsed.problem };
  const r = await rpc('fin_statement_import', { p_account: id.data, p_lines: parsed.lines });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: importSummary(r.data as ImportCounts) };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
const txnSchema = z.object({
  id: optionalId,
  account: z.uuid('Choose a bank account'),
  date: date('Choose the date'),
  time,
  direction: z.enum(['in', 'out'], 'Choose money in or money out'),
  amount: amount('amount'),
  category: z.string().min(1, 'Choose a category'),
  counterparty: text(120),
  description: text(500),
  reference: text(80),
});

export async function saveTxnAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireFinance();
  const parsed = txnSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const t = parsed.data;
  const r = await rpc('fin_txn_save', {
    p_id: t.id, p_account: t.account, p_at: zonedIso(t.date, t.time, me.timezone), p_direction: t.direction, p_amount: t.amount,
    p_category: t.category, p_counterparty: t.counterparty, p_description: t.description, p_reference: t.reference,
  });
  if (r.error) return { error: r.error };
  done(['/finance']);
  if (!t.id) redirect('/finance/transactions?added=1');
  return { ok: 'Transaction saved.' };
}

export async function voidTxnAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const id = UUID.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown transaction.' };
  const r = await rpc('fin_txn_void', { p_id: id.data, p_reason: String(formData.get('note') ?? '').slice(0, 300) });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Transaction undone. It stays in the history, crossed out.' };
}

// ---------------------------------------------------------------------------
// Payables
// ---------------------------------------------------------------------------
const payableSchema = z.object({
  id: optionalId,
  title: z.string().trim().min(1, 'Give the payment a title').max(120, 'Keep the title under 120 characters'),
  payee: text(120),
  amount: amount('amount'),
  due: z.string().default(''),
  category: z.string().min(1, 'Choose a category'),
  account: optionalId,
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'quarterly', 'yearly']).default('none'),
  penalty: text(300),
  notes: text(1000),
});

export async function savePayableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = payableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  if (!p.id && !isIsoDate(p.due)) return { error: 'Choose the due date' };
  const r = await rpc('fin_payable_save', {
    p_id: p.id, p_title: p.title, p_payee: p.payee, p_amount: p.amount, p_due: p.id ? null : p.due, p_category: p.category,
    p_account: p.account, p_priority: p.priority, p_recurrence: p.recurrence, p_penalty: p.penalty, p_notes: p.notes,
  });
  if (r.error) return { error: r.error };
  done(['/finance']);
  if (!p.id) redirect(`/finance/payables/${r.data}?added=1`);
  return { ok: 'Payment saved. The forecast now uses it.' };
}

export async function payPayableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z
    .object({ id: UUID, amount: amount('amount paid'), paid_on: date('Choose the date it was paid'), account: z.uuid('Choose the bank account it was paid from'), reference: text(80), note: text(300) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  const r = await rpc('fin_payable_pay', { p_id: p.id, p_amount: p.amount, p_paid_on: p.paid_on, p_account: p.account, p_reference: p.reference, p_note: p.note });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Payment recorded, and the bank transaction added.' };
}

export async function reschedulePayableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z.object({ id: UUID, due: date('Choose the new date'), reason: text(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await rpc('fin_payable_reschedule', { p_id: parsed.data.id, p_due: parsed.data.due, p_reason: parsed.data.reason });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Date changed. The forecast is updated.' };
}

export async function setPayableStateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z.object({ id: UUID, state: z.enum(['open', 'scheduled', 'on_hold', 'cancelled']), note: text(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await rpc('fin_payable_set_state', { p_id: parsed.data.id, p_state: parsed.data.state, p_reason: parsed.data.note });
  if (r.error) return { error: r.error };
  done(['/finance']);
  const msg = { open: 'Back to still to pay.', scheduled: 'Marked as scheduled.', on_hold: 'Put on hold. It is left out of the forecast until you resume it.', cancelled: 'Cancelled.' };
  return { ok: msg[parsed.data.state] };
}

// ---------------------------------------------------------------------------
// Receivables
// ---------------------------------------------------------------------------
const receivableSchema = z.object({
  id: optionalId,
  party: z.string().trim().min(1, 'Enter who is paying').max(120, 'Keep the name under 120 characters'),
  source: z.enum(['customer', 'marketplace', 'other']),
  reference: text(80),
  category: z.enum(['customer_receipt', 'marketplace_settlement', 'other_income']),
  amount: amount('expected amount'),
  expected: z.string().default(''),
  account: optionalId,
  notes: text(1000),
});

export async function saveReceivableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = receivableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (!v.id && !isIsoDate(v.expected)) return { error: 'Choose the expected date' };
  const r = await rpc('fin_receivable_save', {
    p_id: v.id, p_party: v.party, p_source: v.source, p_reference: v.reference, p_category: v.category, p_amount: v.amount,
    p_expected: v.id ? null : v.expected, p_account: v.account, p_notes: v.notes,
  });
  if (r.error) return { error: r.error };
  done(['/finance']);
  if (!v.id) redirect(`/finance/receivables/${r.data}?added=1`);
  return { ok: 'Receivable saved. The forecast now uses it.' };
}

export async function receiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z
    .object({ id: UUID, amount: amount('amount received'), received_on: date('Choose the date it arrived'), account: z.uuid('Choose the bank account it arrived in'), reference: text(80), note: text(300) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const r = await rpc('fin_receivable_receive', { p_id: v.id, p_amount: v.amount, p_received_on: v.received_on, p_account: v.account, p_reference: v.reference, p_note: v.note });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Receipt recorded, and the bank transaction added.' };
}

export async function rescheduleReceivableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z.object({ id: UUID, expected: date('Choose the new date'), reason: text(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await rpc('fin_receivable_reschedule', { p_id: parsed.data.id, p_expected: parsed.data.expected, p_reason: parsed.data.reason });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Expected date changed. The forecast is updated.' };
}

export async function setReceivableStateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = z.object({ id: UUID, state: z.enum(['open', 'disputed', 'written_off', 'cancelled']), note: text(300) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await rpc('fin_receivable_set_state', { p_id: parsed.data.id, p_state: parsed.data.state, p_reason: parsed.data.note });
  if (r.error) return { error: r.error };
  done(['/finance']);
  const msg = { open: 'Back to expected.', disputed: 'Marked as disputed. It is left out of the forecast.', written_off: 'Written off.', cancelled: 'Cancelled.' };
  return { ok: msg[parsed.data.state] };
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------
const loanSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, 'Give the loan a name').max(120, 'Keep the name under 120 characters'),
  lender: text(120),
  principal: amount('loan amount'),
  outstanding: amount('outstanding principal', { allowZero: true }),
  rate: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number('Enter the interest rate as a number, like 12.5').min(0).max(100, 'Enter a yearly rate up to 100%').nullable()),
  emi: amount('EMI amount'),
  first_emi: date('Choose the first EMI date'),
  tenure: z.coerce.number('Enter the number of EMIs').int('Enter a whole number of EMIs').min(1, 'Enter at least 1 EMI').max(600, 'Enter up to 600 EMIs'),
  paid_before: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().int().min(0, 'EMIs already paid cannot be negative')),
  account: optionalId,
  notes: text(1000),
});

export async function saveLoanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const parsed = loanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const l = parsed.data;
  const r = await rpc('fin_loan_save', {
    p_id: l.id, p_name: l.name, p_lender: l.lender, p_principal: l.principal, p_outstanding: l.outstanding, p_rate: l.rate, p_emi: l.emi,
    p_first_emi: l.first_emi, p_tenure: l.tenure, p_paid_before: l.paid_before, p_account: l.account, p_notes: l.notes,
  });
  if (r.error) return { error: r.error };
  done(['/finance']);
  if (!l.id) redirect(`/finance/loans/${r.data}?added=1`);
  return { ok: 'Loan saved. EMIs still to pay follow the new terms.' };
}

export async function closeLoanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const id = UUID.safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown loan.' };
  const r = await rpc('fin_loan_close', { p_id: id.data, p_reason: String(formData.get('note') ?? '').trim().slice(0, 300) });
  if (r.error) return { error: r.error };
  done(['/finance']);
  return { ok: 'Loan closed. Its unpaid EMIs are cancelled.' };
}
