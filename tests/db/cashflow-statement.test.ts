import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anonClient, db, login, memberId, provision, resetData } from './helpers';

// Cash Flow: bank statement upload (13-Nov-2026). Made-up names, numbers and amounts.
const TEAM = ['Kartik', 'Zinia'];
const ids: Record<string, string> = {};
const L = (rupees: number) => rupees * 100;

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}
let TODAY = '';
const day = (n: number) => {
  const [y, m, d] = TODAY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

async function account(c: SupabaseClient, last4 = '1234'): Promise<string> {
  const { data, error } = await c.rpc('fin_account_save', {
    p_id: null, p_name: `HDFC ${last4}`, p_bank: 'HDFC Bank', p_last4: last4, p_kind: 'current', p_notes: '', p_balance: L(100000),
    p_as_of: ist(day(10), '09:00'),
  });
  expect(error).toBeNull();
  return data as string;
}

async function txn(acc: string, at: string, direction: 'in' | 'out', rupees: number, over: { ref?: string; who?: string; source?: string; review?: string } = {}) {
  const r = await sql<{ id: string }>(
    `insert into public.fin_transactions (account_id, txn_at, direction, amount_paise, category, counterparty, reference_no, source, review_status)
     values ($1, $2, $3, $4, case when $3 = 'in' then 'other_income' else 'other_expense' end, $5, $6, $7, $8) returning id`,
    [acc, at, direction, L(rupees), over.who ?? '', over.ref ?? '', over.source ?? 'gmail', over.review ?? 'confirmed'],
  );
  return r[0].id;
}

let keySeq = 0;
function line(date: string, direction: 'in' | 'out', rupees: number, balance: number | null, over: Record<string, unknown> = {}) {
  keySeq += 1;
  return { date, direction, amount_paise: L(rupees), reference_no: '', counterparty: '', kind: 'UPI', balance_paise: balance === null ? null : L(balance), key: keySeq.toString(16).padStart(32, '0'), ...over };
}

beforeAll(async () => {
  await resetData();
  for (const n of TEAM) await provision(n);
  for (const n of TEAM) ids[n] = await memberId(n);
  TODAY = (await sql<{ d: string }>('select private.today()::text as d'))[0].d;
}, 60_000);

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await resetData();
  await db.end();
});

describe('uploading a bank statement', () => {
  it('is for Finance people only', async () => {
    const k = await login('Kartik');
    const acc = await account(k);
    const lines = [line(day(2), 'out', 100, 99900)];
    for (const c of [await login('Zinia'), anonClient()]) {
      const r = await c.rpc('fin_statement_import', { p_account: acc, p_lines: lines });
      expect(r.error).not.toBeNull();
    }
    expect((await sql('select 1 from public.fin_transactions')).length).toBe(0);
  });

  it('matches what is recorded, adds only what is missing, records each day\'s balance, and changes nothing the second time', async () => {
    const k = await login('Kartik');
    const acc = await account(k);
    const t1 = await txn(acc, ist(day(5), '10:00'), 'out', 2500, { ref: '530912345678' }); // confirmed bank email, no payee
    const t2 = await txn(acc, ist(day(3), '00:30'), 'out', 15000, { review: 'needs_review' }); // alert just after midnight
    const t3 = await txn(acc, ist(day(4), '15:00'), 'in', 200000, { source: 'manual', who: 'Myntra' }); // entered by hand
    const t4 = await txn(acc, ist(day(2), '12:00'), 'out', 999); // the same amount is paid on the day before too

    const lines = [
      line(day(5), 'out', 2500, 97500, { reference_no: '530912345678', counterparty: 'VENDOR B' }),
      line(day(4), 'out', 15000, 82500, { counterparty: 'BAJAJ FINANCE', kind: 'Auto-debit' }),
      line(day(4), 'in', 200000, 282500, { reference_no: 'AXISCN0123456789', counterparty: 'MYNTRA DESIGNS', kind: 'NEFT' }),
      line(day(4), 'out', 500, 282000, { reference_no: '531000000001', counterparty: 'TEA STALL' }),
      line(day(3), 'out', 999, 281001),
      line(day(2), 'out', 999, 280002),
      line(TODAY, 'out', 100, 279902),
    ];
    const first = await k.rpc('fin_statement_import', { p_account: acc, p_lines: lines });
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ lines: 6, already: 0, matched: 4, added: 2, today: 1, balances: 4, from: day(5), to: day(2) });

    const rows = await sql<{ id: string; source: string; review_status: string; reference_no: string; counterparty: string; description: string; import_key: string; d: string; amount_paise: string }>(
      `select id, source, review_status, reference_no, counterparty, description, import_key, (txn_at at time zone 'Asia/Kolkata')::date::text as d, amount_paise
         from public.fin_transactions order by txn_at`,
    );
    const by = (id: string) => rows.find((r) => r.id === id)!;
    // Matched: blank details filled in, nothing else changed.
    expect(by(t1)).toMatchObject({ counterparty: 'VENDOR B', reference_no: '530912345678', review_status: 'confirmed', import_key: lines[0].key });
    expect(by(t2)).toMatchObject({ counterparty: 'BAJAJ FINANCE', review_status: 'needs_review', import_key: lines[1].key, d: day(3) });
    expect(by(t3)).toMatchObject({ counterparty: 'Myntra', reference_no: 'AXISCN0123456789', import_key: lines[2].key });
    // The 999 recorded on its own day is matched to that day's line; the day before's is added.
    expect(by(t4)).toMatchObject({ import_key: lines[5].key });
    const added = rows.filter((r) => r.source === 'statement');
    expect(added.map((r) => [r.d, Number(r.amount_paise), r.reference_no, r.counterparty, r.description, r.review_status])).toEqual([
      [day(4), L(500), '531000000001', 'TEA STALL', 'Bank statement: UPI', 'needs_review'],
      [day(3), L(999), '', '', 'Bank statement: UPI', 'needs_review'],
    ]);
    // Confirmed transactions that got details have it in their history.
    const filled = await sql<{ entity_id: string; details: { by: string } }>(`select entity_id, details from public.fin_events where action = 'details_filled' order by entity_id`);
    expect(filled.map((e) => e.entity_id).sort()).toEqual([t1, t3].sort());
    expect(filled.every((e) => e.details.by === 'statement')).toBe(true);
    // The bank's balance at the end of each day.
    const bals = await sql<{ d: string; t: string; balance_paise: string }>(
      `select (as_of at time zone 'Asia/Kolkata')::date::text as d, to_char(as_of at time zone 'Asia/Kolkata', 'HH24:MI:SS') as t, balance_paise
         from public.fin_balances where source = 'statement' order by as_of`,
    );
    expect(bals.map((b) => [b.d, b.t, Number(b.balance_paise)])).toEqual([
      [day(5), '23:59:59', L(97500)], [day(4), '23:59:59', L(282000)], [day(3), '23:59:59', L(281001)], [day(2), '23:59:59', L(280002)],
    ]);

    // The same statement again, or a longer one that includes it, adds nothing twice.
    const again = await k.rpc('fin_statement_import', { p_account: acc, p_lines: lines });
    expect(again.data).toEqual({ lines: 6, already: 6, matched: 0, added: 0, today: 1, balances: 0, from: day(5), to: day(2) });
    expect((await sql('select 1 from public.fin_transactions')).length).toBe(6);
    expect((await sql(`select 1 from public.fin_events where action = 'statement_imported'`)).length).toBe(2);
  });

  it('refuses lines it cannot use', async () => {
    const k = await login('Kartik');
    const acc = await account(k);
    const bad = async (lines: unknown) => (await k.rpc('fin_statement_import', { p_account: acc, p_lines: lines })).error?.message;
    expect(await bad([])).toMatch(/no transactions/);
    expect(await bad([line(day(2), 'out', 100, null), line(day(3), 'out', 100, null)])).toMatch(/not in date order/);
    expect(await bad([line(day(2), 'out', 0, null)])).toMatch(/Line 1/);
    expect(await bad([{ ...line(day(2), 'out', 100, null), direction: 'sideways' }])).toMatch(/Line 1/);
    expect(await bad([{ ...line(day(2), 'out', 100, null), key: 'not-a-key' }])).toMatch(/Line 1/);
    await sql('update public.fin_accounts set archived_at = now() where id = $1', [acc]);
    expect(await bad([line(day(2), 'out', 100, null)])).toMatch(/in use/);
    expect((await sql('select 1 from public.fin_transactions')).length).toBe(0);
  });

  it('a bank email for a payment the statement already brought in is not recorded twice', async () => {
    const k = await login('Kartik');
    const acc = await account(k);
    const imported = await k.rpc('fin_statement_import', {
      p_account: acc,
      p_lines: [line(day(4), 'out', 500, 99500, { counterparty: 'TEA STALL' }), line(day(3), 'out', 700, 98800, { reference_no: '531000000007' })],
    });
    expect(imported.data).toMatchObject({ added: 2 });

    const { data: conn } = await k.rpc('fin_gmail_connect', { p_email: 'kartik@svarnjewels.com', p_refresh_token: '1//test-refresh-token-for-local-tests-only', p_import_from: TODAY });
    const alert = (id: string, at: string, rupees: number, ref: string, balance: number | null) => ({
      message_id: `18f00000000000${id}`, received_at: at, sender: 'alerts@hdfcbank.net', subject: 'You have done a UPI txn. Check details!', readable: true,
      direction: 'out', amount_paise: L(rupees), last4: '1234', reference_no: ref, counterparty: 'SOMEONE', balance_paise: balance === null ? null : L(balance),
    });
    const r = await admin.rpc('fin_gmail_record', {
      p_connection: conn, p_actor: ids.Kartik, p_seen_until: new Date().toISOString(), p_ok: true, p_message: '',
      p_alerts: [
        alert('01', ist(day(4), '18:00'), 500, '', 99500), // same day, no reference: from the statement
        alert('02', ist(day(3), '11:00'), 700, '531000000007', null), // same reference
        alert('03', ist(day(1), '11:00'), 500, '', null), // another day: a new payment
      ],
    });
    expect(r.error).toBeNull();
    const alerts = await sql<{ message_id: string; status: string; note: string; balance_id: string | null }>('select message_id, status, note, balance_id from public.fin_gmail_alerts order by message_id');
    expect(alerts.map((a) => [a.status, a.note])).toEqual([
      ['duplicate', 'Already on this account from a bank statement'],
      ['duplicate', 'Already recorded on this account with the same reference number'],
      ['recorded', ''],
    ]);
    expect(alerts[0].balance_id).not.toBeNull(); // the email's balance is still a real reading
    expect((await sql('select 1 from public.fin_transactions')).length).toBe(3);
  });
});
