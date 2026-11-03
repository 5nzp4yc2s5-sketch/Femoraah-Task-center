import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { payableStatus, plusMonths, todayIn } from '@/lib/finance';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { memberNames } from '../../../attendance/data';
import { loadAccounts, loadEvents, loadLoans, loadPayables, refreshPlans } from '../../data';
import { closeLoanAction, saveLoanAction } from '../../actions';
import { LoanFields } from '../../fields';
import { BackLink, Fact, History, Money, ToneBadge, accountName } from '../../parts';

export const metadata = { title: 'Loan' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const me = await requireFinance();
  const tz = me.timezone;
  const supabase = await createClient();
  await refreshPlans(supabase);
  const loan = (await loadLoans(supabase, true)).find((l) => l.id === id);
  if (!loan) notFound();
  const [emis, accounts, events, names] = await Promise.all([loadPayables(supabase, { loanId: id }), loadAccounts(supabase, true), loadEvents(supabase, id), memberNames(supabase)]);
  const today = todayIn(tz);
  const live = emis.filter((p) => p.state !== 'cancelled').sort((a, b) => (a.emi_no ?? 0) - (b.emi_no ?? 0));
  const paid = loan.paid_before + live.filter((p) => p.state === 'paid').length;
  const overdue = live.filter((p) => p.state !== 'paid' && p.state !== 'on_hold' && p.due_date < today);
  const lastEmi = plusMonths(loan.first_emi_date, loan.tenure_months - 1);
  const account = accounts.find((a) => a.id === loan.account_id);

  return (
    <div className="max-w-4xl">
      <BackLink href="/finance/loans">Loans & EMIs</BackLink>
      <PageHeader title={loan.name} subtitle={loan.lender || undefined} />
      {sp.added && <Notice>Loan added. Its EMIs for the next 90 days are in Payments due.</Notice>}
      {loan.closed_at && <Notice tone="warn">This loan is closed. Its unpaid EMIs were cancelled.</Notice>}
      {!loan.closed_at && overdue.length > 0 && (
        <Notice tone="warn">
          {overdue.length} EMI{overdue.length === 1 ? ' is' : 's are'} before today and not recorded as paid. Record each one as paid, or if they were paid before you added the loan, edit the loan and set the EMIs already paid.
        </Notice>
      )}

      <dl className="card p-4">
        <Fact label="Loan amount"><Money paise={loan.principal_paise} /></Fact>
        <Fact label="Principal outstanding"><Money paise={loan.outstanding_paise} className="text-lg" /></Fact>
        <Fact label="EMI"><Money paise={loan.emi_paise} /></Fact>
        {loan.annual_rate != null && <Fact label="Interest">{loan.annual_rate}% a year</Fact>}
        <Fact label="EMIs paid">{paid} of {loan.tenure_months}</Fact>
        <Fact label="EMI dates">{fmtDate(loan.first_emi_date)} to {fmtDate(lastEmi)}</Fact>
        <Fact label="Paid from">{account ? accountName(account) : 'Not decided'}</Fact>
        {loan.notes && <Fact label="Notes"><span className="whitespace-pre-line font-normal">{loan.notes}</span></Fact>}
      </dl>
      {loan.annual_rate != null && <p className="mt-1 text-xs text-slate-500">The outstanding principal goes down by each EMI less a month&apos;s interest at this rate. Check it against your loan statement and correct it here when needed.</p>}

      <SectionTitle>EMIs planned and paid</SectionTitle>
      {live.length === 0 ? (
        <p className="card p-4 text-sm text-slate-600">No EMIs in the next 90 days.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead><tr><th>EMI</th><th>Due</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
            <tbody>
              {live.map((p) => {
                const s = payableStatus(p, today);
                return (
                  <tr key={p.id}>
                    <td><Link href={`/finance/payables/${p.id}`} className="text-navy-900 hover:underline">EMI {p.emi_no} of {loan.tenure_months}</Link></td>
                    <td className="whitespace-nowrap text-sm">{fmtDate(p.due_date)}</td>
                    <td className="text-right"><Money paise={p.amount_paise} /></td>
                    <td className="text-right"><Money paise={p.paid_paise} /></td>
                    <td><ToneBadge tone={s.tone}>{s.label}</ToneBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1 text-xs text-slate-500">EMIs further than 90 days ahead are added as their dates come closer.</p>

      {!loan.closed_at && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-navy-800">Edit loan</summary>
          <p className="mt-2 text-xs text-slate-600">EMIs not yet paid follow the new terms. Paid EMIs stay as they were.</p>
          <ActionForm action={saveLoanAction} className="card mt-2 space-y-4 p-4">
            <LoanFields loan={loan} accounts={accounts.filter((a) => !a.archived_at || a.id === loan.account_id)} today={today} />
            <div className="flex justify-end"><SubmitButton>Save loan</SubmitButton></div>
          </ActionForm>
        </details>
      )}

      <SectionTitle>History</SectionTitle>
      <div className="card p-4"><History events={events} names={names} timeZone={tz} /></div>

      {!loan.closed_at && (
        <div className="mt-6 flex justify-end">
          <ConfirmAction
            action={closeLoanAction}
            hidden={{ id }}
            withNote
            noteRequired
            notePlaceholder="Reason, e.g. paid off early"
            label="Close this loan"
            title="Close this loan?"
            body="Use this when the loan is fully repaid or foreclosed. EMIs not yet paid are cancelled. Paid EMIs and the history are kept."
            confirmLabel="Close loan"
          />
        </div>
      )}
    </div>
  );
}
