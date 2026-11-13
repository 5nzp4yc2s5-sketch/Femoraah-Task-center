'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireFinance } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import { revokeToken } from '@/lib/gmail';
import { checkMailbox, rereadMailbox } from '@/lib/gmail-sync';
import type { ActionState } from '@/lib/types';

const UUID = z.uuid();

function done() {
  revalidatePath('/finance', 'layout');
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  return error ? { data: null, error: friendlyError(error.message) } : { data };
}

export async function checkNowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireFinance();
  const id = UUID.safeParse(formData.get('connection'));
  if (!id.success) return { error: 'Mailbox not found' };
  // The person's own session must be able to see the connection before the server uses it.
  const supabase = await createClient();
  const { data } = await supabase.from('fin_gmail_connections').select('id').eq('id', id.data).is('disconnected_at', null).maybeSingle();
  if (!data) return { error: 'This mailbox is no longer connected.' };
  const r = await checkMailbox(id.data, me.memberId);
  done();
  return r.ok ? { ok: r.message } : { error: r.message };
}

export async function rereadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireFinance();
  const id = UUID.safeParse(formData.get('connection'));
  if (!id.success) return { error: 'Mailbox not found' };
  const supabase = await createClient();
  const { data } = await supabase.from('fin_gmail_connections').select('id').eq('id', id.data).is('disconnected_at', null).maybeSingle();
  if (!data) return { error: 'This mailbox is no longer connected.' };
  const r = await rereadMailbox(id.data, me.memberId);
  done();
  return r.ok ? { ok: r.message } : { error: r.message };
}

export async function disconnectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireFinance();
  if (!me.isAdmin) return { error: 'Only the Super Admin can disconnect a mailbox' };
  const id = UUID.safeParse(formData.get('connection'));
  if (!id.success) return { error: 'Mailbox not found' };
  // Ask Google to cancel the permission too; the stored copy is overwritten either way.
  const { data: token } = await createAdminClient().rpc('fin_gmail_token', { p_id: id.data });
  const revoked = typeof token === 'string' && token.length > 20 ? await revokeToken(token) : false;
  const r = await rpc('fin_gmail_disconnect', { p_id: id.data });
  if (r.error) return { error: r.error };
  done();
  return { ok: revoked ? 'Disconnected. Google has cancelled the app\'s access.' : 'Disconnected. The app no longer reads this mailbox.' };
}

export async function saveSendersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const id = UUID.safeParse(formData.get('connection'));
  if (!id.success) return { error: 'Mailbox not found' };
  const senders = String(formData.get('senders') ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const r = await rpc('fin_gmail_set_senders', { p_id: id.data, p_senders: senders });
  if (r.error) return { error: r.error };
  done();
  return { ok: 'Saved. Only emails from these addresses are read.' };
}

export async function assignAlertAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const alert = UUID.safeParse(formData.get('alert'));
  const account = UUID.safeParse(formData.get('account'));
  if (!alert.success) return { error: 'Alert not found' };
  if (!account.success) return { error: 'Choose a bank account' };
  const last4 = String(formData.get('last4') ?? '');
  if (formData.get('remember') && /^\d{4}$/.test(last4)) {
    const linked = await rpc('fin_account_link_card', { p_account: account.data, p_last4: last4 });
    if (linked.error) return { error: linked.error };
    done();
    const n = Number(linked.data ?? 0);
    return { ok: `Card ending ${last4} is now on this account. ${n} alert${n === 1 ? '' : 's'} recorded; check them under Transactions.` };
  }
  const r = await rpc('fin_gmail_alert_assign', { p_alert: alert.data, p_account: account.data });
  if (r.error) return { error: r.error };
  done();
  return { ok: r.data === 'duplicate' ? 'That reference is already recorded on this account, so nothing was added.' : 'Recorded. Check it under Transactions.' };
}

export async function ignoreAlertAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const alert = UUID.safeParse(formData.get('alert'));
  if (!alert.success) return { error: 'Alert not found' };
  const r = await rpc('fin_gmail_alert_ignore', { p_alert: alert.data, p_reason: String(formData.get('note') ?? '').slice(0, 300) });
  if (r.error) return { error: r.error };
  done();
  return { ok: 'Set aside.' };
}

export async function confirmTxnsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireFinance();
  const ids = String(formData.get('ids') ?? '').split(',').filter((s) => UUID.safeParse(s).success).slice(0, 500);
  if (!ids.length) return { error: 'Nothing to confirm' };
  const r = await rpc('fin_txn_confirm', { p_ids: ids });
  if (r.error) return { error: r.error };
  done();
  const n = Number(r.data ?? 0);
  return { ok: `${n} transaction${n === 1 ? '' : 's'} confirmed.` };
}
