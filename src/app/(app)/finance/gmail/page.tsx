import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { googleConfig } from '@/lib/gmail';
import { checkStaleSoon } from '@/lib/gmail-sync';
import { inr, localParts, plusDays, todayIn } from '@/lib/finance';
import { isNoticeNote } from '@/lib/bank-alerts';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { loadAccounts } from '../data';
import { Field, accountName } from '../parts';
import { assignAlertAction, checkNowAction, confirmTxnsAction, disconnectAction, ignoreAlertAction, rereadAction, saveSendersAction } from './actions';

export const metadata = { title: 'Bank emails' };
export const maxDuration = 60;

type SP = { error?: string; detail?: string; connected?: string };

const ERRORS: Record<string, string> = {
  admin: 'Only the Super Admin can connect or disconnect a mailbox.',
  setup: 'Google sign-in is not set up on the server yet. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET need to be added in Vercel.',
  expired: 'The Google sign-in took too long or was started in another tab. Click Connect Gmail again.',
  denied: 'Nothing was connected because access was not allowed on Google\'s screen.',
  google: 'Google sign-in did not finish.',
  save: 'The mailbox could not be saved.',
};

const STATUS: Record<string, { label: string; tone: string }> = {
  recorded: { label: 'Recorded', tone: 'text-green-700' },
  balance_only: { label: 'Balance updated', tone: 'text-green-700' },
  duplicate: { label: 'Already recorded', tone: 'text-slate-500' },
  no_account: { label: 'Choose an account', tone: 'text-amber-700' },
  unreadable: { label: 'Could not read', tone: 'text-amber-700' },
  ignored: { label: 'Set aside', tone: 'text-slate-500' },
};

interface Connection {
  id: string;
  email: string;
  senders: string[];
  import_from: string;
  connected_at: string;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  last_sync_message: string;
}

interface Alert {
  id: string;
  message_id: string;
  received_at: string;
  subject: string;
  status: string;
  direction: 'in' | 'out' | null;
  amount_paise: number | null;
  last4: string;
  reference_no: string;
  counterparty: string;
  balance_paise: number | null;
  account_id: string | null;
  transaction_id: string | null;
  note: string;
}

export default async function BankEmailsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const tz = me.timezone;
  const today = todayIn(tz);
  const supabase = await createClient();
  const [{ data: conns }, { data: alertRows }, { data: toCheck }, accounts] = await Promise.all([
    supabase.from('fin_gmail_connections').select('id, email, senders, import_from, connected_at, last_sync_at, last_sync_ok, last_sync_message').is('disconnected_at', null).order('connected_at'),
    supabase.from('fin_gmail_alerts').select('id, message_id, received_at, subject, status, direction, amount_paise, last4, reference_no, counterparty, balance_paise, account_id, transaction_id, note').order('received_at', { ascending: false }).limit(200),
    supabase.from('fin_transactions').select('id').eq('review_status', 'needs_review').is('voided_at', null).limit(500),
    loadAccounts(supabase),
  ]);
  const connections = (conns ?? []) as Connection[];
  const alerts = ((alertRows ?? []) as Alert[]).map((a) => ({ ...a, amount_paise: a.amount_paise == null ? null : Number(a.amount_paise), balance_paise: a.balance_paise == null ? null : Number(a.balance_paise) }));
  // Notices such as a failed payment or a forex fee are not payments, so they need nothing doing.
  const notice = (a: Alert) => a.status === 'unreadable' && isNoticeNote(a.note);
  const open = alerts.filter((a) => a.status === 'no_account' || (a.status === 'unreadable' && !notice(a)));
  const reviewIds = (toCheck ?? []).map((t) => t.id as string);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const accountDigits = new Set(accounts.flatMap((a) => [a.last4, a.card_last4]).filter(Boolean));
  const openByDigits = new Map<string, number>();
  for (const a of open) if (a.status === 'no_account' && a.last4) openByDigits.set(a.last4, (openByDigits.get(a.last4) ?? 0) + 1);
  const configured = Boolean(googleConfig());
  const when = (iso: string) => {
    const p = localParts(iso, tz);
    return `${fmtDate(p.date)} ${p.time}`;
  };
  if (connections.length) checkStaleSoon(me.memberId);

  return (
    <>
      <PageHeader
        title="Bank emails"
        subtitle="Reads your bank's transaction alert emails with Google's read-only permission. The app cannot send, change or remove any email, and keeps only the amount, account digits, reference and balance, never the email itself."
      />
      {sp.connected && <Notice>Mailbox connected. The first check has started; refresh in a minute to see what it found.</Notice>}
      {sp.error && (
        <Notice tone="error">
          {ERRORS[sp.error] ?? 'Something went wrong.'} {sp.detail ? sp.detail.slice(0, 200) : ''}
        </Notice>
      )}

      {connections.length === 0 ? (
        me.isAdmin ? (
          <div className="card max-w-2xl space-y-3 p-4">
            <h2 className="text-base font-semibold text-navy-900">Connect the mailbox that gets your bank alerts</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Google asks you to sign in and allow <strong>read-only</strong> access to Gmail.</li>
              <li>The app then looks only at emails from your bank&apos;s alert addresses (HDFC Bank to start with).</li>
              <li>Each alert becomes a transaction marked &quot;to check&quot;, and the available balance in an alert updates that bank&apos;s balance.</li>
            </ol>
            {!configured && <Notice tone="warn">{ERRORS.setup}</Notice>}
            <form method="get" action="/api/finance/gmail/start" className="flex flex-wrap items-end gap-3">
              <Field label="Read alerts from" htmlFor="gm-from" hint="Up to 90 days back.">
                <input id="gm-from" name="from" type="date" className="input" defaultValue={plusDays(today, -30)} min={plusDays(today, -90)} max={today} required />
              </Field>
              <button type="submit" className="btn-primary" disabled={!configured}>Connect Gmail</button>
            </form>
          </div>
        ) : (
          <EmptyState title="No mailbox connected" body="The Super Admin can connect the mailbox that receives the bank alerts. Until then, add transactions by hand." />
        )
      ) : (
        connections.map((c) => (
          <div key={c.id} className="card mb-4 space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-navy-900">{c.email}</div>
                <div className="text-sm text-slate-600">Reading alerts from {fmtDate(c.import_from)} · connected {when(c.connected_at)}</div>
                <div className={`mt-1 text-sm ${c.last_sync_ok === false ? 'text-red-700' : 'text-slate-600'}`}>
                  {c.last_sync_at ? <>Last checked {when(c.last_sync_at)}{c.last_sync_message ? `: ${c.last_sync_message}` : c.last_sync_ok ? ', all fine' : ''}</> : 'Not checked yet'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={checkNowAction}>
                  <input type="hidden" name="connection" value={c.id} />
                  <SubmitButton pendingText="Checking…">Check for new alerts</SubmitButton>
                </ActionForm>
                <ActionForm action={rereadAction}>
                  <input type="hidden" name="connection" value={c.id} />
                  <SubmitButton className="btn-secondary" pendingText="Reading again…">Read again</SubmitButton>
                </ActionForm>
                {me.isAdmin && (
                  <ConfirmAction
                    action={disconnectAction}
                    hidden={{ connection: c.id }}
                    label="Disconnect"
                    className="btn-secondary"
                    title={`Disconnect ${c.email}?`}
                    body="The app stops reading this mailbox and asks Google to cancel its access. What was already recorded stays."
                    confirmLabel="Disconnect"
                  />
                )}
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-navy-700">Which emails are read ({c.senders.length} address{c.senders.length === 1 ? '' : 'es'})</summary>
              {me.isAdmin ? (
                <ActionForm action={saveSendersAction} className="mt-2 max-w-xl space-y-2">
                  <input type="hidden" name="connection" value={c.id} />
                  <Field label="Alert sender addresses" htmlFor={`gm-senders-${c.id}`} hint="One per line. A whole domain like hdfcbank.net also works. Gmail must confirm each email really came from that address.">
                    <textarea id={`gm-senders-${c.id}`} name="senders" rows={3} className="input font-mono text-sm" defaultValue={c.senders.join('\n')} />
                  </Field>
                  <div className="flex justify-end"><SubmitButton>Save addresses</SubmitButton></div>
                </ActionForm>
              ) : (
                <ul className="mt-2 font-mono text-sm text-slate-700">{c.senders.map((s) => <li key={s}>{s}</li>)}</ul>
              )}
            </details>
          </div>
        ))
      )}

      {reviewIds.length > 0 && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-900">
            <strong>{reviewIds.length}</strong> transaction{reviewIds.length === 1 ? '' : 's'} from bank emails to check. Until confirmed they do not count towards balances.{' '}
            <Link href="/finance/transactions?review=1" className="font-medium underline">Check them</Link>
          </div>
          <ActionForm action={confirmTxnsAction}>
            <input type="hidden" name="ids" value={reviewIds.join(',')} />
            <SubmitButton className="btn-secondary" pendingText="Confirming…">Confirm all {reviewIds.length}</SubmitButton>
          </ActionForm>
        </div>
      )}

      {open.length > 0 && (
        <>
          <SectionTitle>To sort out</SectionTitle>
          <div className="space-y-2">
            {open.map((a) => (
              <div key={a.id} className="card flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-navy-900">
                    {a.amount_paise != null ? `${a.direction === 'in' ? 'Money in' : 'Money out'} ${inr(a.amount_paise)}` : a.balance_paise != null ? `Balance ${inr(a.balance_paise)}` : a.subject || 'Bank email'}
                    {a.counterparty && <span className="font-normal text-slate-600"> · {a.counterparty}</span>}
                  </div>
                  <div className="text-xs text-slate-500">{when(a.received_at)}{a.reference_no && ` · Ref ${a.reference_no}`}{a.last4 && ` · account or card ending ${a.last4}`}</div>
                  <div className="mt-1 text-amber-800">{a.note}</div>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {a.status === 'no_account' && accounts.length > 0 && (
                    <ActionForm action={assignAlertAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="alert" value={a.id} />
                      <input type="hidden" name="last4" value={a.last4} />
                      <select name="account" className="input w-auto" aria-label="Bank account" required defaultValue="">
                        <option value="" disabled>Choose account…</option>
                        {accounts.map((x) => <option key={x.id} value={x.id}>{accountName(x)}</option>)}
                      </select>
                      <SubmitButton className="btn-secondary" pendingText="Recording…">Record</SubmitButton>
                      {a.last4 && !accountDigits.has(a.last4) && (
                        <label className="flex basis-full items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" name="remember" value="1" defaultChecked={(openByDigits.get(a.last4) ?? 0) > 1} />
                          It&apos;s a debit card on this account: record all {openByDigits.get(a.last4) ?? 1} ending {a.last4}, and future ones
                        </label>
                      )}
                    </ActionForm>
                  )}
                  <a className="btn-ghost" href={`https://mail.google.com/mail/u/0/#all/${a.message_id}`} target="_blank" rel="noreferrer noopener">Open in Gmail</a>
                  <ConfirmAction
                    action={ignoreAlertAction}
                    hidden={{ alert: a.id }}
                    label="Set aside"
                    className="btn-ghost"
                    title="Set this email aside?"
                    body="Nothing is recorded from it. It stays in the list below as set aside."
                    confirmLabel="Set aside"
                    withNote
                    notePlaceholder="Why (optional), e.g. an offer, not a transaction"
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {connections.length > 0 && (
        <>
          <SectionTitle>Recent bank emails</SectionTitle>
          {alerts.length === 0 ? (
            <EmptyState title="No bank alerts read yet" body="Click Check for new alerts, or come back in a few minutes." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="sheet">
                <thead>
                  <tr><th>Received</th><th>What it says</th><th>Account</th><th>Reference</th><th className="text-right">Amount</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {alerts.slice(0, 100).map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-sm">{when(a.received_at)}</td>
                      <td className="max-w-xs text-sm">
                        <div className="truncate">{a.counterparty || a.subject || 'Bank email'}</div>
                        {a.balance_paise != null && <div className="text-xs text-slate-500">Balance {inr(a.balance_paise)}</div>}
                        {notice(a) && <div className="text-xs text-slate-500">{a.note}</div>}
                        {!notice(a) && a.transaction_id && a.note && <div className="text-xs text-amber-700">{a.note}</div>}
                      </td>
                      <td className="whitespace-nowrap text-sm">{a.account_id ? accountName(byId.get(a.account_id)) : a.last4 ? `ending ${a.last4}` : '—'}</td>
                      <td className="font-mono text-xs">{a.reference_no}</td>
                      <td className="whitespace-nowrap text-right text-sm tabular-nums">
                        {a.amount_paise != null ? <span className={a.direction === 'in' ? 'text-green-700' : ''}>{a.direction === 'in' ? '+' : '−'}{inr(a.amount_paise)}</span> : '—'}
                      </td>
                      <td className={`whitespace-nowrap text-sm ${notice(a) ? 'text-slate-500' : STATUS[a.status]?.tone ?? ''}`}>
                        {notice(a) ? 'Not a payment' : a.transaction_id ? <Link href={`/finance/transactions/${a.transaction_id}`} className="hover:underline">{STATUS[a.status]?.label}</Link> : STATUS[a.status]?.label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
