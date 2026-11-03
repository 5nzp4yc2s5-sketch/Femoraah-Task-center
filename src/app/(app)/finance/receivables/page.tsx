import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { RECEIVABLE_FILTERS, RECEIVABLE_SOURCES, inr, receivableStatus, todayIn } from '@/lib/finance';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { loadReceivables } from '../data';
import { Money, ToneBadge, categoryName } from '../parts';

export const metadata = { title: 'Money coming in' };

type SP = { status?: string; source?: string; q?: string; sort?: string };
const ROW: Record<string, string> = { red: 'bg-red-50/70', amber: 'bg-amber-50/70', green: '', grey: 'text-slate-500', blue: '' };

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const supabase = await createClient();
  const today = todayIn(me.timezone);
  const all = await loadReceivables(supabase);

  const status = RECEIVABLE_FILTERS.some((f) => f.key === sp.status) ? sp.status! : 'open';
  const source = RECEIVABLE_SOURCES.some((s) => s.key === sp.source) ? sp.source! : '';
  const term = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const sort = sp.sort === 'amount' ? 'amount' : 'date';

  const rows = all
    .map((r) => ({ r, s: receivableStatus(r, today), left: r.amount_paise - r.received_paise }))
    .filter(({ r, s }) => {
      if (status === 'open' && !(r.state === 'open' || r.state === 'disputed')) return false;
      if (status !== 'open' && status !== 'all' && s.key !== status) return false;
      if (source && r.source !== source) return false;
      if (term && ![r.party, r.reference_no, r.notes].join(' ').toLowerCase().includes(term)) return false;
      return true;
    })
    .sort((a, b) => (sort === 'amount' ? b.left - a.left : a.r.expected_date.localeCompare(b.r.expected_date)));
  const total = rows.filter(({ r }) => r.state === 'open' || r.state === 'disputed').reduce((s, x) => s + x.left, 0);
  const hasFilters = Boolean(source || term || status !== 'open' || sort !== 'date');

  return (
    <>
      <PageHeader
        title="Money coming in"
        subtitle="Customer payments and marketplace settlements you expect. Late or disputed money is left out of the forecast until you give it a new date."
        actions={<Link href="/finance/receivables/new" className="btn-primary whitespace-nowrap">Add money expected</Link>}
      />

      <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Search name, invoice or notes…" className="input col-span-2" aria-label="Search money expected" />
        <select name="status" defaultValue={status} className="input" aria-label="Status">
          {RECEIVABLE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <select name="source" defaultValue={source} className="input" aria-label="Type">
          <option value="">Customers and marketplaces</option>
          {RECEIVABLE_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select name="sort" defaultValue={sort} className="input" aria-label="Sort">
          <option value="date">Expected date</option>
          <option value="amount">Amount, largest first</option>
        </select>
        <div className="flex gap-2">
          {hasFilters && <Link href="/finance/receivables" className="btn-ghost">Clear</Link>}
          <button className="btn-secondary" type="submit">Apply</button>
        </div>
      </form>

      <p className="mb-2 text-xs text-slate-500">{rows.length} item{rows.length === 1 ? '' : 's'} · {inr(total)} still to come</p>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState title="No money expected yet" body="Add customer payments and marketplace settlements you are waiting for, with the date you expect them." action={<Link href="/finance/receivables/new" className="btn-primary">Add money expected</Link>} />
        ) : (
          <Notice>Nothing matches these filters.</Notice>
        )
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr><th>Expected</th><th>From</th><th>Category</th><th className="text-right">Amount</th><th className="text-right">Still to come</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map(({ r, s, left }) => (
                <tr key={r.id} className={ROW[s.tone]}>
                  <td className="whitespace-nowrap text-sm">
                    {fmtDate(r.expected_date)}
                    {r.expected_date !== r.original_expected_date && <div className="text-xs text-slate-500">was {fmtDate(r.original_expected_date)}</div>}
                  </td>
                  <td>
                    <Link href={`/finance/receivables/${r.id}`} className="font-medium text-navy-900 hover:underline">{r.party}</Link>
                    {r.reference_no && <div className="font-mono text-xs text-slate-500">{r.reference_no}</div>}
                  </td>
                  <td className="text-sm">{categoryName(r.category)}</td>
                  <td className="text-right"><Money paise={r.amount_paise} /></td>
                  <td className="text-right font-semibold">{r.state === 'open' || r.state === 'disputed' ? <Money paise={left} /> : '—'}</td>
                  <td><ToneBadge tone={s.tone}>{s.label}</ToneBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
