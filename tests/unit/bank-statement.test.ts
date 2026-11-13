import { describe, expect, it } from 'vitest';
import { cleanRef, importSummary, parseStatement, readNarration, statementAmount, statementDate } from '../../src/lib/bank-statement';
import { balanceGaps, type FinBalance, type FinTxn } from '../../src/lib/finance';

// Laid out like HDFC's "Delimited" statement download (comma separated, padded with spaces). The
// names, numbers and amounts are made up for the test; this is not a copy of a real statement.
const pad = (cells: string[]) => cells.map((c, i) => c.padEnd([10, 70, 9, 18, 18, 17, 18][i] ?? 10)).join(',');
const HEADER = pad(['Date', 'Narration', 'Value Dat', 'Debit Amount', 'Credit Amount', 'Chq/Ref Number', 'Closing Balance']);
const L = {
  upiOut: pad([' 02/11/26', 'UPI-VENDOR B PACKAGING-VENDORB@OKHDFCBANK-HDFC0001234-530912345678-PAYMENT', '02/11/26', '2500.00', '0.00', '0000530912345678', '97500.00']),
  neftIn: pad([' 03/11/26', 'NEFT CR-UTIB0000123-MYNTRA DESIGNS PVT LTD-SETTLEMENT NOV-AXISCN0123456789', '03/11/26', '0.00', '200000.00', 'AXISCN0123456789', '297500.00']),
  card: pad([' 03/11/26', 'POS 416021XXXXXX5678 ACME STATIONERS', '03/11/26', '1250.50', '0.00', '0000000000000000', '296249.50']),
  ach: pad([' 05/11/26', 'ACH D- TP ACH BAJAJ FINANCE-123456789', '05/11/26', '15000.00', '0.00', '0000000123456789', '281249.50']),
  chg: pad([' 05/11/26', 'SMS ALERT CHARGES OCT26 INCL GST', '05/11/26', '17.70', '0.00', '0000000000000000', '281231.80']),
};
const FILE = ['', '  HDFC BANK Ltd.          Page No .:     1', '  Statement of accounts', '', HEADER, ...Object.values(L), '', '  Opening Balance,Dr Count,Cr Count'].join('\r\n');

describe('statement fields', () => {
  it('reads dates as banks print them', () => {
    expect(statementDate('13/11/26')).toBe('2026-11-13');
    expect(statementDate(' 13/11/2026 ')).toBe('2026-11-13');
    expect(statementDate('13-Nov-2026')).toBe('2026-11-13');
    expect(statementDate('3 Nov 26')).toBe('2026-11-03');
    expect(statementDate('31/02/26')).toBeNull();
    expect(statementDate('Opening Balance')).toBeNull();
  });

  it('reads amounts in paise', () => {
    expect(statementAmount('1,23,456.78')).toBe(12345678);
    expect(statementAmount('  2500.5 ')).toBe(250050);
    expect(statementAmount('')).toBe(0);
    expect(statementAmount('0.00')).toBe(0);
    expect(statementAmount('500.00 Cr')).toBe(50000);
    expect(statementAmount('500.00 Dr')).toBe(-50000);
    expect(statementAmount('-12')).toBe(-1200);
    expect(statementAmount('12.345')).toBeNull();
    expect(statementAmount('abc')).toBeNull();
  });

  it('cleans reference numbers', () => {
    expect(cleanRef('0000530912345678')).toBe('530912345678');
    expect(cleanRef('0000000000000000')).toBe('');
    expect(cleanRef(' AXISCN0123456789 ')).toBe('AXISCN0123456789');
  });

  it('reads the kind and the other party from the narration', () => {
    expect(readNarration('UPI-VENDOR B PACKAGING-VENDORB@OKHDFCBANK-HDFC0001234-530912345678-PAYMENT')).toEqual({ kind: 'UPI', counterparty: 'VENDOR B PACKAGING', ref: '' });
    expect(readNarration('NEFT CR-UTIB0000123-MYNTRA DESIGNS PVT LTD-SETTLEMENT NOV-AXISCN0123456789')).toEqual({ kind: 'NEFT', counterparty: 'MYNTRA DESIGNS PVT LTD', ref: 'AXISCN0123456789' });
    expect(readNarration('POS 416021XXXXXX5678 ACME STATIONERS')).toEqual({ kind: 'Card', counterparty: 'ACME STATIONERS', ref: '' });
    expect(readNarration('ACH D- TP ACH BAJAJ FINANCE-123456789').kind).toBe('Auto-debit');
    expect(readNarration('SMS ALERT CHARGES OCT26 INCL GST')).toEqual({ kind: 'Charges', counterparty: '', ref: '' });
    expect(readNarration('IMPS-531212345678-RAVI TRADERS-KKBK-XXXXXXXX1234-INVOICE 22').counterparty).toBe('RAVI TRADERS');
    expect(readNarration('NWD-416021XXXXXX5678-S1AWND12-MUMBAI').kind).toBe('ATM');
  });
});

describe('parseStatement', () => {
  it('reads the Delimited download, skipping titles and footers', () => {
    const s = parseStatement(FILE);
    expect(s.problem).toBe('');
    expect(s.lines).toHaveLength(5);
    expect(s.from).toBe('2026-11-02');
    expect(s.to).toBe('2026-11-05');
    expect(s.closing_paise).toBe(28123180);
    const [upi, neft, card, ach, chg] = s.lines;
    expect(upi).toMatchObject({ date: '2026-11-02', direction: 'out', amount_paise: 250000, reference_no: '530912345678', counterparty: 'VENDOR B PACKAGING', kind: 'UPI', balance_paise: 9750000 });
    expect(neft).toMatchObject({ direction: 'in', amount_paise: 20000000, reference_no: 'AXISCN0123456789', counterparty: 'MYNTRA DESIGNS PVT LTD', kind: 'NEFT' });
    expect(card).toMatchObject({ direction: 'out', amount_paise: 125050, reference_no: '', counterparty: 'ACME STATIONERS', kind: 'Card' });
    expect(ach).toMatchObject({ kind: 'Auto-debit', reference_no: '123456789' });
    expect(chg).toMatchObject({ kind: 'Charges', counterparty: '', amount_paise: 1770 });
    for (const l of s.lines) expect(l.key).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(s.lines.map((l) => l.key)).size).toBe(5);
  });

  it('gives the same line the same key in any download that includes it', () => {
    const a = parseStatement(FILE);
    const b = parseStatement([HEADER, L.neftIn, L.card, L.ach].join('\n'));
    expect(b.problem).toBe('');
    expect(b.lines.map((l) => l.key)).toEqual(a.lines.slice(1, 4).map((l) => l.key));
  });

  it('puts a newest-first statement in date order', () => {
    const s = parseStatement([HEADER, ...Object.values(L).reverse()].join('\n'));
    expect(s.problem).toBe('');
    expect(s.lines.map((l) => l.amount_paise)).toEqual(parseStatement(FILE).lines.map((l) => l.amount_paise));
    expect(s.closing_paise).toBe(28123180);
  });

  it('reads other banks\' CSV headers', () => {
    const csv = ['Txn Date,Description,Ref No,Withdrawal Amt,Deposit Amt,Balance', '"01-Nov-2026","UPI/ABC TRADERS/receipt","531012345678","","15,000.00","1,15,000.00"', '"02-Nov-2026","RENT NOV","","40000","","75000"'].join('\n');
    const s = parseStatement(csv);
    expect(s.problem).toBe('');
    expect(s.lines.map((l) => [l.date, l.direction, l.amount_paise, l.balance_paise])).toEqual([['2026-11-01', 'in', 1500000, 11500000], ['2026-11-02', 'out', 4000000, 7500000]]);
  });

  it('refuses files it cannot trust', () => {
    expect(parseStatement('just some text\nwith lines').problem).toMatch(/Delimited/);
    expect(parseStatement([HEADER, L.upiOut, L.ach].join('\n')).problem).toMatch(/do not add up/);
    const both = pad([' 02/11/26', 'ODD LINE', '02/11/26', '10.00', '10.00', '', '97500.00']);
    expect(parseStatement([HEADER, both].join('\n')).problem).toMatch(/both a withdrawal and a deposit/);
    expect(parseStatement(HEADER).problem).toMatch(/No transactions/);
  });

  it('puts back a narration split by a comma', () => {
    const line = pad([' 02/11/26', 'UPI-VENDOR B, PACKAGING-VENDORB@OKHDFCBANK-530912345678-PAY', '02/11/26', '2500.00', '0.00', '0000530912345678', '97500.00']);
    const s = parseStatement([HEADER, line].join('\n'));
    expect(s.problem).toBe('');
    expect(s.lines[0]).toMatchObject({ amount_paise: 250000, reference_no: '530912345678', balance_paise: 9750000, counterparty: 'VENDOR B, PACKAGING' });
  });

  it('keeps repeated identical lines apart', () => {
    const csv = ['Date,Narration,Debit,Credit', '01/11/26,UPI-TEA STALL-PAY,20,', '01/11/26,UPI-TEA STALL-PAY,20,'].join('\n');
    const s = parseStatement(csv);
    expect(s.problem).toBe('');
    expect(s.lines).toHaveLength(2);
    expect(s.lines[0].key).not.toBe(s.lines[1].key);
    expect(s.closing_paise).toBeNull();
  });
});

describe('importSummary', () => {
  it('says what the upload did', () => {
    expect(importSummary({ lines: 40, already: 0, matched: 30, added: 10, today: 2, balances: 12, from: '2026-11-01', to: '2026-11-12' })).toBe(
      'Read 40 transactions from 1 Nov 2026 to 12 Nov 2026. 30 were already recorded. 10 were missing and are now added for you to check under Transactions. ' +
        "The bank's end-of-day balance is recorded for 12 days. 2 transactions from today will come in with tomorrow's upload.",
    );
    expect(importSummary({ lines: 3, already: 3, matched: 0, added: 0, today: 0, balances: 0, from: '2026-11-01', to: '2026-11-01' })).toBe(
      'Read 3 transactions from 1 Nov 2026 to 1 Nov 2026. 3 were brought in from a statement before.',
    );
    expect(importSummary({ lines: 0, already: 0, matched: 0, added: 0, today: 4, balances: 0, from: null, to: null })).toMatch(/only today's/);
  });
});

describe('balanceGaps', () => {
  const bal = (as_of: string, rupees: number): FinBalance => ({ id: as_of, account_id: 'a', as_of, balance_paise: rupees * 100, source: 'gmail', note: '' });
  const txn = (txn_at: string, direction: 'in' | 'out', rupees: number, extra: Partial<FinTxn> = {}) =>
    ({ id: txn_at, account_id: 'a', txn_at, direction, amount_paise: rupees * 100, voided_at: null, review_status: 'needs_review', ...extra }) as FinTxn;

  it('compares the last balance of each day with the next day that has one', () => {
    const readings = [bal('2026-11-01T05:00:00Z', 1000), bal('2026-11-01T10:00:00Z', 900), bal('2026-11-02T10:00:00Z', 700), bal('2026-11-04T10:00:00Z', 1200)];
    const txns = [
      txn('2026-11-01T09:00:00Z', 'out', 100), // before the day's last balance: not in any stretch
      txn('2026-11-02T06:30:00Z', 'out', 200), // 1 Nov to 2 Nov adds up
      txn('2026-11-03T06:30:00Z', 'in', 300), // 2 Nov to 4 Nov: 700 + 300 = 1000, bank says 1200
      txn('2026-11-03T07:30:00Z', 'out', 50, { voided_at: '2026-11-03T08:00:00Z' }),
    ];
    // Asia/Kolkata days: 1 Nov 10:00Z is 15:30 IST on 1 Nov.
    expect(balanceGaps(readings, txns, 'Asia/Kolkata')).toEqual({ checked: 2, gaps: [{ from: '2026-11-02', to: '2026-11-04', diff: 20000 }] });
  });

  it('needs two days', () => {
    expect(balanceGaps([bal('2026-11-01T05:00:00Z', 1000)], [], 'Asia/Kolkata')).toEqual({ checked: 0, gaps: [] });
  });
});
