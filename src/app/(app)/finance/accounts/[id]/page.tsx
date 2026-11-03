import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { accountBalances, localParts, todayIn } from '@/lib/finance';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { memberNames } from '../../../attendance/data';
import { loadAccounts, loadEvents, loadReadings, loadTxns } from '../../data';
import { archiveAccountAction, recordBalanceAction, saveAccountAction } from '../../actions';
import { AccountFields } from '../../fields';
import { BackLink, Fact, Field, History, Money, RupeeInput, accountKind, accountName, categoryName } from '../../parts';

export const metadata = { title: 'Bank account' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const me = await requireFinance();
  const tz = me.timezone;
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase, true);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();
  const [readings, txns, events, names] = await Promise.all([loadReadings(supabase, id), loadTxns(supabase, { accountId: id, limit: 50 }), loadEvents(supabase, id), memberNames(supabase)]);
  const since = readings[0]?.as_of;
  const after = since ? await loadTxns(supabase, { accountId: id, since }) : [];
  const [bal] = accountBalances([account], readings, after);
  const today = todayIn(tz);
  const at = (iso: string) => {
    const p = localParts(iso, tz);
    return `${fmtDate(p.date)} ${p.time}`;
  };

  return (
    <div className="max-w-4xl">
      <BackLink href="/finance/accounts">Banks</BackLink>
      <PageHeader
        title={accountName(account)}
        subtitle={[account.bank, accountKind(account.kind)].filter(Boolean).join(' · ')}
        actions={!account.archived_at ? <Link href={`/finance/transactions/new?account=${id}`} className="btn-secondary whitespace-nowrap">Add a transaction</Link> : undefined}
      />
      {account.archived_at && <Notice tone="warn">This account is no longer in use. Its history is kept.</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="card p-4">
          <Fact label="Balance now"><Money paise={bal.balance} className="text-lg" /></Fact>
          <Fact label="Last balance recorded">{bal.reading ? <><Money paise={bal.reading.balance_paise} /> on {at(bal.reading.as_of)}</> : '—'}</Fact>
          <Fact label="Transactions since">{bal.movedSince}</Fact>
          {account.notes && <Fact label="Notes"><span className="whitespace-pre-line font-normal">{account.notes}</span></Fact>}
        </dl>

        {!account.archived_at && (
          <ActionForm action={recordBalanceAction} resetOnSuccess className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-navy-900">Record the balance from your bank</h2>
            <p className="text-xs text-slate-600">Use this when the bank shows a different balance, e.g. after charges or interest. Transactions after this moment are added to it.</p>
            <input type="hidden" name="account" value={id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Balance" htmlFor="bal-amount" className="sm:col-span-3">
                <RupeeInput id="bal-amount" name="balance" />
              </Field>
              <Field label="Date" htmlFor="bal-date" className="sm:col-span-2">
                <input id="bal-date" name="as_of_date" type="date" className="input" required defaultValue={today} max={today} />
              </Field>
              <Field label="Time" htmlFor="bal-time">
                <input id="bal-time" name="as_of_time" type="time" className="input" defaultValue={localParts(new Date().toISOString(), tz).time} />
              </Field>
            </div>
            <Field label="Note" htmlFor="bal-note">
              <input id="bal-note" name="note" className="input" maxLength={300} placeholder="From net banking" />
            </Field>
            <div className="flex justify-end"><SubmitButton>Record balance</SubmitButton></div>
          </ActionForm>
        )}
      </div>

      <SectionTitle action={<Link href={`/finance/transactions?account=${id}`} className="text-sm text-navy-700 hover:underline">All transactions</Link>}>Recent transactions</SectionTitle>
      {txns.length === 0 ? (
        <p className="card p-4 text-sm text-slate-600">No transactions yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead><tr><th>When</th><th>Details</th><th>Category</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {txns.slice(0, 20).map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap text-sm">{at(t.txn_at)}</td>
                  <td><Link href={`/finance/transactions/${t.id}`} className="text-navy-900 hover:underline">{t.counterparty || t.description || 'Transaction'}</Link></td>
                  <td className="text-sm">{categoryName(t.category)}</td>
                  <td className="text-right"><Money paise={t.direction === 'in' ? t.amount_paise : -t.amount_paise} signed plain className={t.direction === 'in' ? 'text-green-700' : ''} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Balances recorded</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="sheet">
          <thead><tr><th>As on</th><th className="text-right">Balance</th><th>From</th><th>Note</th></tr></thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-sm">{at(r.as_of)}</td>
                <td className="text-right"><Money paise={r.balance_paise} /></td>
                <td className="text-sm">{r.source === 'gmail' ? 'Bank email' : r.source === 'statement' ? 'Statement' : 'Entered by hand'}</td>
                <td className="text-sm text-slate-600">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!account.archived_at && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-navy-800">Edit account details</summary>
          <ActionForm action={saveAccountAction} className="card mt-2 space-y-4 p-4">
            <AccountFields account={account} today={today} />
            <div className="flex justify-end"><SubmitButton>Save account</SubmitButton></div>
          </ActionForm>
        </details>
      )}

      <SectionTitle>History</SectionTitle>
      <div className="card p-4"><History events={events} names={names} timeZone={tz} /></div>

      <div className="mt-6 flex justify-end">
        {account.archived_at ? (
          <ConfirmAction action={archiveAccountAction} hidden={{ id, archived: '0' }} label="Use this account again" title="Use this account again?" body="It comes back into balances and the forecast." confirmLabel="Use again" className="btn-secondary" />
        ) : (
          <ConfirmAction
            action={archiveAccountAction}
            hidden={{ id, archived: '1' }}
            label="Stop using this account"
            title="Stop using this account?"
            body="It leaves balances and the forecast. Its balances and transactions are kept and you can use it again later."
            confirmLabel="Stop using it"
          />
        )}
      </div>
    </div>
  );
}
