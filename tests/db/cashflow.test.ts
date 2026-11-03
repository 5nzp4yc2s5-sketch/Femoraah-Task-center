import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, login, memberId, provision, resetData } from './helpers';

// Cash Flow Command Centre, phase 1: access, bank accounts, transactions, payables, receivables, loans.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};
const L = (rupees: number) => rupees * 100; // amounts are paise

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}
async function today(): Promise<string> {
  return (await sql<{ d: string }>('select private.today()::text as d'))[0].d;
}
async function plusDays(n: number): Promise<string> {
  return (await sql<{ d: string }>('select (private.today() + $1::int)::text as d', [n]))[0].d;
}

async function account(c: SupabaseClient, name = 'HDFC Current', balance = L(1500000)): Promise<string> {
  const { data, error } = await c.rpc('fin_account_save', {
    p_id: null, p_name: name, p_bank: 'HDFC Bank', p_last4: '4321', p_kind: 'current', p_notes: '', p_balance: balance,
    p_as_of: new Date(Date.now() - 3_600_000).toISOString(),
  });
  expect(error).toBeNull();
  return data as string;
}

function payableArgs(over: Record<string, unknown> = {}) {
  return {
    p_id: null, p_title: 'Vendor A invoice', p_payee: 'Vendor A', p_amount: L(400000), p_due: null, p_category: 'vendor',
    p_account: null, p_priority: 'high', p_recurrence: 'none', p_penalty: '', p_notes: '', ...over,
  };
}

beforeAll(async () => {
  await resetData();
  for (const n of TEAM) await provision(n);
  for (const n of TEAM) ids[n] = await memberId(n);
}, 60_000);

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await resetData();
  await db.end();
});

describe('finance access', () => {
  it('opens Finance to the Super Admin only, until the Super Admin gives someone Finance access', async () => {
    const k = await login('Kartik');
    expect((await k.rpc('my_finance_access')).data).toBe(true);
    const acct = await account(k);

    await db.query(`update public.members set access_role = 'manager' where name = 'Shruti'`);
    for (const name of ['Shruti', 'Zinia']) {
      const c = await login(name);
      expect((await c.rpc('my_finance_access')).data).toBe(false);
      expect((await c.from('fin_accounts').select('id')).data).toEqual([]);
      expect((await c.from('fin_balances').select('id')).data).toEqual([]);
      expect((await c.from('fin_events').select('id')).data).toEqual([]);
      expect((await c.rpc('fin_account_save', { p_id: null, p_name: 'X', p_bank: '', p_last4: '', p_kind: 'current', p_notes: '', p_balance: 1, p_as_of: null })).error?.code).toBe('42501');
      expect((await c.rpc('fin_balance_record', { p_account: acct, p_balance: 1, p_as_of: null, p_note: '' })).error?.code).toBe('42501');
      expect((await c.rpc('finance_set_access', { p_member: ids[name], p_on: true })).error?.code).toBe('42501');
      expect((await c.from('fin_accounts').insert({ name: 'Direct' })).error).not.toBeNull();
    }

    // Finance access works for any role and only the Super Admin gives it.
    expect((await k.rpc('finance_set_access', { p_member: ids.Zinia, p_on: true })).error).toBeNull();
    const z = await login('Zinia');
    expect((await z.rpc('my_finance_access')).data).toBe(true);
    expect((await z.from('fin_accounts').select('name')).data).toEqual([{ name: 'HDFC Current' }]);
    expect((await z.rpc('finance_set_access', { p_member: ids.Dev, p_on: true })).error?.code).toBe('42501');
    const s = await login('Shruti');
    expect((await s.rpc('my_finance_access')).data).toBe(false);

    // Taking it away, or deactivating the person, closes it again and keeps the history.
    expect((await k.rpc('finance_set_access', { p_member: ids.Zinia, p_on: false })).error).toBeNull();
    expect((await z.rpc('my_finance_access')).data).toBe(false);
    expect((await k.rpc('finance_set_access', { p_member: ids.Zinia, p_on: true })).error).toBeNull();
    await db.query(`update public.members set is_active = false where name = 'Zinia'`);
    const rows = await sql<{ revoked: boolean }>('select revoked_at is not null as revoked from public.finance_access where member_id = $1 order by granted_at', [ids.Zinia]);
    expect(rows.map((r) => r.revoked)).toEqual([true, true]);
    const ev = await sql<{ action: string }>(`select action from public.fin_events where entity = 'finance_access' order by created_at`);
    expect(ev.map((e) => e.action)).toEqual(['granted', 'removed', 'granted', 'removed']);
  });
});

describe('alert settings', () => {
  it('saves the minimum cash and large-debit amounts through the API, for Finance people only', async () => {
    const k = await login('Kartik');
    const { error } = await k.rpc('fin_settings_save', { p_min_cash: L(600000), p_large_debit: L(100000) });
    expect(error).toBeNull();
    expect(await sql('select min_cash_paise::bigint::text as m, large_debit_paise::bigint::text as d from public.fin_settings')).toEqual([{ m: String(L(600000)), d: String(L(100000)) }]);
    expect((await k.rpc('fin_settings_save', { p_min_cash: -1, p_large_debit: 0 })).error?.message).toBe('Amounts cannot be negative');
    const z = await login('Zinia');
    expect((await z.rpc('fin_settings_save', { p_min_cash: 0, p_large_debit: 0 })).error?.code).toBe('42501');
    expect(await sql(`select action from public.fin_events where entity = 'settings'`)).toEqual([{ action: 'updated' }]);
  });
});

describe('bank accounts and transactions', () => {
  it('keeps balances from readings plus confirmed transactions, refuses duplicates and voids instead of deleting', async () => {
    const k = await login('Kartik');
    const acct = await account(k);
    const bad = await k.rpc('fin_account_save', { p_id: null, p_name: 'Bad', p_bank: '', p_last4: '123456', p_kind: 'current', p_notes: '', p_balance: 1, p_as_of: null });
    expect(bad.error).not.toBeNull(); // only the last 4 digits are kept

    const now = new Date().toISOString();
    const t1 = await k.rpc('fin_txn_save', { p_id: null, p_account: acct, p_at: now, p_direction: 'in', p_amount: L(50000), p_category: 'marketplace_settlement', p_counterparty: 'Myntra', p_description: 'Weekly settlement', p_reference: 'UTR123' });
    expect(t1.error).toBeNull();
    const dup = await k.rpc('fin_txn_save', { p_id: null, p_account: acct, p_at: now, p_direction: 'in', p_amount: L(50000), p_category: 'marketplace_settlement', p_counterparty: 'Myntra', p_description: '', p_reference: 'utr123' });
    expect(dup.error?.code).toBe('23505');
    const wrong = await k.rpc('fin_txn_save', { p_id: null, p_account: acct, p_at: now, p_direction: 'out', p_amount: L(1), p_category: 'customer_receipt', p_counterparty: '', p_description: '', p_reference: '' });
    expect(wrong.error?.code).toBe('22023');
    const t2 = await k.rpc('fin_txn_save', { p_id: null, p_account: acct, p_at: now, p_direction: 'out', p_amount: L(20000), p_category: 'marketing', p_counterparty: 'Meta', p_description: 'Ads', p_reference: '' });
    expect(t2.error).toBeNull();

    // Correcting the category keeps the row and records before and after.
    const fix = await k.rpc('fin_txn_save', { p_id: t2.data, p_account: acct, p_at: now, p_direction: 'out', p_amount: L(20000), p_category: 'logistics', p_counterparty: 'Meta', p_description: 'Ads', p_reference: '' });
    expect(fix.error).toBeNull();
    expect((await k.rpc('fin_txn_void', { p_id: t1.data, p_reason: 'Entered twice' })).error).toBeNull();
    const rows = await sql<{ category: string; voided: boolean }>('select category, voided_at is not null as voided from public.fin_transactions order by created_at');
    expect(rows).toEqual([{ category: 'marketplace_settlement', voided: true }, { category: 'logistics', voided: false }]);
    // The reference can be used again once the first entry is voided.
    expect((await k.rpc('fin_txn_save', { p_id: null, p_account: acct, p_at: now, p_direction: 'in', p_amount: L(50000), p_category: 'marketplace_settlement', p_counterparty: 'Myntra', p_description: '', p_reference: 'UTR123' })).error).toBeNull();
    expect((await k.rpc('fin_balance_record', { p_account: acct, p_balance: L(1530000), p_as_of: now, p_note: 'From net banking' })).error).toBeNull();
    const bal = await sql<{ n: number }>('select count(*)::int as n from public.fin_balances where account_id = $1', [acct]);
    expect(bal[0].n).toBe(2);
  });
});

describe('payables', () => {
  it('pays in parts, records each bank transaction, rolls a recurring payment forward once and can be undone', async () => {
    const k = await login('Kartik');
    const acct = await account(k);
    const due = await today();
    const add = await k.rpc('fin_payable_save', payableArgs({ p_title: 'Office rent', p_payee: 'Landlord', p_amount: L(500000), p_due: due, p_category: 'rent', p_account: acct, p_priority: 'critical', p_recurrence: 'monthly' }));
    expect(add.error).toBeNull();
    const id = add.data as string;

    expect((await k.rpc('fin_payable_pay', { p_id: id, p_amount: L(600000), p_paid_on: due, p_account: null, p_reference: '', p_note: '' })).error?.code).toBe('22023');
    const part = await k.rpc('fin_payable_pay', { p_id: id, p_amount: L(200000), p_paid_on: due, p_account: null, p_reference: 'NEFT1', p_note: 'First part' });
    expect(part.error).toBeNull();
    let p = (await sql<{ paid_paise: string; state: string }>('select paid_paise, state from public.fin_payables where id = $1', [id]))[0];
    expect([Number(p.paid_paise), p.state]).toEqual([L(200000), 'open']);
    expect((await sql('select 1 from public.fin_payables where series_id = (select series_id from public.fin_payables where id = $1)', [id])).length).toBe(1);

    const rest = await k.rpc('fin_payable_pay', { p_id: id, p_amount: L(300000), p_paid_on: due, p_account: null, p_reference: 'NEFT2', p_note: '' });
    expect(rest.error).toBeNull();
    p = (await sql<{ paid_paise: string; state: string }>('select paid_paise, state from public.fin_payables where id = $1', [id]))[0];
    expect(p.state).toBe('paid');
    const next = await sql<{ due_date: string; state: string }>(
      `select due_date::text, state from public.fin_payables where series_id = (select series_id from public.fin_payables where id = $1) and id <> $1`, [id]);
    expect(next).toEqual([{ due_date: (await sql<{ d: string }>(`select (private.today() + interval '1 month')::date::text as d`))[0].d, state: 'open' }]);
    const txns = await sql<{ amount_paise: string; direction: string; category: string }>('select amount_paise, direction, category from public.fin_transactions where payable_id = $1 order by created_at', [id]);
    expect(txns.map((t) => [Number(t.amount_paise), t.direction, t.category])).toEqual([[L(200000), 'out', 'rent'], [L(300000), 'out', 'rent']]);

    // Undoing the second payment re-opens the payable with what is still owed.
    const second = (await sql<{ id: string }>(`select id from public.fin_transactions where reference_no = 'NEFT2'`))[0].id;
    expect((await k.rpc('fin_txn_void', { p_id: second, p_reason: 'Bounced' })).error).toBeNull();
    p = (await sql<{ paid_paise: string; state: string }>('select paid_paise, state from public.fin_payables where id = $1', [id]))[0];
    expect([Number(p.paid_paise), p.state]).toEqual([L(200000), 'open']);
    // Paying it again does not create a second next occurrence.
    expect((await k.rpc('fin_payable_pay', { p_id: id, p_amount: L(300000), p_paid_on: due, p_account: null, p_reference: 'NEFT3', p_note: '' })).error).toBeNull();
    expect((await sql('select 1 from public.fin_payables where series_id = (select series_id from public.fin_payables where id = $1)', [id])).length).toBe(2);
  });

  it('postpones with a reason, holds and cancels only with a reason, and never pays a closed payment', async () => {
    const k = await login('Kartik');
    const acct = await account(k);
    const id = (await k.rpc('fin_payable_save', payableArgs({ p_due: await plusDays(3), p_account: acct }))).data as string;
    expect((await k.rpc('fin_payable_reschedule', { p_id: id, p_due: await plusDays(18), p_reason: '' })).error?.code).toBe('22023');
    expect((await k.rpc('fin_payable_reschedule', { p_id: id, p_due: await plusDays(18), p_reason: 'Agreed with vendor' })).error).toBeNull();
    const p = (await sql<{ due: string; orig: string; postpone_reason: string }>('select due_date::text as due, original_due_date::text as orig, postpone_reason from public.fin_payables where id = $1', [id]))[0];
    expect(p).toEqual({ due: await plusDays(18), orig: await plusDays(3), postpone_reason: 'Agreed with vendor' });
    expect((await k.rpc('fin_payable_set_state', { p_id: id, p_state: 'on_hold', p_reason: '' })).error?.code).toBe('22023');
    expect((await k.rpc('fin_payable_set_state', { p_id: id, p_state: 'on_hold', p_reason: 'Quality issue' })).error).toBeNull();
    expect((await k.rpc('fin_payable_set_state', { p_id: id, p_state: 'cancelled', p_reason: 'Order returned' })).error).toBeNull();
    expect((await k.rpc('fin_payable_pay', { p_id: id, p_amount: L(1), p_paid_on: await today(), p_account: acct, p_reference: '', p_note: '' })).error?.code).toBe('22023');
    const ev = await sql<{ action: string }>(`select action from public.fin_events where entity_id = $1 order by created_at`, [id]);
    expect(ev.map((e) => e.action)).toEqual(['created', 'postponed', 'status_on_hold', 'status_cancelled']);
    // An EMI can only come from a loan.
    expect((await k.rpc('fin_payable_save', payableArgs({ p_due: await today(), p_category: 'loan_emi' }))).error?.code).toBe('22023');
  });
});

describe('receivables', () => {
  it('receives in parts into a bank account and closes when everything has arrived', async () => {
    const k = await login('Kartik');
    const acct = await account(k);
    const id = (await k.rpc('fin_receivable_save', {
      p_id: null, p_party: 'Myntra', p_source: 'marketplace', p_reference: 'SET-1001', p_category: 'marketplace_settlement',
      p_amount: L(300000), p_expected: await today(), p_account: acct, p_notes: '',
    })).data as string;
    expect((await k.rpc('fin_receivable_receive', { p_id: id, p_amount: L(100000), p_received_on: await today(), p_account: null, p_reference: 'UTR9', p_note: '' })).error).toBeNull();
    let r = (await sql<{ received_paise: string; state: string }>('select received_paise, state from public.fin_receivables where id = $1', [id]))[0];
    expect([Number(r.received_paise), r.state]).toEqual([L(100000), 'open']);
    expect((await k.rpc('fin_receivable_reschedule', { p_id: id, p_expected: await plusDays(7), p_reason: 'Settlement cycle moved' })).error).toBeNull();
    expect((await k.rpc('fin_receivable_set_state', { p_id: id, p_state: 'disputed', p_reason: 'Returns deducted' })).error).toBeNull();
    expect((await k.rpc('fin_receivable_receive', { p_id: id, p_amount: L(200000), p_received_on: await today(), p_account: null, p_reference: 'UTR10', p_note: '' })).error).toBeNull();
    r = (await sql<{ received_paise: string; state: string }>('select received_paise, state from public.fin_receivables where id = $1', [id]))[0];
    expect([Number(r.received_paise), r.state]).toEqual([L(300000), 'received']);
    const t = await sql<{ direction: string; n: number }>('select direction, count(*)::int as n from public.fin_transactions where receivable_id = $1 group by 1', [id]);
    expect(t).toEqual([{ direction: 'in', n: 2 }]);
  });
});

describe('loans and EMIs', () => {
  it('plans EMIs 90 days ahead once each, skips ones paid before, reduces the principal on payment and follows new terms', async () => {
    const k = await login('Kartik');
    const acct = await account(k);
    const first = (await sql<{ d: string }>(`select (private.today() - interval '2 months')::date::text as d`))[0].d;
    const add = await k.rpc('fin_loan_save', {
      p_id: null, p_name: 'Working capital', p_lender: 'Bajaj Finance', p_principal: L(1000000), p_outstanding: L(900000), p_rate: 12,
      p_emi: L(150000), p_first_emi: first, p_tenure: 12, p_paid_before: 2, p_account: acct, p_notes: '',
    });
    expect(add.error).toBeNull();
    const loan = add.data as string;
    const emis = await sql<{ emi_no: number; priority: string; category: string }>('select emi_no, priority, category from public.fin_payables where loan_id = $1 order by emi_no', [loan]);
    expect(emis[0]).toEqual({ emi_no: 3, priority: 'critical', category: 'loan_emi' });
    const expected = (await sql<{ n: number }>(
      `select count(*)::int as n from generate_series(3, 12) g where ($1::date + make_interval(months => g - 1))::date <= private.today() + 90`, [first]))[0].n;
    expect(emis.length).toBe(expected);
    expect((await k.rpc('fin_refresh')).data).toBe(0);
    expect((await sql('select 1 from public.fin_payables where loan_id = $1', [loan])).length).toBe(expected);

    // Paying EMI 3 takes the interest share (1% a month) off before reducing the principal.
    const emi3 = (await sql<{ id: string }>('select id from public.fin_payables where loan_id = $1 and emi_no = 3', [loan]))[0].id;
    expect((await k.rpc('fin_payable_pay', { p_id: emi3, p_amount: L(150000), p_paid_on: await today(), p_account: null, p_reference: '', p_note: '' })).error).toBeNull();
    const out = (await sql<{ o: string }>('select outstanding_paise as o from public.fin_loans where id = $1', [loan]))[0].o;
    expect(Number(out)).toBe(L(900000) - (L(150000) - L(9000)));

    // New EMI amount applies to unpaid EMIs only; closing the loan cancels the unpaid ones.
    expect((await k.rpc('fin_loan_save', {
      p_id: loan, p_name: 'Working capital', p_lender: 'Bajaj Finance', p_principal: L(1000000), p_outstanding: L(759000), p_rate: 12,
      p_emi: L(140000), p_first_emi: first, p_tenure: 12, p_paid_before: 2, p_account: acct, p_notes: '',
    })).error).toBeNull();
    const amounts = await sql<{ emi_no: number; amount_paise: string }>('select emi_no, amount_paise from public.fin_payables where loan_id = $1 order by emi_no', [loan]);
    expect(Number(amounts[0].amount_paise)).toBe(L(150000));
    expect(amounts.slice(1).every((a) => Number(a.amount_paise) === L(140000))).toBe(true);
    expect((await k.rpc('fin_loan_close', { p_id: loan, p_reason: 'Prepaid' })).error).toBeNull();
    const states = await sql<{ state: string; n: number }>('select state, count(*)::int as n from public.fin_payables where loan_id = $1 group by 1 order by 1', [loan]);
    expect(states).toEqual([{ state: 'cancelled', n: expected - 1 }, { state: 'paid', n: 1 }]);
  });
});
