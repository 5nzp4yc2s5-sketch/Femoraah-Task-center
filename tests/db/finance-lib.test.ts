// Pure rules behind the Cash Flow pages: money parsing, statuses, balances, forecast and alerts.
// No database needed, but it lives with the other suites so `npx vitest run` picks it up.
import { describe, expect, it } from 'vitest';
import {
  accountBalances,
  cashAlerts,
  expectedFlows,
  forecast,
  inr,
  parseRupees,
  payableStatus,
  plusMonths,
  receivableStatus,
  zonedIso,
  type FinAccount,
  type FinPayable,
  type FinReceivable,
  type FinTxn,
} from '../../src/lib/finance';

const L = (rupees: number) => rupees * 100;

function payable(p: Partial<FinPayable>): FinPayable {
  return {
    id: p.id ?? 'p1', title: 'Pay', payee: '', amount_paise: 0, paid_paise: 0, due_date: '2026-11-10', original_due_date: p.due_date ?? '2026-11-10',
    category: 'vendor', account_id: null, priority: 'high', state: 'open', recurrence: 'none', series_id: p.id ?? 'p1', loan_id: null, emi_no: null,
    penalty: '', notes: '', state_reason: '', postpone_reason: '', updated_at: '', ...p,
  };
}

function receivable(r: Partial<FinReceivable>): FinReceivable {
  return {
    id: r.id ?? 'r1', party: 'Customer', source: 'customer', reference_no: '', category: 'customer_receipt', amount_paise: 0, received_paise: 0,
    expected_date: '2026-11-10', original_expected_date: r.expected_date ?? '2026-11-10', account_id: null, state: 'open', notes: '', state_reason: '',
    delay_reason: '', updated_at: '', ...r,
  };
}

describe('money', () => {
  it('reads rupees the way people type them', () => {
    expect(parseRupees('1,50,000')).toBe(L(150000));
    expect(parseRupees('₹ 4,00,000.5')).toBe(L(400000) + 50);
    expect(parseRupees('-25,000')).toBe(-L(25000));
    expect(parseRupees('Rs. 99')).toBe(L(99));
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
  it('shows Indian grouping', () => {
    expect(inr(L(1500000))).toBe('₹15,00,000');
    expect(inr(L(10) + 5)).toBe('₹10.05');
  });
  it('steps months like Postgres', () => {
    expect(plusMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(plusMonths('2026-11-05', 3)).toBe('2027-02-05');
  });
  it('turns a local date and time into the right moment', () => {
    expect(zonedIso('2026-11-03', '09:00', 'Asia/Kolkata')).toBe('2026-11-03T03:30:00.000Z');
  });
});

describe('statuses', () => {
  const today = '2026-11-10';
  it('payables', () => {
    expect(payableStatus(payable({ due_date: '2026-11-09' }), today).key).toBe('overdue');
    expect(payableStatus(payable({ due_date: today }), today).key).toBe('due_today');
    expect(payableStatus(payable({ due_date: '2026-11-20', paid_paise: 10, amount_paise: 100 }), today).key).toBe('partial');
    expect(payableStatus(payable({ due_date: '2026-11-20', original_due_date: '2026-11-12' }), today).key).toBe('postponed');
    expect(payableStatus(payable({ due_date: '2026-11-20', state: 'scheduled' }), today).key).toBe('scheduled');
    expect(payableStatus(payable({ due_date: '2026-11-01', state: 'on_hold' }), today).key).toBe('on_hold');
    expect(payableStatus(payable({ state: 'paid' }), today).tone).toBe('green');
  });
  it('receivables', () => {
    expect(receivableStatus(receivable({ expected_date: '2026-11-01' }), today).key).toBe('overdue');
    expect(receivableStatus(receivable({ expected_date: '2026-11-20', received_paise: 5 }), today).key).toBe('partial');
    expect(receivableStatus(receivable({ state: 'disputed' }), today).key).toBe('disputed');
  });
});

describe('balances', () => {
  it('start from the latest reading and add confirmed transactions after it', () => {
    const acc: FinAccount = { id: 'a', name: 'HDFC', bank: '', last4: '1234', card_last4: '', kind: 'current', notes: '', archived_at: null };
    const t = (id: string, at: string, dir: 'in' | 'out', amt: number, extra: Partial<FinTxn> = {}): FinTxn => ({
      id, account_id: 'a', txn_at: at, direction: dir, amount_paise: amt, category: 'vendor', counterparty: '', description: '', reference_no: '',
      source: 'manual', review_status: 'confirmed', payable_id: null, receivable_id: null, voided_at: null, void_reason: '', created_at: at, ...extra,
    });
    const [b] = accountBalances(
      [acc],
      [
        { id: 'r1', account_id: 'a', as_of: '2026-11-01T00:00:00Z', balance_paise: L(100), source: 'manual', note: '' },
        { id: 'r2', account_id: 'a', as_of: '2026-11-05T00:00:00Z', balance_paise: L(1000), source: 'gmail', note: '' },
      ],
      [
        t('t0', '2026-11-04T00:00:00Z', 'out', L(50)), // before the latest reading: already in it
        t('t1', '2026-11-06T00:00:00Z', 'out', L(200)),
        t('t2', '2026-11-07T00:00:00Z', 'in', L(30)),
        t('t3', '2026-11-07T00:00:00Z', 'out', L(999), { voided_at: '2026-11-08T00:00:00Z' }),
        t('t4', '2026-11-07T00:00:00Z', 'out', L(999), { review_status: 'needs_review' }),
      ],
    );
    expect(b.balance).toBe(L(830));
    expect(b.movedSince).toBe(2);
    expect(b.reported).toBe(true);
  });
});

describe('forecast', () => {
  const today = '2026-11-03';
  // Kartik's example: ₹15L in the bank; Vendor A ₹4L, Vendor B ₹2L, EMI ₹1.5L, marketing ₹2L.
  const payables = [
    payable({ id: 'a', title: 'Vendor A', amount_paise: L(400000), due_date: '2026-11-05' }),
    payable({ id: 'b', title: 'Vendor B', amount_paise: L(200000), due_date: '2026-11-10', priority: 'medium' }),
    payable({ id: 'e', title: 'EMI', amount_paise: L(150000), due_date: '2026-11-07', loan_id: 'loan', emi_no: 3, priority: 'critical', category: 'loan_emi' }),
    payable({ id: 'm', title: 'Marketing', amount_paise: L(200000), due_date: '2026-11-15', priority: 'low', category: 'marketing' }),
  ];

  it('runs the balance day by day and finds the low point', () => {
    const flows = expectedFlows(payables, [], today, '2026-12-03');
    const f = forecast(L(1500000), flows, today, 30, L(600000));
    expect(f.outflow).toBe(L(950000));
    expect(f.closing).toBe(L(550000));
    expect(f.lowest).toEqual({ date: '2026-11-15', balance: L(550000) });
    expect(f.firstBelowMin).toBe('2026-11-15');
    expect(f.firstNegative).toBeNull();
    expect(f.days).toHaveLength(31);
  });

  it('counts overdue payables today, leaves out holds, and only counts what is left', () => {
    const flows = expectedFlows(
      [
        payable({ id: 'x', amount_paise: L(100), paid_paise: L(40), due_date: '2026-10-30' }),
        payable({ id: 'y', amount_paise: L(100), due_date: '2026-11-05', state: 'on_hold' }),
        payable({ id: 'z', amount_paise: L(100), due_date: '2026-11-05', state: 'paid', paid_paise: L(100) }),
      ],
      [],
      today,
      '2026-12-03',
    );
    expect(flows).toEqual([expect.objectContaining({ key: 'p:x', date: today, amount: L(60), overdue: true })]);
  });

  it('repeats recurring payments from the latest occurrence on record', () => {
    const flows = expectedFlows(
      [
        payable({ id: 'r1', series_id: 's', recurrence: 'monthly', amount_paise: L(50000), due_date: '2026-10-01', original_due_date: '2026-10-01', state: 'paid', paid_paise: L(50000) }),
        payable({ id: 'r2', series_id: 's', recurrence: 'monthly', amount_paise: L(50000), due_date: '2026-11-01', original_due_date: '2026-11-01' }),
      ],
      [],
      today,
      '2027-01-31',
    );
    expect(flows.map((f) => [f.key, f.date])).toEqual([
      ['p:r2', today],
      ['r:s:2026-12-01', '2026-12-01'],
      ['r:s:2027-01-01', '2027-01-01'],
    ]);
  });

  it('counts receivables on their date but never late or disputed ones', () => {
    const flows = expectedFlows(
      [],
      [
        receivable({ id: 'ok', amount_paise: L(300000), received_paise: L(100000), expected_date: '2026-11-08' }),
        receivable({ id: 'late', amount_paise: L(1), expected_date: '2026-11-01' }),
        receivable({ id: 'disp', amount_paise: L(1), expected_date: '2026-11-08', state: 'disputed' }),
      ],
      today,
      '2026-12-03',
    );
    expect(flows).toEqual([expect.objectContaining({ key: 'c:ok', direction: 'in', amount: L(200000) })]);
  });

  it('flags the day cash goes below zero', () => {
    const flows = expectedFlows(payables, [], today, '2026-12-03');
    const f = forecast(L(700000), flows, today, 30);
    expect(f.firstNegative).toBe('2026-11-10');
    expect(f.lowest.balance).toBe(-L(250000));
  });
});

describe('alerts', () => {
  const today = '2026-11-03';
  const fmt = (d: string) => d;
  const dayOf = (iso: string) => iso.slice(0, 10);

  it('warns about deficits, overdue and upcoming payments, late money and large unplanned debits', () => {
    const payables = [
      payable({ id: 'over', title: 'Rent', amount_paise: L(50000), due_date: '2026-11-01' }),
      payable({ id: 'soon', title: 'Vendor', amount_paise: L(10000), due_date: '2026-11-05' }),
      payable({ id: 'later', title: 'Later', amount_paise: L(10000), due_date: '2026-11-20' }),
      payable({ id: 'emi', title: 'EMI', amount_paise: L(150000), due_date: '2026-11-09', loan_id: 'l', category: 'loan_emi' }),
    ];
    const receivables = [receivable({ id: 'late', party: 'Myntra', amount_paise: L(20000), expected_date: '2026-11-02' })];
    const txn = (id: string, extra: Partial<FinTxn>): FinTxn => ({
      id, account_id: 'a', txn_at: '2026-11-02T10:00:00Z', direction: 'out', amount_paise: L(200000), category: 'other_expense', counterparty: 'X',
      description: '', reference_no: '', source: 'manual', review_status: 'confirmed', payable_id: null, receivable_id: null, voided_at: null,
      void_reason: '', created_at: '', ...extra,
    });
    const recentTxns = [txn('big', {}), txn('planned', { payable_id: 'p' }), txn('move', { category: 'transfer' }), txn('small', { amount_paise: L(10) })];
    const settings = { min_cash_paise: L(100000), large_debit_paise: L(100000) };
    const f = forecast(L(200000), expectedFlows(payables, receivables, today, '2026-12-03'), today, 30, settings.min_cash_paise);
    const keys = cashAlerts({ today, available: L(200000), settings, payables, receivables, recentTxns, forecast30: f, fmtDate: fmt, dayOf }).map((a) => a.key);
    expect(keys).toEqual(['deficit', 'over:over', 'soon:soon', 'soon:emi', 'late:late', 'debit:big']);
  });

  it('says nothing when all is well', () => {
    const f = forecast(L(100000), [], today, 30);
    expect(cashAlerts({ today, available: L(100000), settings: { min_cash_paise: 0, large_debit_paise: 0 }, payables: [], receivables: [], recentTxns: [], forecast30: f, fmtDate: fmt, dayOf })).toEqual([]);
  });
});
