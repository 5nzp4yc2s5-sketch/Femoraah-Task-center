import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { inr, plusDays, todayIn } from '@/lib/finance';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { loadLoans, loadPayables, refreshPlans } from '../data';
import { Money } from '../parts';

export const metadata = { title: 'Loans & EMIs' };

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const supabase = await createClient();
  await refreshPlans(supabase);
  const today = todayIn(me.timezone);
  const showClosed = sp.closed === '1';
  const [loans, allPayables] = await Promise.all([loadLoans(supabase, true), loadPayables(supabase)]);
  const emis = allPayables.filter((p) => p.loan_id && (p.state === 'open' || p.state === 'scheduled' || p.state === 'on_hold'));
  const paidCount = (id: string, before: number) => before + allPayables.filter((p) => p.loan_id === id && p.state === 'paid').length;
  const list = loans.filter((l) => (showClosed ? l.closed_at : !l.closed_at));
  const open = loans.filter((l) => !l.closed_at);
  const next30 = emis.filter((p) => p.state !== 'on_hold' && p.due_date <= plusDays(today, 30));
  const nextOf = (id: string) => emis.filter((p) => p.loan_id === id).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const overdue = emis.filter((p) => p.due_date < today && p.state !== 'on_hold');

  return (
    <>
      <PageHeader
        title="Loans & EMIs"
        subtitle="Each loan's EMIs are added to Payments due and the forecast automatically, 90 days ahead, once each. Record each EMI as paid when it leaves your account."
        actions={<Link href="/finance/loans/new" className="btn-primary whitespace-nowrap">Add a loan</Link>}
      />
      {overdue.length > 0 && <Notice tone="warn">{overdue.length} EMI{overdue.length === 1 ? ' is' : 's are'} past the due date and not recorded as paid. <Link href="/finance/payables?status=overdue&category=loan_emi" className="underline">See them</Link></Notice>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loans running</div><div className="mt-1 text-lg font-semibold">{open.length}</div></div>
        <div className="card p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Principal outstanding</div><div className="mt-1 text-lg font-semibold">{inr(open.reduce((s, l) => s + l.outstanding_paise, 0))}</div></div>
        <div className="card p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">EMIs each month</div><div className="mt-1 text-lg font-semibold">{inr(open.reduce((s, l) => s + l.emi_paise, 0))}</div></div>
        <div className="card p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">EMIs in 30 days</div><div className="mt-1 text-lg font-semibold">{inr(next30.reduce((s, p) => s + p.amount_paise - p.paid_paise, 0))}</div></div>
      </div>

      <div className="mb-3 flex gap-1">
        <Link href="/finance/loans" aria-current={!showClosed ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${!showClosed ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>Running</Link>
        <Link href="/finance/loans?closed=1" aria-current={showClosed ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${showClosed ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>Closed</Link>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={showClosed ? 'No closed loans' : 'No loans yet'}
          body={showClosed ? undefined : 'Add each business loan with its EMI, and its EMIs are planned for you.'}
          action={showClosed ? undefined : <Link href="/finance/loans/new" className="btn-primary">Add a loan</Link>}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr><th>Loan</th><th className="text-right">Outstanding</th><th className="text-right">EMI</th><th>Next EMI</th><th>EMIs paid</th></tr>
            </thead>
            <tbody>
              {list.map((l) => {
                const next = nextOf(l.id);
                return (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/finance/loans/${l.id}`} className="font-medium text-navy-900 hover:underline">{l.name}</Link>
                      {l.lender && <div className="text-xs text-slate-500">{l.lender}</div>}
                    </td>
                    <td className="text-right"><Money paise={l.outstanding_paise} /></td>
                    <td className="text-right"><Money paise={l.emi_paise} /></td>
                    <td className="whitespace-nowrap text-sm">
                      {l.closed_at ? 'Closed' : next ? <Link href={`/finance/payables/${next.id}`} className={next.due_date < today ? 'font-semibold text-red-700 hover:underline' : 'text-navy-700 hover:underline'}>{fmtDate(next.due_date)}{next.due_date < today ? ', overdue' : ''}</Link> : 'None planned'}
                    </td>
                    <td className="text-sm tabular-nums">{paidCount(l.id, l.paid_before)} of {l.tenure_months}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

