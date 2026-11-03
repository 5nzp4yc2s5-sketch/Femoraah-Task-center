import { fmtDate } from '@/lib/format';
import { inr, inrShort, type ForecastDay } from '@/lib/finance';

/**
 * Projected closing balance for each day, as bars: green at or above the minimum, amber under it,
 * red below zero. Each bar is focusable and describes its day in full.
 */
export function CashChart({ days, minCash, height = 180, label }: { days: ForecastDay[]; minCash: number; height?: number; label: string }) {
  if (days.length === 0) return null;
  const top = Math.max(1, minCash, ...days.map((d) => d.closing));
  const bottom = Math.max(0, ...days.map((d) => -d.closing));
  const posH = Math.round((height * top) / (top + bottom));
  const negH = height - posH;
  const every = Math.max(1, Math.ceil(days.length / 10));
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

  return (
    <figure aria-label={label} className="w-full">
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[10px] tabular-nums text-slate-400" style={{ height }} aria-hidden>
          <span className="absolute right-0 top-0">{inrShort(top)}</span>
          <span className="absolute right-0" style={{ top: posH, transform: 'translateY(-50%)' }}>₹0</span>
          {bottom > 0 && <span className="absolute bottom-0 right-0">−{inrShort(bottom).replace('−', '')}</span>}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 border-t border-slate-300" style={{ top: posH }} aria-hidden />
          {minCash > 0 && (
            <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-amber-500" style={{ top: posH - Math.round((posH * minCash) / top) }} aria-hidden>
              <span className="absolute -top-4 right-0 bg-white/80 px-1 text-[10px] text-amber-700">Minimum {inrShort(minCash)}</span>
            </div>
          )}
          <ol className="relative flex gap-px sm:gap-0.5" style={{ height }}>
            {days.map((d, i) => {
              const tone = d.closing < 0 ? 'bg-red-500' : minCash > 0 && d.closing < minCash ? 'bg-amber-400' : 'bg-green-500';
              const h = d.closing >= 0 ? Math.max(1, Math.round((posH * d.closing) / top)) : Math.max(1, Math.round((negH * -d.closing) / Math.max(bottom, 1)));
              const day = weekday.format(new Date(`${d.date}T00:00:00Z`));
              const moves = [d.inflow ? `in ${inr(d.inflow)}` : '', d.outflow ? `out ${inr(d.outflow)}` : ''].filter(Boolean).join(', ');
              const description = `${day} ${fmtDate(d.date)}: closing ${inr(d.closing)}${moves ? `; ${moves}` : ''}`;
              const align = i < 3 ? 'left-0' : i > days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2';
              return (
                <li key={d.date} className="group relative min-w-0 flex-1 outline-none focus-visible:bg-navy-50" tabIndex={0} aria-label={description}>
                  <span
                    className={`absolute inset-x-0 mx-auto max-w-6 ${tone} ${d.closing >= 0 ? 'rounded-t-sm' : 'rounded-b-sm'} transition-opacity group-hover:opacity-80`}
                    style={d.closing >= 0 ? { bottom: height - posH, height: h } : { top: posH, height: h }}
                    aria-hidden
                  />
                  {(d.inflow > 0 || d.outflow > 0) && (
                    <span className={`absolute inset-x-0 mx-auto h-1 w-1 rounded-full ${d.outflow > d.inflow ? 'bg-navy-800' : 'bg-blue-500'}`} style={{ top: height + 2 }} aria-hidden />
                  )}
                  <span
                    role="tooltip"
                    aria-hidden
                    className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden w-max max-w-56 rounded-lg bg-navy-950 px-2.5 py-1.5 text-left text-xs text-white shadow-lg group-hover:block group-focus-visible:block ${align}`}
                  >
                    <span className="block font-semibold">{day} {fmtDate(d.date)}</span>
                    <span className="block tabular-nums">Closing {inr(d.closing)}</span>
                    {d.inflow > 0 && <span className="block tabular-nums text-green-300">In {inr(d.inflow)}</span>}
                    {d.outflow > 0 && <span className="block tabular-nums text-red-300">Out {inr(d.outflow)}</span>}
                    {d.flows.slice(0, 4).map((f) => (
                      <span key={f.key} className="block truncate text-slate-300">{f.direction === 'in' ? '+' : '−'} {f.title}</span>
                    ))}
                    {d.flows.length > 4 && <span className="block text-slate-400">and {d.flows.length - 4} more</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          <ol className="mt-3 flex gap-px sm:gap-0.5" aria-hidden>
            {days.map((d, i) => (
              <li key={d.date} className="relative min-w-0 flex-1 text-center text-[10px] leading-tight text-slate-500">
                {i % every === 0 ? (
                  // Phones show every other label so they do not run into each other.
                  <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap ${(i / every) % 2 === 1 ? 'hidden sm:inline' : ''}`}>{fmtDate(d.date).slice(0, 6)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" aria-hidden />Healthy</span>
        {minCash > 0 && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden />Below your minimum</span>}
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" aria-hidden />Below zero</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-navy-800" aria-hidden />Payments due that day</span>
      </figcaption>
    </figure>
  );
}
