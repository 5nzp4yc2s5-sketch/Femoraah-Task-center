import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, isIsoDate } from '@/lib/format';
import { IN_CATEGORIES, OUT_CATEGORIES, TRANSFER, inr, localParts, plusDays, todayIn, zonedIso } from '@/lib/finance';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { loadAccounts, loadTxns } from '../data';
import { Money, accountName, categoryName } from '../parts';

export const metadata = { title: 'Transactions' };

type SP = { account?: string; direction?: string; category?: string; from?: string; to?: string; q?: string; voided?: string; added?: string };
const UUID = /^[0-9a-f-]{36}$/i;
const CATS = new Set([...OUT_CATEGORIES, ...IN_CATEGORIES, TRANSFER].map((c) => c.key as string));

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const tz = me.timezone;
  const supabase = await createClient();
  const today = todayIn(tz);
  const from = isIsoDate(sp.from) ? sp.from : plusDays(today, -30);
  const to = isIsoDate(sp.to) ? sp.to : today;
  const account = sp.account && UUID.test(sp.account) ? sp.account : '';
  const direction = sp.direction === 'in' || sp.direction === 'out' ? sp.direction : '';
  const category = sp.category && CATS.has(sp.category) ? sp.category : '';
  const showVoided = sp.voided === '1';
  const term = (sp.q ?? '').trim().toLowerCase().slice(0, 80);

  const [accounts, all] = await Promise.all([
    loadAccounts(supabase, true),
    loadTxns(supabase, { since: zonedIso(from, '00:00', tz), until: zonedIso(plusDays(to, 1), '00:00', tz), accountId: account || undefined, includeVoided: showVoided }),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows = all.filter((t) => {
    if (direction && t.direction !== direction) return false;
    if (category && t.category !== category) return false;
    if (!term) return true;
    return [t.counterparty, t.description, t.reference_no].join(' ').toLowerCase().includes(term);
  });
  const live = rows.filter((t) => !t.voided_at && t.category !== 'transfer');
  const totalIn = live.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount_paise, 0);
  const totalOut = live.filter((t) => t.direction === 'out').reduce((s, t) => s + t.amount_paise, 0);
  const hasFilters = Boolean(account || direction || category || term || showVoided || sp.from || sp.to);
  const at = (iso: string) => {
    const p = localParts(iso, tz);
    return { date: fmtDate(p.date), time: p.time };
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Money that actually moved in your bank accounts. Payments and receipts you record elsewhere are added here for you."
        actions={<Link href={`/finance/transactions/new${account ? `?account=${account}` : ''}`} className="btn-primary whitespace-nowrap">Add a transaction</Link>}
      />
      {sp.added && <Notice>Transaction added.</Notice>}

      <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Search name, details or reference…" className="input col-span-2" aria-label="Search transactions" />
        <select name="account" defaultValue={account} className="input" aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{accountName(a)}</option>)}
        </select>
        <select name="direction" defaultValue={direction} className="input" aria-label="Money in or out">
          <option value="">In and out</option>
          <option value="in">Money in</option>
          <option value="out">Money out</option>
        </select>
        <select name="category" defaultValue={category} className="input col-span-2 sm:col-span-1 lg:col-span-2" aria-label="Category">
          <option value="">All categories</option>
          {[...OUT_CATEGORIES, ...IN_CATEGORIES, TRANSFER].map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">From <input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">To <input type="date" name="to" defaultValue={to} className="input" /></label>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="voided" value="1" defaultChecked={showVoided} /> Show undone ones
          </label>
          <div className="ml-auto flex gap-2">
            {hasFilters && <Link href="/finance/transactions" className="btn-ghost">Clear</Link>}
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
      </form>

      <p className="mb-2 text-xs text-slate-500">
        {rows.length} transaction{rows.length === 1 ? '' : 's'} from {fmtDate(from)} to {fmtDate(to)} · in <span className="text-green-700">{inr(totalIn)}</span> · out {inr(totalOut)} (transfers not counted)
      </p>

      {rows.length === 0 ? (
        <EmptyState title="No transactions here" body={hasFilters ? 'Try another account, category or dates.' : 'Add transactions from your bank, or record payments and receipts and they appear here.'} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr><th>When</th><th>Paid to / from</th><th>Category</th><th>Account</th><th>Reference</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const w = at(t.txn_at);
                return (
                  <tr key={t.id} className={t.voided_at ? 'text-slate-400 line-through' : t.review_status === 'needs_review' ? 'bg-amber-50' : ''}>
                    <td className="whitespace-nowrap text-sm">{w.date} <span className="text-xs text-slate-500">{w.time}</span></td>
                    <td>
                      <Link href={`/finance/transactions/${t.id}`} className="text-navy-900 hover:underline">{t.counterparty || t.description || 'Transaction'}</Link>
                      {t.counterparty && t.description && <div className="max-w-xs truncate text-xs text-slate-500">{t.description}</div>}
                      {(t.payable_id || t.receivable_id) && <div className="text-xs text-slate-500">{t.payable_id ? 'Records a payment due' : 'Records money expected'}</div>}
                    </td>
                    <td className="text-sm">{categoryName(t.category)}</td>
                    <td className="whitespace-nowrap text-sm">{accountName(byId.get(t.account_id))}</td>
                    <td className="font-mono text-xs">{t.reference_no}</td>
                    <td className="text-right"><Money paise={t.direction === 'in' ? t.amount_paise : -t.amount_paise} signed plain className={t.direction === 'in' && !t.voided_at ? 'text-green-700' : ''} /></td>
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
