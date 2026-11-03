import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { localParts, rupeesField } from '@/lib/finance';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { loadAccounts, loadBalances, loadSettings } from '../data';
import { saveSettingsAction } from '../actions';
import { Field, Money, RupeeInput, accountKind, accountName } from '../parts';

export const metadata = { title: 'Banks' };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const supabase = await createClient();
  const [{ balances, available }, all, settings] = await Promise.all([loadBalances(supabase), loadAccounts(supabase, true), loadSettings(supabase)]);
  const archived = all.filter((a) => a.archived_at);

  return (
    <>
      <PageHeader
        title="Banks"
        subtitle="Each account's balance is the latest balance you recorded plus the transactions after it. Only the last 4 digits of account numbers are kept."
        actions={<Link href="/finance/accounts/new" className="btn-primary whitespace-nowrap">Add a bank account</Link>}
      />
      {sp.added && <Notice>Account added with its opening balance.</Notice>}

      {balances.length === 0 ? (
        <EmptyState title="No bank accounts yet" body="Add each account the business uses, with its balance today." action={<Link href="/finance/accounts/new" className="btn-primary">Add a bank account</Link>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr><th>Account</th><th>Type</th><th className="text-right">Balance</th><th>Last balance recorded</th><th>Since then</th></tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.account.id}>
                  <td>
                    <Link href={`/finance/accounts/${b.account.id}`} className="font-medium text-navy-900 hover:underline">{accountName(b.account)}</Link>
                    {b.account.bank && <div className="text-xs text-slate-500">{b.account.bank}</div>}
                  </td>
                  <td>{accountKind(b.account.kind)}</td>
                  <td className="text-right"><Money paise={b.balance} className="font-semibold" /></td>
                  <td className="whitespace-nowrap text-sm">
                    {b.reading ? (
                      <>
                        <Money paise={b.reading.balance_paise} /> <span className="text-slate-500">on {fmtDate(localParts(b.reading.as_of, me.timezone).date)}</span>
                        {b.reported && <div className="text-xs text-amber-700">Last reported by the bank, not live</div>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="text-sm text-slate-600">{b.movedSince ? `${b.movedSince} transaction${b.movedSince === 1 ? '' : 's'}` : 'None'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Total</th><th /><th className="text-right"><Money paise={available} /></th><th /><th /></tr>
            </tfoot>
          </table>
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-navy-700">Accounts no longer in use ({archived.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {archived.map((a) => (
              <li key={a.id}><Link href={`/finance/accounts/${a.id}`} className="text-navy-900 hover:underline">{accountName(a)}</Link></li>
            ))}
          </ul>
        </details>
      )}

      <SectionTitle>
        <span id="alert-settings">Alert amounts</span>
      </SectionTitle>
      <ActionForm action={saveSettingsAction} className="card max-w-2xl space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum cash to keep" htmlFor="set-min" hint="You are warned when cash is, or is planned to go, under this. 0 turns it off.">
            <RupeeInput id="set-min" name="min_cash" defaultValue={rupeesField(settings.min_cash_paise)} placeholder="5,00,000" required={false} />
          </Field>
          <Field label="Flag unplanned debits from" htmlFor="set-large" hint="A debit this big or bigger that is not a planned payment is flagged. 0 turns it off.">
            <RupeeInput id="set-large" name="large_debit" defaultValue={rupeesField(settings.large_debit_paise)} placeholder="1,00,000" required={false} />
          </Field>
        </div>
        <div className="flex justify-end"><SubmitButton>Save alert amounts</SubmitButton></div>
      </ActionForm>
    </>
  );
}
