import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { inr, todayIn, type ForecastDay } from '@/lib/finance';
import { PageHeader, SectionTitle } from '@/components/ui';
import { loadPlan } from '../data';
import { CashChart } from '../cash-chart';
import { Money, PriorityTag } from '../parts';

export const metadata = { title: 'Cash forecast' };

const HORIZONS = [7, 15, 30, 60, 90] as const;

type SP = { days?: string; view?: string };

/** Days grouped into weeks starting today: opening of the first day, closing of the last. */
function weeks(days: ForecastDay[]): ForecastDay[] {
  const out: ForecastDay[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    out.push({
      date: chunk[0].date,
      opening: chunk[0].opening,
      inflow: chunk.reduce((s, d) => s + d.inflow, 0),
      outflow: chunk.reduce((s, d) => s + d.outflow, 0),
      closing: chunk[chunk.length - 1].closing,
      flows: chunk.flatMap((d) => d.flows),
    });
  }
  return out;
}

export default async function ForecastPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const supabase = await createClient();
  const today = todayIn(me.timezone);
  const horizon = HORIZONS.find((h) => String(h) === sp.days) ?? 30;
  const weekly = sp.view === 'weekly';
  const { settings, available, projection } = await loadPlan(supabase, today, horizon);
  const days = projection.days.slice(0, horizon + 1);
  const rows = weekly ? weeks(days) : days.filter((d) => d.flows.length > 0 || d.date === today);
  const href = (h: number, v: string) => `/finance/forecast?days=${h}${v === 'weekly' ? '&view=weekly' : ''}`;

  const lowTone = projection.lowest.balance < 0 ? 'text-red-700' : settings.min_cash_paise > 0 && projection.lowest.balance < settings.min_cash_paise ? 'text-amber-700' : 'text-green-700';

  return (
    <>
      <PageHeader
        title="Cash forecast"
        subtitle="Day by day, from today's balance and what is on record: payments due (overdue ones counted today), EMIs, repeating payments and money expected. Payments on hold and overdue or disputed money coming in are left out."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Show</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="How far ahead">
          {HORIZONS.map((h) => (
            <Link key={h} href={href(h, weekly ? 'weekly' : 'daily')} aria-current={h === horizon ? 'true' : undefined} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${h === horizon ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>
              {h} days
            </Link>
          ))}
        </div>
        <div className="ml-auto flex gap-1" role="group" aria-label="Table view">
          {(['daily', 'weekly'] as const).map((v) => (
            <Link key={v} href={href(horizon, v)} aria-current={(v === 'weekly') === weekly ? 'true' : undefined} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${(v === 'weekly') === weekly ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>
              {v === 'daily' ? 'By day' : 'By week'}
            </Link>
          ))}
        </div>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Today', <Money key="a" paise={available} />],
          ['Money in', <span key="b" className="text-green-700">{inr(projection.inflow)}</span>],
          ['Money out', inr(projection.outflow)],
          [`In ${horizon} days`, <Money key="c" paise={projection.closing} />],
          ['Lowest point', <span key="d" className={lowTone}>{inr(projection.lowest.balance)} <span className="text-xs font-normal text-slate-500">on {fmtDate(projection.lowest.date)}</span></span>],
        ].map(([k, v]) => (
          <div key={String(k)} className="card p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-navy-900">{v}</dd>
          </div>
        ))}
      </dl>

      {(projection.firstNegative || projection.firstBelowMin) && (
        <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${projection.firstNegative ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} role="alert">
          {projection.firstNegative
            ? `Cash goes below zero on ${fmtDate(projection.firstNegative)}.`
            : `Cash drops under your minimum of ${inr(settings.min_cash_paise)} on ${fmtDate(projection.firstBelowMin!)}.`}{' '}
          Nothing is changed automatically: review what is due and decide what to move.
        </p>
      )}

      <div className="card p-4">
        <CashChart days={days} minCash={settings.min_cash_paise} label={`Projected closing balance for each of the next ${horizon} days`} />
      </div>

      <SectionTitle>{weekly ? 'Week by week' : 'Days with money moving'}</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr>
              <th>{weekly ? 'Week from' : 'Date'}</th>
              <th>What</th>
              <th className="text-right">In</th>
              <th className="text-right">Out</th>
              <th className="text-right">Closing balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const tone = d.closing < 0 ? 'bg-red-50' : settings.min_cash_paise > 0 && d.closing < settings.min_cash_paise ? 'bg-amber-50' : '';
              return (
                <tr key={d.date} className={tone}>
                  <td className="whitespace-nowrap align-top">{d.date === today && !weekly ? 'Today' : fmtDate(d.date)}</td>
                  <td className="min-w-56 align-top">
                    {d.flows.length === 0 ? (
                      <span className="text-slate-500">Nothing planned</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {(weekly ? d.flows.slice(0, 6) : d.flows).map((f) => (
                          <li key={f.key} className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className={f.direction === 'in' ? 'text-green-700' : 'text-slate-500'} aria-hidden>{f.direction === 'in' ? '+' : '−'}</span>
                            {f.sourceId ? (
                              <Link href={f.direction === 'in' ? `/finance/receivables/${f.sourceId}` : `/finance/payables/${f.sourceId}`} className="text-navy-900 hover:underline">{f.title}</Link>
                            ) : (
                              <span className="text-navy-900">{f.title} <span className="text-xs text-slate-500">(repeats)</span></span>
                            )}
                            <span className="tabular-nums text-xs text-slate-500">{inr(f.amount)}</span>
                            {f.overdue && <span className="text-xs font-semibold text-red-700">overdue</span>}
                            {f.priority && f.direction === 'out' && <PriorityTag priority={f.priority} />}
                          </li>
                        ))}
                        {weekly && d.flows.length > 6 && <li className="text-xs text-slate-500">and {d.flows.length - 6} more</li>}
                      </ul>
                    )}
                  </td>
                  <td className="text-right align-top tabular-nums text-green-700">{d.inflow ? inr(d.inflow) : ''}</td>
                  <td className="text-right align-top tabular-nums">{d.outflow ? inr(d.outflow) : ''}</td>
                  <td className="text-right align-top font-semibold"><Money paise={d.closing} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
