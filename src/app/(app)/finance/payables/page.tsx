import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { OUT_CATEGORIES, PAYABLE_FILTERS, PRIORITIES, PRIORITY_RANK, daysBetween, inr, payableStatus, todayIn, type PayPriority } from '@/lib/finance';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { loadAccounts, loadPayables, refreshPlans } from '../data';
import { Money, PriorityTag, ToneBadge, accountName, categoryName } from '../parts';

export const metadata = { title: 'Payments due' };

type SP = { status?: string; priority?: string; category?: string; account?: string; q?: string; sort?: string };
const UUID = /^[0-9a-f-]{36}$/i;
const ROW: Record<string, string> = { red: 'bg-red-50/70', amber: 'bg-amber-50/70', green: '', grey: 'text-slate-500', blue: '' };

export default async function PayablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const supabase = await createClient();
  await refreshPlans(supabase);
  const today = todayIn(me.timezone);
  const [all, accounts] = await Promise.all([loadPayables(supabase), loadAccounts(supabase, true)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const status = PAYABLE_FILTERS.some((f) => f.key === sp.status) ? sp.status! : 'open';
  const priority = PRIORITIES.some((p) => p.key === sp.priority) ? (sp.priority as PayPriority) : '';
  const category = OUT_CATEGORIES.some((c) => c.key === sp.category) ? sp.category! : '';
  const account = sp.account && UUID.test(sp.account) ? sp.account : '';
  const term = (sp.q ?? '').trim().toLowerCase().slice(0, 80);
  const sort = sp.sort === 'priority' || sp.sort === 'amount' ? sp.sort : 'due';

  const withStatus = all.map((p) => ({ p, s: payableStatus(p, today), left: p.amount_paise - p.paid_paise }));
  const rows = withStatus
    .filter(({ p, s }) => {
      const open = p.state === 'open' || p.state === 'scheduled' || p.state === 'on_hold';
      if (status === 'open' && !open) return false;
      if (status === 'attention' && !(open && p.state !== 'on_hold' && (s.key === 'overdue' || s.key === 'partial' || daysBetween(today, p.due_date) <= 3))) return false;
      if (!['open', 'attention', 'all'].includes(status) && s.key !== status) return false;
      if (priority && p.priority !== priority) return false;
      if (category && p.category !== category) return false;
      if (account && p.account_id !== account) return false;
      if (term && ![p.title, p.payee, p.notes].join(' ').toLowerCase().includes(term)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === 'priority') return PRIORITY_RANK[a.p.priority] - PRIORITY_RANK[b.p.priority] || a.p.due_date.localeCompare(b.p.due_date);
      if (sort === 'amount') return b.left - a.left;
      return a.p.due_date.localeCompare(b.p.due_date) || PRIORITY_RANK[a.p.priority] - PRIORITY_RANK[b.p.priority];
    });
  const total = rows.filter((r) => r.p.state !== 'cancelled' && r.p.state !== 'paid').reduce((s, r) => s + r.left, 0);
  const hasFilters = Boolean(priority || category || account || term || status !== 'open' || sort !== 'due');

  return (
    <>
      <PageHeader
        title="Payments due"
        subtitle="Vendors, salaries, rent, taxes, card bills and EMIs. Nothing is paid or moved automatically: you record each payment and every change yourself."
        actions={<Link href="/finance/payables/new" className="btn-primary whitespace-nowrap">Add a payment due</Link>}
      />

      <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Search title, payee or notes…" className="input col-span-2" aria-label="Search payments" />
        <select name="status" defaultValue={status} className="input col-span-2 sm:col-span-1" aria-label="Status">
          {PAYABLE_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <select name="priority" defaultValue={priority} className="input" aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select name="category" defaultValue={category} className="input" aria-label="Category">
          <option value="">All categories</option>
          {OUT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select name="account" defaultValue={account} className="input" aria-label="Pay from">
          <option value="">Any account</option>
          {accounts.filter((a) => !a.archived_at).map((a) => <option key={a.id} value={a.id}>{accountName(a)}</option>)}
        </select>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-3 lg:col-span-6">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            Sort by
            <select name="sort" defaultValue={sort} className="input w-auto">
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
              <option value="amount">Amount left, largest first</option>
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            {hasFilters && <Link href="/finance/payables" className="btn-ghost">Clear</Link>}
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
      </form>

      <p className="mb-2 text-xs text-slate-500">
        {rows.length} payment{rows.length === 1 ? '' : 's'} · {inr(total)} still to pay
      </p>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState title="No payments due yet" body="Add what the business owes: vendor bills, rent, salaries, taxes. EMIs are added from Loans & EMIs." action={<Link href="/finance/payables/new" className="btn-primary">Add a payment due</Link>} />
        ) : (
          <Notice>No payments match these filters.</Notice>
        )
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr><th>Due</th><th>Payment</th><th>Priority</th><th>Category</th><th className="text-right">Amount</th><th className="text-right">Still to pay</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map(({ p, s, left }) => (
                <tr key={p.id} className={ROW[s.tone]}>
                  <td className="whitespace-nowrap text-sm">
                    {fmtDate(p.due_date)}
                    {p.due_date !== p.original_due_date && <div className="text-xs text-slate-500">was {fmtDate(p.original_due_date)}</div>}
                  </td>
                  <td>
                    <Link href={`/finance/payables/${p.id}`} className="font-medium text-navy-900 hover:underline">{p.title}</Link>
                    <div className="text-xs text-slate-500">
                      {[p.payee, p.account_id ? `from ${accountName(byId.get(p.account_id))}` : '', p.recurrence !== 'none' ? 'repeats' : ''].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td><PriorityTag priority={p.priority} /></td>
                  <td className="text-sm">{categoryName(p.category)}</td>
                  <td className="text-right"><Money paise={p.amount_paise} /></td>
                  <td className="text-right font-semibold">{p.state === 'paid' || p.state === 'cancelled' ? '—' : <Money paise={left} />}</td>
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
