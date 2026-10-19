import Link from 'next/link';

// Small, dependency-free charts for the dashboards. Every bar is a link or a focusable element
// with a full text description, so the numbers are readable without the visual.

export interface Series {
  key: string;
  label: string;
  /** Background class for the bar segment and the legend dot. */
  className: string;
}

export interface Bar {
  key: string;
  /** Short axis label, e.g. "14". */
  label: string;
  /** Second axis line, e.g. "Tue". */
  sublabel?: string;
  /** Tooltip heading, e.g. "Tue 14 Oct". */
  title: string;
  values: Record<string, number>;
  /** Shown in the tooltip under the numbers, e.g. "Holiday: Diwali". */
  note?: string;
  href?: string;
  /** Draws the bar slot muted (weekly off, holiday, today so far). */
  muted?: boolean;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${s.className}`} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Stacked (or side-by-side with `grouped`) bars, one slot per bar, with a hover/focus tooltip. */
export function BarChart({
  bars,
  series,
  label,
  height = 160,
  grouped = false,
}: {
  bars: Bar[];
  series: Series[];
  /** What the chart shows, for screen readers. */
  label: string;
  height?: number;
  grouped?: boolean;
}) {
  const totals = bars.map((b) => (grouped ? Math.max(0, ...series.map((s) => b.values[s.key] ?? 0)) : series.reduce((n, s) => n + (b.values[s.key] ?? 0), 0)));
  // Whole-number gridlines at a round step (1, 2, 5, 10, 20, 50…), at most about four of them.
  const peak = Math.max(1, ...totals);
  const step = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000].map((p) => m * p)).sort((a, b) => a - b).find((st) => peak / st <= 4) ?? Math.ceil(peak / 4);
  const max = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);

  return (
    <figure aria-label={label} className="w-full">
      <div className="flex gap-2">
        <div className="relative w-5 shrink-0 text-right text-[10px] tabular-nums text-slate-400" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / max) * 100}%`, transform: 'translateY(50%)' }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }} aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-dashed border-line/70" style={{ bottom: `${(t / max) * 100}%` }} />
            ))}
          </div>
          <ol className="relative flex items-end gap-1 sm:gap-1.5" style={{ height }}>
            {bars.map((b, i) => {
              const parts = series.map((s) => ({ s, v: b.values[s.key] ?? 0 }));
              const description = `${b.title}: ${parts.map((p) => `${p.v} ${p.s.label.toLowerCase()}`).join(', ')}${b.note ? `. ${b.note}` : ''}`;
              const align = i < 2 ? 'left-0' : i > bars.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
              const body = (
                <>
                  <span
                    role="tooltip"
                    aria-hidden
                    className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden w-max max-w-52 rounded-lg bg-navy-950 px-2.5 py-1.5 text-left text-xs text-white shadow-lg group-hover:block group-focus-visible:block ${align}`}
                  >
                    <span className="block font-semibold">{b.title}</span>
                    {parts.map((p) => (
                      <span key={p.s.key} className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-sm ${p.s.className}`} />
                        {p.s.label}: <span className="tabular-nums">{p.v}</span>
                      </span>
                    ))}
                    {b.note && <span className="mt-0.5 block text-slate-300">{b.note}</span>}
                  </span>
                  {grouped ? (
                    <span className="flex h-full w-full items-end justify-center gap-0.5">
                      {parts.map((p) => (
                        <span
                          key={p.s.key}
                          className={`bar-grow w-1/2 max-w-3 rounded-t-sm ${p.s.className}`}
                          style={{ height: `${(p.v / max) * 100}%`, animationDelay: `${i * 25}ms` }}
                        />
                      ))}
                    </span>
                  ) : (
                    <span
                      className="bar-grow flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-t-md"
                      style={{ height: `${(totals[i] / max) * 100}%`, animationDelay: `${i * 25}ms` }}
                    >
                      {parts.map((p) =>
                        p.v > 0 ? <span key={p.s.key} className={p.s.className} style={{ height: `${(p.v / Math.max(totals[i], 1)) * 100}%` }} /> : null,
                      )}
                    </span>
                  )}
                </>
              );
              const slot = `group relative flex h-full flex-1 items-end justify-center rounded-md outline-none transition-colors hover:bg-navy-50 focus-visible:bg-navy-50 focus-visible:ring-2 focus-visible:ring-navy-600/40 ${b.muted ? 'bg-slate-50' : ''}`;
              return (
                <li key={b.key} className="flex h-full min-w-0 flex-1">
                  {b.href ? (
                    <Link href={b.href} className={slot} aria-label={description}>
                      {body}
                    </Link>
                  ) : (
                    <span className={slot} tabIndex={0} aria-label={description}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <ol className="mt-1 flex gap-1 sm:gap-1.5" aria-hidden>
            {bars.map((b) => (
              <li key={b.key} className="min-w-0 flex-1 text-center leading-tight">
                <span className="block text-[10px] tabular-nums text-slate-600 sm:text-xs">{b.label}</span>
                {b.sublabel && <span className="block text-[9px] text-slate-400 sm:text-[10px]">{b.sublabel}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </figure>
  );
}

/** A thin horizontal bar, e.g. hours worked against the scheduled day. */
export function Meter({ value, max, label, className = 'bg-accent' }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <div className={`bar-grow-x h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
