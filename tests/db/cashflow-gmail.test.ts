import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { admin, anonClient, db, login, memberId, provision, resetData } from './helpers';

// Cash Flow phase 2: bank alerts read from Gmail.
const TEAM = ['Kartik', 'Shruti', 'Zinia'];
const ids: Record<string, string> = {};
const L = (rupees: number) => rupees * 100;
const TOKEN = '1//test-refresh-token-for-local-tests-only';

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}
async function today(): Promise<string> {
  return (await sql<{ d: string }>('select private.today()::text as d'))[0].d;
}

async function account(c: SupabaseClient, last4: string, name = `HDFC ${last4}`): Promise<string> {
  const { data, error } = await c.rpc('fin_account_save', {
    p_id: null, p_name: name, p_bank: 'HDFC Bank', p_last4: last4, p_kind: 'current', p_notes: '', p_balance: L(1500000),
    p_as_of: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  });
  expect(error).toBeNull();
  return data as string;
}

async function connect(c: SupabaseClient, email = 'kartik@svarnjewels.com'): Promise<string> {
  const { data, error } = await c.rpc('fin_gmail_connect', { p_email: email, p_refresh_token: TOKEN, p_import_from: await today() });
  expect(error).toBeNull();
  return data as string;
}

let seq = 0;
function alert(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    message_id: `18f0000000${String(seq).padStart(6, '0')}`,
    received_at: new Date(Date.now() - (100 - seq) * 60_000).toISOString(),
    sender: 'alerts@hdfcbank.net',
    subject: 'You have done a UPI txn. Check details!',
    readable: true,
    direction: 'out',
    amount_paise: L(2500),
    last4: '1234',
    reference_no: `5309${String(seq).padStart(8, '0')}`,
    counterparty: 'VENDOR B',
    balance_paise: null,
    ...over,
  };
}

async function record(connection: string, alerts: unknown[], actor: string | null = ids.Kartik) {
  const { data, error } = await admin.rpc('fin_gmail_record', {
    p_connection: connection, p_actor: actor, p_alerts: alerts, p_seen_until: new Date().toISOString(), p_ok: true, p_message: '',
  });
  expect(error).toBeNull();
  return data as Record<string, number>;
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

describe('connecting a mailbox', () => {
  it('lets only the Super Admin connect, and nobody signed in can read the stored permission', async () => {
    const k = await login('Kartik');
    await db.query(`update public.members set access_role = 'manager' where name = 'Shruti'`);
    expect((await k.rpc('finance_set_access', { p_member: ids.Shruti, p_on: true })).error).toBeNull();
    const s = await login('Shruti');

    const refused = await s.rpc('fin_gmail_connect', { p_email: 'kartik@svarnjewels.com', p_refresh_token: TOKEN, p_import_from: await today() });
    expect(refused.error?.message).toMatch(/Only the Super Admin/);

    const id = await connect(k);
    const row = (await sql<{ token_secret_id: string; email: string }>('select token_secret_id, email from public.fin_gmail_connections where id = $1', [id]))[0];
    expect(row.email).toBe('kartik@svarnjewels.com');

    // Stored encrypted in Vault: the raw table never holds the token in plain text.
    const raw = await sql<{ secret: string }>('select secret from vault.secrets where id = $1', [row.token_secret_id]);
    expect(raw[0].secret).not.toContain('test-refresh-token');

    // Finance people see the connection, but not the token.
    expect((await s.from('fin_gmail_connections').select('email')).data).toEqual([{ email: 'kartik@svarnjewels.com' }]);
    for (const c of [k, s]) {
      const t = await c.rpc('fin_gmail_token', { p_id: id });
      expect(t.error?.code).toBe('42501');
      const rec = await c.rpc('fin_gmail_record', { p_connection: id, p_actor: ids.Kartik, p_alerts: [], p_seen_until: null, p_ok: true, p_message: '' });
      expect(rec.error?.code).toBe('42501');
    }
    expect((await anonClient().rpc('fin_gmail_token', { p_id: id })).error).not.toBeNull();

    // Employees without Finance access see nothing.
    const z = await login('Zinia');
    expect((await z.from('fin_gmail_connections').select('email')).data).toEqual([]);

    // Only the server's service role reads it back.
    expect((await admin.rpc('fin_gmail_token', { p_id: id })).data).toBe(TOKEN);
  });

  it('reconnecting the same mailbox replaces the permission, and disconnecting overwrites it', async () => {
    const k = await login('Kartik');
    const id = await connect(k);
    const again = await k.rpc('fin_gmail_connect', { p_email: 'Kartik@SvarnJewels.com', p_refresh_token: `${TOKEN}-2`, p_import_from: await today() });
    expect(again.data).toBe(id);
    expect((await admin.rpc('fin_gmail_token', { p_id: id })).data).toBe(`${TOKEN}-2`);

    expect((await k.rpc('fin_gmail_disconnect', { p_id: id })).error).toBeNull();
    expect((await admin.rpc('fin_gmail_token', { p_id: id })).data).toBeNull();
    const secret = await sql<{ decrypted_secret: string }>(
      'select s.decrypted_secret from public.fin_gmail_connections c join vault.decrypted_secrets s on s.id = c.token_secret_id where c.id = $1', [id]);
    expect(secret[0].decrypted_secret).toBe('disconnected');
    const events = await sql<{ action: string }>(`select action from public.fin_events where entity = 'gmail' order by created_at`);
    expect(events.map((e) => e.action)).toEqual(['connected', 'reconnected', 'disconnected']);
  });

  it('checks the start date and the sender list', async () => {
    const k = await login('Kartik');
    const old = await k.rpc('fin_gmail_connect', { p_email: 'kartik@svarnjewels.com', p_refresh_token: TOKEN, p_import_from: '2020-01-01' });
    expect(old.error?.message).toMatch(/last 90 days/);
    const id = await connect(k);
    expect((await k.rpc('fin_gmail_set_senders', { p_id: id, p_senders: ['not an address'] })).error?.message).toMatch(/like alerts@hdfcbank.net/);
    expect((await k.rpc('fin_gmail_set_senders', { p_id: id, p_senders: [' Alerts@HDFCbank.net ', 'hdfcbank.bank.in', ''] })).error).toBeNull();
    expect((await sql<{ senders: string[] }>('select senders from public.fin_gmail_connections where id = $1', [id]))[0].senders)
      .toEqual(['alerts@hdfcbank.net', 'hdfcbank.bank.in']);
  });
});

describe('recording alerts', () => {
  it('records each email once, matches the account by its last 4 digits and keeps the bank balance', async () => {
    const k = await login('Kartik');
    const acc = await account(k, '1234');
    const id = await connect(k);

    const first = alert();
    const withBalance = alert({ direction: 'in', amount_paise: L(200000), balance_paise: L(1700000), counterparty: 'MYNTRA DESIGNS' });
    const counts = await record(id, [first, withBalance, alert({ readable: false, direction: null, amount_paise: null, note: 'Gmail could not confirm this email came from the bank, so it was not used' })]);
    expect(counts).toMatchObject({ new: 3, recorded: 2, unreadable: 1 });

    const txns = await sql<{ direction: string; amount_paise: string; source: string; review_status: string; created_by: string; category: string }>(
      'select direction, amount_paise, source, review_status, created_by, category from public.fin_transactions where account_id = $1 order by txn_at', [acc]);
    expect(txns).toEqual([
      { direction: 'out', amount_paise: String(L(2500)), source: 'gmail', review_status: 'needs_review', created_by: ids.Kartik, category: 'other_expense' },
      { direction: 'in', amount_paise: String(L(200000)), source: 'gmail', review_status: 'needs_review', created_by: ids.Kartik, category: 'other_income' },
    ]);
    const bal = await sql<{ balance_paise: string; source: string; as_of: Date }>(`select balance_paise, source, as_of from public.fin_balances where account_id = $1 and source = 'gmail'`, [acc]);
    expect(bal).toHaveLength(1);
    expect(bal[0].balance_paise).toBe(String(L(1700000)));
    expect(bal[0].as_of.toISOString()).toBe(withBalance.received_at);
    const unread = await sql<{ note: string }>(`select note from public.fin_gmail_alerts where status = 'unreadable'`);
    expect(unread[0].note).toMatch(/could not confirm/);

    // The same emails again change nothing.
    expect(await record(id, [withBalance])).toMatchObject({ new: 0 });
    expect((await sql('select 1 from public.fin_transactions')).length).toBe(2);
  });

  it('does not record a reference number twice, and asks for an account it cannot tell', async () => {
    const k = await login('Kartik');
    const acc = await account(k, '1234');
    await account(k, '9999', 'ICICI 9999 A');
    await account(k, '9999', 'ICICI 9999 B');
    const id = await connect(k);
    const manual = await k.rpc('fin_txn_save', {
      p_id: null, p_account: acc, p_at: new Date(Date.now() - 3_600_000).toISOString(), p_direction: 'out', p_amount: L(400000),
      p_category: 'vendor', p_counterparty: 'Vendor A', p_description: '', p_reference: 'N311260123456789',
    });
    expect(manual.error).toBeNull();

    const counts = await record(id, [
      alert({ reference_no: 'n311260123456789', amount_paise: L(400000), balance_paise: L(1100000) }),
      alert({ last4: '5555' }),
      alert({ last4: '9999' }),
      alert({ last4: '' }),
    ]);
    expect(counts).toMatchObject({ new: 4, duplicate: 1, no_account: 3, recorded: 0 });
    const notes = (await sql<{ status: string; note: string }>('select status, note from public.fin_gmail_alerts order by received_at')).map((r) => `${r.status}: ${r.note}`);
    expect(notes).toEqual([
      'duplicate: Already recorded on this account with the same reference number',
      'no_account: No bank account or debit card in use ends in 5555. Choose the account it belongs to',
      'no_account: More than one bank account or card ends in 9999. Choose one',
      'no_account: The email does not say which account. Choose one',
    ]);
    // A duplicate's balance is not taken either.
    expect((await sql(`select 1 from public.fin_balances where source = 'gmail'`)).length).toBe(0);
  });

  it('lets Finance people choose the account, ignore an alert and confirm what was read', async () => {
    const k = await login('Kartik');
    const acc = await account(k, '1234');
    const id = await connect(k);
    await record(id, [alert({ last4: '5555' }), alert({ readable: false, direction: null, amount_paise: null }), alert()], null);
    const [noAcc, unreadable] = await sql<{ id: string }>(`select id from public.fin_gmail_alerts where status in ('no_account', 'unreadable') order by received_at`);

    await db.query(`update public.members set access_role = 'manager' where name = 'Shruti'`);
    const z = await login('Zinia');
    expect((await z.rpc('fin_gmail_alert_assign', { p_alert: noAcc.id, p_account: acc })).error?.message).toMatch(/Finance access/);
    expect((await k.rpc('finance_set_access', { p_member: ids.Shruti, p_on: true })).error).toBeNull();
    const s = await login('Shruti');

    expect((await s.rpc('fin_gmail_alert_assign', { p_alert: noAcc.id, p_account: acc })).data).toBe('recorded');
    expect((await s.rpc('fin_gmail_alert_assign', { p_alert: noAcc.id, p_account: acc })).error?.message).toMatch(/already handled/);
    expect((await s.rpc('fin_gmail_alert_ignore', { p_alert: unreadable.id, p_reason: 'Offer email' })).error).toBeNull();
    const handled = await sql<{ status: string; handled_by: string }>('select status, handled_by from public.fin_gmail_alerts where id = any($1) order by received_at', [[noAcc.id, unreadable.id]]);
    expect(handled).toEqual([{ status: 'recorded', handled_by: ids.Shruti }, { status: 'ignored', handled_by: ids.Shruti }]);

    const toCheck = await sql<{ id: string }>(`select id from public.fin_transactions where review_status = 'needs_review'`);
    expect(toCheck).toHaveLength(2);
    expect((await z.rpc('fin_txn_confirm', { p_ids: toCheck.map((t) => t.id) })).error?.message).toMatch(/Finance access/);
    expect((await s.rpc('fin_txn_confirm', { p_ids: toCheck.map((t) => t.id) })).data).toBe(2);
    expect((await s.rpc('fin_txn_confirm', { p_ids: toCheck.map((t) => t.id) })).data).toBe(0);
    const events = await sql<{ n: string }>(`select count(*) as n from public.fin_events where entity = 'transaction' and action = 'confirmed' and actor_member_id = $1`, [ids.Shruti]);
    expect(events[0].n).toBe('2');
  });

  it('ignores alerts for a disconnected mailbox', async () => {
    const k = await login('Kartik');
    const id = await connect(k);
    await k.rpc('fin_gmail_disconnect', { p_id: id });
    const { error } = await admin.rpc('fin_gmail_record', { p_connection: id, p_actor: null, p_alerts: [alert()], p_seen_until: null, p_ok: true, p_message: '' });
    expect(error?.message).toMatch(/no longer connected|not found/);
  });
});

describe('debit cards and reading again (13-Nov-2026)', () => {
  it('records card alerts in the account the card is linked to, now and later', async () => {
    const k = await login('Kartik');
    const acc = await account(k, '1234');
    const conn = await connect(k);
    const before = await record(conn, [
      alert({ last4: '5678', reference_no: '', counterparty: 'SHOP ONE' }),
      alert({ last4: '5678', reference_no: '', counterparty: 'SHOP TWO', amount_paise: L(900) }),
    ]);
    expect(before.no_account).toBe(2);
    const notes = await sql<{ note: string }>('select note from public.fin_gmail_alerts order by received_at');
    expect(notes[0].note).toContain('debit card');

    // A Finance user links the card: both waiting alerts are recorded at once.
    const { data: n, error } = await k.rpc('fin_account_link_card', { p_account: acc, p_last4: '5678' });
    expect(error).toBeNull();
    expect(n).toBe(2);
    expect((await sql(`select 1 from public.fin_transactions where account_id = $1 and source = 'gmail' and review_status = 'needs_review'`, [acc])).length).toBe(2);
    expect((await sql(`select 1 from public.fin_events where action = 'card_linked'`)).length).toBe(1);

    // Later card alerts go straight in.
    const later = await record(conn, [alert({ last4: '5678', reference_no: '' })]);
    expect(later.recorded).toBe(1);

    // The card digits cannot belong to two accounts.
    const other = await account(k, '4321');
    const clash = await k.rpc('fin_account_link_card', { p_account: other, p_last4: '5678' });
    expect(clash.error?.message).toContain('already ends in 5678');
    expect((await k.rpc('fin_account_link_card', { p_account: other, p_last4: '12345' })).error).not.toBeNull();
  });

  it('reads again: fills in missing details, works out unused alerts afresh, flags changes and leaves handled ones alone', async () => {
    const k = await login('Kartik');
    const acc = await account(k, '1234');
    const conn = await connect(k);
    const recorded = alert({ reference_no: '', counterparty: '' });
    const confirmed = alert({ reference_no: '', counterparty: '' });
    const unread = alert({ readable: false, direction: null, amount_paise: null, last4: '', reference_no: '', counterparty: '' });
    const setAside = alert({ readable: false, direction: null, amount_paise: null, last4: '', reference_no: '', counterparty: '' });
    const changed = alert({ reference_no: '', counterparty: '' });
    await record(conn, [recorded, confirmed, unread, setAside, changed]);
    const txn = async (m: string) => (await sql<{ transaction_id: string }>('select transaction_id from public.fin_gmail_alerts where message_id = $1', [m]))[0].transaction_id;
    const confirmedTxn = await txn(confirmed.message_id);
    expect((await k.rpc('fin_txn_confirm', { p_ids: [confirmedTxn] })).error).toBeNull();
    const aside = (await sql<{ id: string }>('select id from public.fin_gmail_alerts where message_id = $1', [setAside.message_id]))[0].id;
    expect((await k.rpc('fin_gmail_alert_ignore', { p_alert: aside, p_reason: 'Not needed' })).error).toBeNull();

    // Nobody signed in can call it; only the server can.
    expect((await k.rpc('fin_gmail_reread', { p_connection: conn, p_actor: ids.Kartik, p_alerts: [] })).error).not.toBeNull();

    const better = (a: Record<string, unknown>, over: Record<string, unknown>) => ({ ...a, ...over });
    const { data, error } = await admin.rpc('fin_gmail_reread', {
      p_connection: conn, p_actor: ids.Kartik, p_alerts: [
        better(recorded, { reference_no: 'UTR0000000001', counterparty: 'ACME RETAIL' }),
        better(confirmed, { reference_no: 'UTR0000000002', counterparty: 'ACME RETAIL' }),
        better(unread, { readable: true, direction: 'in', amount_paise: L(970), last4: '1234', counterparty: 'TRAVEL SITE' }),
        better(setAside, { readable: true, direction: 'in', amount_paise: L(500), last4: '1234' }),
        better(changed, { amount_paise: L(1), reference_no: 'UTR0000000003' }),
      ],
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ read: 5, filled_in: 2, recorded: 1, differs: 1, unchanged: 1 });

    const t = (await sql<{ reference_no: string; counterparty: string }>('select reference_no, counterparty from public.fin_transactions where id = $1', [await txn(recorded.message_id)]))[0];
    expect(t).toEqual({ reference_no: 'UTR0000000001', counterparty: 'ACME RETAIL' });
    // A confirmed transaction gets only its blank reference and payee filled in, and the history says so.
    const c = (await sql<{ reference_no: string; counterparty: string; review_status: string }>('select reference_no, counterparty, review_status from public.fin_transactions where id = $1', [confirmedTxn]))[0];
    expect(c).toEqual({ reference_no: 'UTR0000000002', counterparty: 'ACME RETAIL', review_status: 'confirmed' });
    const hist = await sql<{ actor_member_id: string; details: Record<string, unknown> }>(`select actor_member_id, details from public.fin_events where entity_id = $1 and action = 'details_filled'`, [confirmedTxn]);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ actor_member_id: ids.Kartik, details: { by: 'read_again', reference_no: { before: '', after: 'UTR0000000002' } } });
    // An email that now reads differently leaves its transaction as it was and says so on the alert.
    const ch = (await sql<{ amount_paise: string; reference_no: string; note: string }>('select t.amount_paise, t.reference_no, a.note from public.fin_gmail_alerts a join public.fin_transactions t on t.id = a.transaction_id where a.message_id = $1', [changed.message_id]))[0];
    expect(ch).toMatchObject({ reference_no: '', note: 'Read again: this email says money out of ₹1.00. Check the transaction' });
    expect(Number(ch.amount_paise)).toBe(changed.amount_paise);
    // The unused alert is now a transaction waiting to be checked; the set-aside one stays set aside.
    const now = await sql<{ message_id: string; status: string }>('select message_id, status from public.fin_gmail_alerts where message_id = any($1) order by message_id', [[unread.message_id, setAside.message_id]]);
    expect(now.map((r) => r.status)).toEqual(['recorded', 'ignored']);
    expect((await sql(`select 1 from public.fin_transactions where account_id = $1 and direction = 'in' and amount_paise = $2`, [acc, L(970)])).length).toBe(1);

    // Reading again a second time changes nothing more.
    const again = await admin.rpc('fin_gmail_reread', {
      p_connection: conn, p_actor: ids.Kartik, p_alerts: [better(recorded, { reference_no: 'UTR0000000001', counterparty: 'ACME RETAIL' })],
    });
    expect(again.data).toMatchObject({ read: 1, filled_in: 0, unchanged: 1 });
    expect((await sql('select 1 from public.fin_transactions')).length).toBe(4);
  });
});
