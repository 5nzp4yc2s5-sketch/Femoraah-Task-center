import { createHash } from 'node:crypto';

// Reads a bank statement downloaded from net banking as text: HDFC's "Delimited" download (comma
// separated, padded with spaces) or any CSV with a header row. Only the facts are kept: date,
// amount, direction, reference number, the other party's name, a short kind (UPI, NEFT, ...) and the
// closing balance. The narration itself is read in memory and thrown away.

export interface StatementLine {
  /** Transaction date, YYYY-MM-DD. */
  date: string;
  direction: 'in' | 'out';
  amount_paise: number;
  reference_no: string;
  counterparty: string;
  /** Short kind such as UPI, NEFT, Card, ATM, Charges. */
  kind: string;
  balance_paise: number | null;
  /** Stable id for this line, so uploading the same statement twice changes nothing. */
  key: string;
}

export interface ParsedStatement {
  lines: StatementLine[];
  from: string | null;
  to: string | null;
  /** Closing balance after the last line, when the file has a balance column. */
  closing_paise: number | null;
  /** Why the file cannot be used. Empty when it can. */
  problem: string;
}

const MAX_LINES = 5000;

function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

type Col = 'date' | 'narration' | 'ref' | 'debit' | 'credit' | 'balance';
const HEADERS: Record<Col, string[]> = {
  date: ['date', 'txndate', 'transactiondate', 'trandate'],
  narration: ['narration', 'description', 'particulars', 'remarks', 'transactionremarks'],
  ref: ['chqrefnumber', 'chqrefno', 'refno', 'refnumber', 'chequeno', 'chqno', 'reference', 'referenceno'],
  debit: ['debitamount', 'withdrawalamt', 'withdrawalamount', 'withdrawal', 'debit', 'withdrawalsdr', 'dr'],
  credit: ['creditamount', 'depositamt', 'depositamount', 'deposit', 'credit', 'depositscr', 'cr'],
  balance: ['closingbalance', 'balance', 'runningbalance'],
};

function findColumns(cells: string[]): Record<Col, number> | null {
  const n = cells.map(norm);
  const pick = (names: string[]) => n.findIndex((c) => names.includes(c));
  const cols = {
    date: pick(HEADERS.date), narration: pick(HEADERS.narration), ref: pick(HEADERS.ref),
    debit: pick(HEADERS.debit), credit: pick(HEADERS.credit), balance: pick(HEADERS.balance),
  };
  return cols.date >= 0 && cols.narration >= 0 && cols.debit >= 0 && cols.credit >= 0 ? cols : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "13/11/26", "13/11/2026", "13-11-2026", "13-Nov-2026", "13 Nov 26" → 2026-11-13. */
export function statementDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[/\-. ]([A-Za-z]{3}|\d{1,2})[/\-. ](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = /\d/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].toLowerCase()];
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (!month || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** "1,23,456.78" → 12345678 paise; blank → 0; anything else → null. */
export function statementAmount(s: string): number | null {
  const t = s.replace(/[,\s]/g, '').replace(/^(?:INR|Rs\.?|₹)/i, '');
  if (t === '' || t === '-') return 0;
  const neg = /^-/.test(t) || /(?:dr)$/i.test(t);
  const v = t.replace(/^-/, '').replace(/(?:cr|dr)$/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [r, p = ''] = v.split('.');
  const paise = Number(r) * 100 + Number((p + '00').slice(0, 2));
  return neg ? -paise : paise;
}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/i;

/** What kind of transaction a narration describes, and who the other party is. */
export function readNarration(narration: string): { kind: string; counterparty: string; ref: string } {
  const n = narration.replace(/\s+/g, ' ').trim();
  const u = n.toUpperCase();
  const kind =
    /^UPI\b/.test(u) ? 'UPI'
    : /^NEFT\b/.test(u) ? 'NEFT'
    : /^RTGS\b/.test(u) ? 'RTGS'
    : /^IMPS\b|^MMT\b/.test(u) ? 'IMPS'
    : /^(?:ACH|NACH|ECS)\b/.test(u) ? 'Auto-debit'
    : /^(?:ATW|NWD|EAW|ATM)\b/.test(u) ? 'ATM'
    : /^(?:POS|ME DC|PCD|VPS|IPS)\b|DEBIT CARD/.test(u) ? 'Card'
    : /\b(?:CHQ|CHEQUE|CLG|CLEARING)\b/.test(u) ? 'Cheque'
    : /\b(?:CHRG|CHARGES?|GST|SMS ALERT|FEE)\b/.test(u) ? 'Charges'
    : /\bINT(?:EREST)?\b.*\b(?:PD|PAID|CREDIT)\b|^CREDIT INTEREST/.test(u) ? 'Interest'
    : /^(?:FT|IB FUNDS|FUNDS TRANSFER|TPT|BIL\/|INB)\b/.test(u) ? 'Transfer'
    : 'Other';
  if (kind === 'Charges' || kind === 'Interest') return { kind, counterparty: '', ref: '' };

  let counterparty = '';
  if (kind === 'Card') {
    const m = n.match(/\b\d{4,6}[X*]+\d{4}\s+(.+)$/i) ?? n.match(/^(?:POS|ME DC SI|ME DC|PCD|VPS|IPS)\s+(.+)$/i);
    counterparty = m ? m[1] : '';
  } else if (kind !== 'ATM') {
    const parts = n.split(/\s*-\s*/).slice(1);
    counterparty = parts.find((p) => /[A-Za-z]{3}/.test(p) && !/@/.test(p) && !IFSC.test(p) && !/^(?:CR|DR)$/i.test(p)
      && (p.match(/\d/g)?.length ?? 0) <= p.length / 2) ?? '';
  }
  counterparty = counterparty.replace(/\b\d{4,}[X*]+\d+\b/gi, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  // NEFT and RTGS narrations end with the UTR.
  let ref = '';
  if (kind === 'NEFT' || kind === 'RTGS') {
    const last = n.split(/\s*-\s*/).pop() ?? '';
    if (/^[A-Z0-9]{8,30}$/i.test(last) && /\d/.test(last) && !IFSC.test(last)) ref = last;
  }
  return { kind, counterparty, ref };
}

/** A reference number as the bank prints it: "0000530912345678" → "530912345678"; zeros only → "". */
export function cleanRef(s: string): string {
  const t = s.trim().replace(/\s+/g, '');
  if (!t || /^0+$/.test(t)) return '';
  return /^\d+$/.test(t) ? t.replace(/^0+/, '') : t.slice(0, 80);
}

/** Reads the statement. Lines come back oldest first. */
export function parseStatement(text: string): ParsedStatement {
  const fail = (problem: string): ParsedStatement => ({ lines: [], from: null, to: null, closing_paise: null, problem });
  const rows = text.replace(/^﻿/, '').split(/\r?\n/);
  let cols: Record<Col, number> | null = null;
  let sep = ',';
  let start = 0;
  let width = 0;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    for (const s of [',', '\t', ';', '|']) {
      if (!rows[i].includes(s)) continue;
      const cells = splitRow(rows[i], s);
      const c = findColumns(cells);
      if (c) { cols = c; sep = s; start = i + 1; width = cells.length; break; }
    }
    if (cols) break;
  }
  if (!cols) return fail('This file has no header row with Date, Narration, withdrawal and deposit columns. Download the statement in the Delimited format and try again.');

  type Raw = { date: string; direction: 'in' | 'out'; amount: number; ref: string; narration: string; balance: number | null };
  const raw: Raw[] = [];
  for (let i = start; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const c = splitRow(rows[i], sep);
    // A comma inside an unquoted narration splits it; put it back together.
    if (c.length > width && cols.narration < width - 1) {
      const extra = c.length - width;
      c.splice(cols.narration, extra + 1, c.slice(cols.narration, cols.narration + extra + 1).join(`${sep} `));
    }
    const date = statementDate(c[cols.date] ?? '');
    if (!date) continue; // footers, separators, totals
    const debit = statementAmount(c[cols.debit] ?? '');
    const credit = statementAmount(c[cols.credit] ?? '');
    if (debit === null || credit === null) return fail(`Line ${i + 1} has an amount that could not be read.`);
    if (debit > 0 === credit > 0) {
      if (debit === 0 && credit === 0) continue;
      return fail(`Line ${i + 1} has both a withdrawal and a deposit.`);
    }
    const balance = cols.balance >= 0 ? statementAmount(c[cols.balance] ?? '') : null;
    raw.push({
      date, direction: credit > 0 ? 'in' : 'out', amount: Math.abs(credit > 0 ? credit : debit),
      ref: cols.ref >= 0 ? c[cols.ref] ?? '' : '', narration: c[cols.narration] ?? '', balance,
    });
    if (raw.length > MAX_LINES) return fail(`The file has more than ${MAX_LINES} transactions. Download a shorter period.`);
  }
  if (!raw.length) return fail('No transactions were found in this file.');

  // Statements list oldest first or newest first; the closing balances say which.
  const fits = (list: Raw[]) => list.every((r, i) => i === 0 || r.balance === null || list[i - 1].balance === null
    || list[i - 1].balance! + (r.direction === 'in' ? r.amount : -r.amount) === r.balance);
  let ordered = raw;
  if (raw.some((r) => r.balance !== null)) {
    if (!fits(raw)) {
      const rev = [...raw].reverse();
      if (!fits(rev)) return fail('The balances in this file do not add up from one line to the next, so it may be cut or edited. Download it again from net banking.');
      ordered = rev;
    }
  } else if (raw.length > 1 && raw[0].date > raw[raw.length - 1].date) ordered = [...raw].reverse();
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].date < ordered[i - 1].date) return fail('The dates in this file are not in order. Download it again from net banking.');
  }

  const seen = new Map<string, number>();
  const lines = ordered.map((r) => {
    const n = readNarration(r.narration);
    const base = [r.date, r.direction, r.amount, r.balance ?? '', r.balance === null ? cleanRef(r.ref) : ''].join('|');
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      date: r.date,
      direction: r.direction,
      amount_paise: r.amount,
      reference_no: cleanRef(r.ref) || n.ref,
      counterparty: n.counterparty,
      kind: n.kind,
      balance_paise: r.balance,
      key: createHash('sha256').update(`${base}|${occurrence}`).digest('hex').slice(0, 32),
    } satisfies StatementLine;
  });
  return { lines, from: lines[0].date, to: lines[lines.length - 1].date, closing_paise: lines[lines.length - 1].balance_paise, problem: '' };
}

export interface ImportCounts {
  lines: number;
  already: number;
  matched: number;
  added: number;
  today: number;
  balances: number;
  from: string | null;
  to: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};

/** What an upload did, in a sentence or two. */
export function importSummary(c: ImportCounts): string {
  if (!c.lines) {
    return c.today
      ? `This file has only today's transactions. They are brought in once the day is over, so upload the statement again tomorrow.`
      : 'Nothing was brought in.';
  }
  const parts = [`Read ${plural(c.lines, 'transaction', 'transactions')} from ${shortDate(c.from!)} to ${shortDate(c.to!)}.`];
  if (c.matched) parts.push(`${plural(c.matched, 'was', 'were')} already recorded.`);
  if (c.added) parts.push(`${plural(c.added, 'was missing and is', 'were missing and are')} now added for you to check under Transactions.`);
  if (c.already) parts.push(`${plural(c.already, 'was', 'were')} brought in from a statement before.`);
  if (!c.added && !c.already && c.matched === c.lines) parts.push('Nothing was missing.');
  if (c.balances) parts.push(`The bank's end-of-day balance is recorded for ${plural(c.balances, 'day', 'days')}.`);
  if (c.today) parts.push(`${plural(c.today, 'transaction', 'transactions')} from today will come in with tomorrow's upload.`);
  return parts.join(' ');
}
