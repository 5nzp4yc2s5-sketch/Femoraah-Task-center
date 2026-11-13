import 'server-only';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fromAddress, parseAlert, senderVerified } from '@/lib/bank-alerts';
import { GoogleError, accessTokenFrom, googleConfig, readMessage, searchMessages, type MailMessage } from '@/lib/gmail';
import { zonedIso } from '@/lib/finance';

// Checks a connected mailbox for new bank alert emails and records what they say. Runs on the
// server only: it reads the stored Google permission with the service role, which nobody signed in
// to the app can do. Email text is read in memory and thrown away; only the facts are saved.

const PER_CHECK = 150;
const STALE_MINUTES = 30;

export interface CheckResult {
  ok: boolean;
  message: string;
}

type Counts = Record<'new' | 'recorded' | 'balance_only' | 'duplicate' | 'no_account' | 'unreadable', number>;

function senderAllowed(from: string, senders: string[]): boolean {
  return senders.some((s) => (s.includes('@') ? from === s : from.endsWith(`@${s}`) || from.endsWith(`.${s}`)));
}

function summary(c: Counts, remaining: number): string {
  if (!c.new) return remaining ? `No new alerts recorded yet; ${remaining} more emails will be read on the next check.` : 'No new bank alerts.';
  const parts = [
    c.recorded && `${c.recorded} recorded for checking`,
    c.balance_only && `${c.balance_only} balance update${c.balance_only === 1 ? '' : 's'}`,
    c.duplicate && `${c.duplicate} already recorded`,
    c.no_account && `${c.no_account} need${c.no_account === 1 ? 's' : ''} an account chosen`,
    c.unreadable && `${c.unreadable} could not be read`,
  ].filter(Boolean);
  const more = remaining ? ` ${remaining} more will be read on the next check.` : '';
  return `Read ${c.new} new alert${c.new === 1 ? '' : 's'}: ${parts.join(', ')}.${more}`;
}

/** What one email says, in the shape fin_gmail_record and fin_gmail_reread take. */
function alertRow(m: MailMessage, senders: string[]): Record<string, unknown> {
  const from = fromAddress(m.from);
  const allowed = senderAllowed(from, senders);
  const verified = allowed && senderVerified(m.authResults, from);
  const parsed = verified ? parseAlert(m.subject, m.body) : null;
  return {
    message_id: m.id,
    received_at: m.receivedAt,
    sender: from,
    subject: m.subject.slice(0, 200),
    readable: parsed?.readable ?? false,
    direction: parsed?.direction ?? null,
    amount_paise: parsed?.amount_paise ?? null,
    last4: parsed?.last4 ?? '',
    reference_no: parsed?.reference_no ?? '',
    counterparty: parsed?.counterparty ?? '',
    balance_paise: parsed?.balance_paise ?? null,
    note: !allowed ? 'Not from a bank alert address on the list'
      : !verified ? 'Gmail could not confirm this email came from the bank, so it was not used'
      : parsed?.note ?? '',
  };
}

async function accessFor(admin: ReturnType<typeof createAdminClient>, connectionId: string): Promise<string> {
  const { data: token, error } = await admin.rpc('fin_gmail_token', { p_id: connectionId });
  if (error || typeof token !== 'string' || token.length < 20) {
    throw new GoogleError('The saved Google permission could not be read. Connect the mailbox again.', 'no_token');
  }
  return accessTokenFrom(token);
}

/** Reads new alerts from one mailbox. `actor` is the person whose visit or button started it. */
export async function checkMailbox(connectionId: string, actor: string | null): Promise<CheckResult> {
  const admin = createAdminClient();
  const { data: c } = await admin
    .from('fin_gmail_connections')
    .select('id, senders, import_from, seen_until')
    .eq('id', connectionId)
    .is('disconnected_at', null)
    .maybeSingle();
  if (!c) return { ok: false, message: 'This mailbox is no longer connected.' };

  const record = async (alerts: unknown[], seenUntil: string | null, ok: boolean, message: string): Promise<Counts> => {
    const { data, error } = await admin.rpc('fin_gmail_record', {
      p_connection: c.id, p_actor: actor, p_alerts: alerts, p_seen_until: seenUntil, p_ok: ok, p_message: message,
    });
    if (error) throw new Error(error.message);
    return data as Counts;
  };

  try {
    const access = await accessFor(admin, c.id as string);

    const { data: settings } = await admin.from('app_settings').select('timezone').limit(1).maybeSingle();
    const tz = (settings?.timezone as string | undefined) ?? 'Asia/Kolkata';
    const fromMs = Date.parse(zonedIso(c.import_from as string, '00:00', tz));
    const startMs = Math.max(fromMs, c.seen_until ? Date.parse(c.seen_until as string) - 2 * 86_400_000 : 0);
    const senders = (c.senders as string[]).map((s) => s.toLowerCase());
    const q = `from:(${senders.join(' OR ')}) after:${Math.floor(startMs / 1000)}`;

    const ids = await searchMessages(access, q, 1000);
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from('fin_gmail_alerts').select('message_id').in('message_id', ids.slice(i, i + 200));
      for (const r of data ?? []) known.add(r.message_id as string);
    }
    const fresh = ids.filter((id) => !known.has(id)).reverse(); // oldest first
    const batch = fresh.slice(0, PER_CHECK);
    const alerts: Record<string, unknown>[] = [];
    let seenUntil: string | null = null;
    for (let i = 0; i < batch.length; i += 10) {
      const messages = await Promise.all(batch.slice(i, i + 10).map((id) => readMessage(access, id)));
      for (const m of messages) {
        if (Date.parse(m.receivedAt) < fromMs) continue;
        alerts.push(alertRow(m, senders));
        if (!seenUntil || m.receivedAt > seenUntil) seenUntil = m.receivedAt;
      }
    }
    const remaining = fresh.length - batch.length;
    const counts = await record(alerts, seenUntil, true, remaining ? `${remaining} more emails to read on the next check` : '');
    return { ok: true, message: summary(counts, remaining) };
  } catch (e) {
    const message = e instanceof GoogleError ? e.message : 'The check did not finish. Try again in a few minutes.';
    if (!(e instanceof GoogleError)) console.error('gmail check failed', e instanceof Error ? e.message : 'unknown error');
    await record([], null, false, message).catch(() => undefined);
    return { ok: false, message };
  }
}

const REREAD_LIMIT = 300;

/**
 * Reads again the emails already on file, with the current reader. Alerts not used yet are worked
 * out afresh; transactions still waiting to be checked get a missing reference or payee filled in.
 */
export async function rereadMailbox(connectionId: string, actor: string): Promise<CheckResult> {
  const admin = createAdminClient();
  const { data: c } = await admin.from('fin_gmail_connections').select('id, senders').eq('id', connectionId).is('disconnected_at', null).maybeSingle();
  if (!c) return { ok: false, message: 'This mailbox is no longer connected.' };
  try {
    const access = await accessFor(admin, c.id as string);
    const senders = (c.senders as string[]).map((s) => s.toLowerCase());
    const { data: rows } = await admin
      .from('fin_gmail_alerts')
      .select('message_id')
      .eq('connection_id', c.id)
      .neq('status', 'ignored')
      .order('received_at', { ascending: false })
      .limit(REREAD_LIMIT);
    const ids = (rows ?? []).map((r) => r.message_id as string);
    const alerts: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const got = await Promise.all(ids.slice(i, i + 10).map((id) => readMessage(access, id).catch((e) => {
        if (e instanceof GoogleError && (e.code === 'NOT_FOUND' || e.code === 'http_404')) return null; // removed from the mailbox
        throw e;
      })));
      for (const m of got) if (m) alerts.push(alertRow(m, senders));
    }
    const { data, error } = await admin.rpc('fin_gmail_reread', { p_connection: c.id, p_actor: actor, p_alerts: alerts });
    if (error) throw new Error(error.message);
    const n = data as Record<string, number>;
    const parts = [
      n.filled_in && `${n.filled_in} filled in with the reference or payee`,
      n.recorded && `${n.recorded} newly recorded for checking`,
      n.balance_only && `${n.balance_only} balance update${n.balance_only === 1 ? '' : 's'}`,
      n.no_account && `${n.no_account} still need${n.no_account === 1 ? 's' : ''} an account chosen`,
      n.unreadable && `${n.unreadable} not used`,
    ].filter(Boolean);
    return { ok: true, message: `Read ${n.read} email${n.read === 1 ? '' : 's'} again${parts.length ? `: ${parts.join(', ')}` : '. Nothing changed'}.` };
  } catch (e) {
    const message = e instanceof GoogleError ? e.message : 'Reading again did not finish. Try again in a few minutes.';
    if (!(e instanceof GoogleError)) console.error('gmail re-read failed', e instanceof Error ? e.message : 'unknown error');
    return { ok: false, message };
  }
}

/** After the page is sent, checks mailboxes not checked in the last half hour. */
export function checkStaleSoon(actor: string): void {
  if (!googleConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  after(async () => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
    const justConnected = new Date(Date.now() - 2 * 60_000).toISOString();
    // A mailbox connected in the last two minutes is still on its first check.
    const { data } = await admin
      .from('fin_gmail_connections')
      .select('id')
      .is('disconnected_at', null)
      .or(`and(last_sync_at.is.null,connected_at.lt.${justConnected}),last_sync_at.lt.${cutoff}`);
    for (const row of data ?? []) await checkMailbox(row.id as string, actor);
  });
}
