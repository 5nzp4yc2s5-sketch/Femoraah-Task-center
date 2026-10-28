import { addDays, fmtDate } from '@/lib/format';
import type { CalendarEntry } from '@/lib/types';
import { WEEKDAYS, weekdayIndex, weekdayShort } from './dates';

// Same palette as the app's badges: slate = holiday (AttendanceBadge "Holiday"), violet = leave ("On Leave").
export const HOLIDAY_TONE = 'bg-slate-100 text-slate-700';
export const LEAVE_TONE = 'bg-violet-50 text-violet-700';
export const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

/** Full description of an entry, used for tooltips and screen readers. */
export function describe(e: CalendarEntry): string {
  if (e.kind === 'holiday') return `Holiday: ${e.label}${e.note ? ` (${e.note})` : ''}`;
  const dates = e.start_date === e.end_date ? fmtDate(e.start_date) : `${fmtDate(e.start_date)} to ${fmtDate(e.end_date)}`;
  return `${e.member_name ?? 'Someone'} on ${e.label}, ${dates}${e.backup_name ? `. Backup: ${e.backup_name}` : ''}`;
}

/** Entries per day (yyyy-mm-dd), holidays first, then people by name. */
export function byDay(entries: CalendarEntry[], from: string, to: string): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    let d = e.start_date < from ? from : e.start_date;
    const last = e.end_date > to ? to : e.end_date;
    while (d <= last) {
      const list = map.get(d) ?? [];
      list.push(e);
      map.set(d, list);
      d = addDays(d, 1);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.kind === b.kind ? (a.member_name ?? a.label).localeCompare(b.member_name ?? b.label) : a.kind === 'holiday' ? -1 : 1));
  }
  return map;
}

function Chip({ e }: { e: CalendarEntry }) {
  const text = describe(e);
  return (
    <li title={text}>
      <span className={`block truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${e.kind === 'holiday' ? HOLIDAY_TONE : LEAVE_TONE}`}>
        <span className="sr-only">{text}</span>
        <span aria-hidden>
          {e.kind === 'holiday' ? (
            e.label
          ) : (
            <>
              {e.member_name} <span className="font-normal">· {e.label}</span>
            </>
          )}
        </span>
      </span>
    </li>
  );
}

/**
 * The month as Mon–Sun weeks on tablets and desktops; on phones, a list of the days that have
 * entries (a 7-column grid is unreadable at 360px).
 */
export function MonthView({ month, gridStart, gridEnd, today, entries }: { month: string; gridStart: string; gridEnd: string; today: string; entries: CalendarEntry[] }) {
  const days = byDay(entries, gridStart, gridEnd);
  const weeks: string[][] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  const inMonth = (d: string) => d.slice(0, 7) === month;
  const busyDays = Array.from(days.keys()).filter(inMonth).sort();

  return (
    <>
      <div className="card hidden overflow-hidden md:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Holidays and leave, Monday to Sunday</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((w, i) => (
                <th key={w} scope="col" className={`border-r border-b border-line bg-subtle px-2 py-2 text-left text-xs font-medium last:border-r-0 ${i === 6 ? 'text-slate-400' : 'text-slate-500'}`}>
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((d) => {
                  const list = days.get(d) ?? [];
                  const isToday = d === today;
                  const sunday = weekdayIndex(d) === 6;
                  const own = inMonth(d);
                  return (
                    <td
                      key={d}
                      aria-current={isToday ? 'date' : undefined}
                      className={`h-24 border-r border-b border-line p-1.5 align-top last:border-r-0 lg:h-28 ${isToday ? 'bg-navy-50' : !own ? 'bg-slate-50/80' : sunday ? 'bg-slate-50/60' : 'bg-white'}`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span
                          className={
                            isToday
                              ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white'
                              : `px-1 text-xs font-semibold tabular-nums ${own ? (sunday ? 'text-slate-500' : 'text-slate-900') : 'text-slate-400'}`
                          }
                        >
                          <span className="sr-only">{fmtDate(d)}</span>
                          <span aria-hidden>{Number(d.slice(8, 10))}</span>
                        </span>
                        {isToday && <span className="text-[11px] font-semibold text-navy-700">Today</span>}
                      </div>
                      {list.length > 0 && <ul className={`space-y-1 ${own ? '' : 'opacity-60'}`}>{list.map((e) => <Chip key={`${e.kind}-${e.id}`} e={e} />)}</ul>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* With nothing this month, the page shows one empty state below instead of an empty list here. */}
      {busyDays.length > 0 && (
        <div className="md:hidden">
          <ul className="space-y-2">
            {busyDays.map((d) => (
              <li key={d} className={`card p-3 ${d === today ? 'border-l-4 border-l-navy-600' : ''}`} aria-current={d === today ? 'date' : undefined}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {weekdayShort(d)}, {fmtDate(d)}
                  </span>
                  {d === today && <span className="text-[11px] font-semibold text-navy-700">Today</span>}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {(days.get(d) ?? []).map((e) => (
                    <li key={`${e.kind}-${e.id}`} className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium ${e.kind === 'holiday' ? HOLIDAY_TONE : LEAVE_TONE}`}>
                      {e.kind === 'holiday' ? (
                        <>Holiday · {e.label}</>
                      ) : (
                        <span>
                          {e.member_name} <span className="font-normal">· {e.label}{e.backup_name ? ` · backup ${e.backup_name}` : ''}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
