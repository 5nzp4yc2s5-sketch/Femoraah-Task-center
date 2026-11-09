import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { cashAlerts, inr, localParts, plusDays, todayIn, zonedIso } from '@/lib/finance';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { loadPlan, loadTxns } from './data';
import { CashChart } from './cash-chart';
import { checkStaleSoon } from '@/lib/gmail-sync';
import { Money, PriorityTag, accountKind, accountName } from './parts';

export const metadata = { title: 'Cash Flow' };
export const maxDuration = 60;

function Stat({ label, value, hint, tone = 'default', href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'green' | 'amber' | 'red'; href?: string }) {
  const color = { default: 'text-navy-900', green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-700' }[tone];
  const body = (
    <div className="card h-full p-4 transition hover:border-navy-600/40">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default async function FinanceHome() {
  const me = await requireFinance();
  const supabase = await createClient();
  const tz = me.timezone;
  const today = todayIn(tz);
  const monthStart = `${today.slice(0, 8)}01`;
  const since = [monthStart, plusDays(today, -7)].sort()[0];
  const [plan, recent, toCheck, openAlerts, mailboxes] = await Promise.all([
    loadPlan(supabase, today, 30),
    loadTxns(supabase, { since: zonedIso(since, '00:00', tz) }),
    supabase.from('fin_transactions').select('id', { count: 'exact', head: true }).eq('review_status', 'needs_review').is('voided_at', null),
    supabase.from('fin_gmail_alerts').select('id', { count: 'exact', head: true }).in('status', ['no_account', 'unreadable']),
    supabase.from('fin_gmail_connections').select('email, last_sync_ok, last_sync_message').is('disconnected_at', null),
  ]);
  if (mailboxes.data?.length) checkStaleSoon(me.memberId);
  const { settings, accounts, balances, available, payables, receivables, flows, projection } = plan;

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Cash Flow" subtitle="Your cash position, what is due and what is coming in. Only the Super Admin and people with Finance access can see this." />
        <EmptyState
          title="Start with your bank accounts"
          body="Add each bank account with its current balance. Then add the payments you owe, money you expect and your loans, and the overview fills in."
          action={<Link href="/finance/accounts/new" className="btn-primary">Add a bank account</Link>}
        />
      </>
    );
  }

  const dayOf = (iso: string) => localParts(iso, tz).date;
  const monthTxns = recent.filter((t) => dayOf(t.txn_at) >= monthStart && t.review_status === 'confirmed' && t.category !== 'transfer');
  const inThisMonth = monthTxns.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount_paise, 0);
  const outThisMonth = monthTxns.filter((t) => t.direction === 'out').reduce((s, t) => s + t.amount_paise, 0);
  const openPay = payables.filter((p) => p.state === 'open' || p.state === 'scheduled' || p.state === 'on_hold');
  const openRec = receivables.filter((r) => r.state === 'open' || r.state === 'disputed');
  const toPay = openPay.reduce((s, p) => s + p.amount_paise - p.paid_paise, 0);
  const toReceive = openRec.reduce((s, r) => s + r.amount_paise - r.received_paise, 0);
  const overduePay = openPay.filter((p) => p.state !== 'on_hold' && p.due_date < today);
  const overdueRec = openRec.filter((r) => r.state === 'open' && r.expected_date < today);
  const out30 = flows.filter((f) => f.direction === 'out').reduce((s, f) => s + f.amount, 0);
  const emi30 = flows.filter((f) => f.kind === 'emi').reduce((s, f) => s + f.amount, 0);
  const emiCount = flows.filter((f) => f.kind === 'emi').length;
  const freeCash = available - out30;

  const alerts = cashAlerts({ today, available, settings, payables, receivables, recentTxns: recent.filter((t) => dayOf(t.txn_at) >= plusDays(today, -7)), forecast30: projection, fmtDate, dayOf });
  for (const m of mailboxes.data ?? []) {
    if (m.last_sync_ok === false) alerts.push({ key: `gmail-${m.email}`, tone: 'red', title: 'Bank emails are not being read', detail: `${m.email}: ${m.last_sync_message || 'the last check failed'}`, href: '/finance/gmail' });
  }
  if (toCheck.count) {
    alerts.push({ key: 'review', tone: 'amber', title: 'Transactions from bank emails to check', detail: `${toCheck.count} not confirmed yet, so they are not in the balance.`, href: '/finance/transactions?review=1' });
  }
  if (openAlerts.count) {
    alerts.push({ key: 'gmail-open', tone: 'amber', title: 'Bank emails to sort out', detail: `${openAlerts.count} need${openAlerts.count === 1 ? 's' : ''} an account chosen or could not be read.`, href: '/finance/gmail' });
  }
  const health =
    projection.firstNegative || available < 0 || (settings.min_cash_paise > 0 && available < settings.min_cash_paise)
      ? { tone: 'red' as const, label: 'Action needed', text: projection.firstNegative ? `On what is planned, cash goes below zero on ${fmtDate(projection.firstNegative)}.` : 'Cash is under your minimum today.' }
      : projection.firstBelowMin || overduePay.length > 0
        ? { tone: 'amber' as const, label: 'Watch closely', text: projection.firstBelowMin ? `Cash drops under your minimum on ${fmtDate(projection.firstBelowMin)}.` : `${overduePay.length} payment${overduePay.length === 1 ? ' is' : 's are'} overdue.` }
        : { tone: 'green' as const, label: 'Healthy', text: 'Cash stays above zero and your minimum for the next 30 days, on what is planned.' };
  const healthStyle = { green: 'border-green-200 bg-green-50 text-green-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-900' }[health.tone];
  const healthDot = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-600' }[health.tone];

  const upcoming = projection.days.slice(0, 15).filter((d) => d.flows.length > 0);
  const reported = balances.some((b) => b.reported);

  return (
    <>
      <PageHeader
        title="Cash Flow"
        subtitle="Your cash position, what is due and what is coming in. Only the Super Admin and people with Finance access can see this."
        actions={
          <>
            <Link href="/finance/payables/new" className="btn-primary whitespace-nowrap">Add a payment due</Link>
            <Link href="/finance/receivables/new" className="btn-secondary whitespace-nowrap">Add money expected</Link>
          </>
        }
      />

      <div className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${healthStyle}`} role="status">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${healthDot}`} aria-hidden />
        <p className="text-sm"><strong className="font-semibold">Cash health: {health.label}.</strong> {health.text}</p>
      </div>

      {settings.min_cash_paise === 0 && (
        <Notice>
          Set the minimum cash you want to keep, so the app can warn you before you drop under it.{' '}
          <Link href="/finance/accounts#alert-settings" className="underline">Set it on the Banks page</Link>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cash available now" value={<Money paise={available} />} tone={available < 0 ? 'red' : 'default'} hint={`Across ${accounts.length} account${accounts.length === 1 ? '' : 's'}${reported ? ', some as last reported by the bank' : ''}`} href="/finance/accounts" />
        <Stat label="Free after next 30 days' payments" value={<Money paise={freeCash} />} tone={freeCash < 0 ? 'red' : settings.min_cash_paise > 0 && freeCash < settings.min_cash_paise ? 'amber' : 'green'} hint={`After ${inr(out30)} due, including overdue`} href="/finance/payables" />
        <Stat label="Projected in 30 days" value={<Money paise={projection.closing} />} tone={projection.closing < 0 ? 'red' : 'default'} hint={`Lowest ${inr(projection.lowest.balance)} on ${fmtDate(projection.lowest.date)}`} href="/finance/forecast" />
        <Stat label="EMIs in the next 30 days" value={inr(emi30)} hint={`${emiCount} EMI${emiCount === 1 ? '' : 's'}`} href="/finance/loans" />
        <Stat label="Money in this month" value={inr(inThisMonth)} tone="green" hint="Confirmed, not counting transfers" href="/finance/transactions?direction=in" />
        <Stat label="Money out this month" value={inr(outThisMonth)} hint="Confirmed, not counting transfers" href="/finance/transactions?direction=out" />
        <Stat label="Still to receive" value={inr(toReceive)} tone={overdueRec.length ? 'amber' : 'default'} hint={overdueRec.length ? `${overdueRec.length} overdue` : `${openRec.length} expected`} href="/finance/receivables" />
        <Stat label="Still to pay" value={inr(toPay)} tone={overduePay.length ? 'red' : 'default'} hint={overduePay.length ? `${overduePay.length} overdue` : `${openPay.length} open`} href="/finance/payables" />
      </div>

      <SectionTitle>Alerts</SectionTitle>
      {alerts.length === 0 ? (
        <p className="card p-4 text-sm text-slate-600">Nothing needs attention right now.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {alerts.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="flex items-start gap-3 px-4 py-3 hover:bg-navy-50">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === 'red' ? 'bg-red-600' : 'bg-amber-500'}`} aria-hidden />
                <span className="text-sm">
                  <strong className={`font-semibold ${a.tone === 'red' ? 'text-red-800' : 'text-amber-900'}`}>{a.title}.</strong> <span className="text-slate-700">{a.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle action={<Link href="/finance/forecast" className="text-sm text-navy-700 hover:underline">Full forecast</Link>}>Next 30 days</SectionTitle>
      <div className="card p-4">
        <CashChart days={projection.days} minCash={settings.min_cash_paise} label="Projected closing balance for each of the next 30 days" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle action={<Link href="/finance/accounts" className="text-sm text-navy-700 hover:underline">Banks</Link>}>Bank balances</SectionTitle>
          <div className="card overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr><th>Account</th><th className="text-right">Balance</th><th>Based on</th></tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.account.id}>
                    <td>
                      <Link href={`/finance/accounts/${b.account.id}`} className="font-medium text-navy-900 hover:underline">{accountName(b.account)}</Link>
                      <div className="text-xs text-slate-500">{[b.account.bank, accountKind(b.account.kind)].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="text-right"><Money paise={b.balance} className="font-semibold" /></td>
                    <td className="text-xs text-slate-600">
                      {b.reading ? <>Balance of {fmtDate(localParts(b.reading.as_of, tz).date)}{b.movedSince ? ` + ${b.movedSince} transaction${b.movedSince === 1 ? '' : 's'}` : ''}</> : 'No balance yet'}
                      {b.reported && <div className="text-amber-700">Last reported by the bank, not live</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th>Total</th><th className="text-right"><Money paise={available} /></th><th /></tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div>
          <SectionTitle action={<Link href="/finance/payables" className="text-sm text-navy-700 hover:underline">All payments due</Link>}>Coming up in 14 days</SectionTitle>
          {upcoming.length === 0 ? (
            <p className="card p-4 text-sm text-slate-600">Nothing planned in the next 14 days.</p>
          ) : (
            <ol className="card divide-y divide-line">
              {upcoming.map((d) => (
                <li key={d.date} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span>{d.date === today ? 'Today' : fmtDate(d.date)}</span>
                    <span className="normal-case">Balance after <Money paise={d.closing} /></span>
                  </div>
                  <ul className="mt-1 space-y-1">
                    {d.flows.map((f) => (
                      <li key={f.key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          {f.sourceId ? (
                            <Link href={f.direction === 'in' ? `/finance/receivables/${f.sourceId}` : `/finance/payables/${f.sourceId}`} className="truncate text-navy-900 hover:underline">{f.title}</Link>
                          ) : (
                            <span className="truncate text-navy-900">{f.title} <span className="text-xs text-slate-500">(repeats)</span></span>
                          )}
                          {f.overdue && <span className="text-xs font-semibold text-red-700">overdue</span>}
                          {f.priority && f.direction === 'out' && <PriorityTag priority={f.priority} />}
                        </span>
                        <Money paise={f.direction === 'in' ? f.amount : -f.amount} signed plain className={f.direction === 'in' ? 'text-green-700' : ''} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

    </>
  );
}
