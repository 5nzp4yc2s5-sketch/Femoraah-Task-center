import Link from 'next/link';
import { addDays, dayParts, fmtClock, fmtMinutes } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';
import { Meter } from '@/components/charts';

const ON_TIME = new Set(['On Time', 'Within Grace Period']);

function tone(r: AttendanceRow | undefined, isToday: boolean): { cls: string; label: string } {
  if (!r) return { cls: 'bg-white text-slate-400 ring-slate-200', label: 'No record' };
  if (r.day_type === 'On Leave') return { cls: 'bg-violet-100 text-violet-900 ring-violet-200', label: r.leave_type ?? 'On leave' };
  if (r.day_type === 'Holiday') return { cls: 'bg-slate-100 text-slate-600 ring-slate-200', label: r.holiday_name ? `Holiday: ${r.holiday_name}` : 'Holiday' };
  if (r.day_type !== 'Working Day' && !r.first_login) return { cls: 'bg-white text-slate-400 ring-slate-200', label: r.day_type === 'Weekly Off' ? 'Weekly off' : 'No hours set' };
  if (r.login_status === 'Late') return { cls: 'bg-amber-100 text-amber-900 ring-amber-300', label: `Late by ${fmtMinutes(r.minutes_late)}` };
  if (ON_TIME.has(r.login_status) || r.first_login) return { cls: 'bg-emerald-100 text-emerald-900 ring-emerald-300', label: r.login_status === 'Exempt' ? 'Signed in (exempt)' : 'On time' };
  if (isToday) return { cls: 'bg-white text-slate-500 ring-slate-300', label: 'Not signed in yet' };
  return { cls: 'bg-red-100 text-red-900 ring-red-300', label: 'Not signed in' };
}

const scheduled = (r: AttendanceRow) =>
  r.day_type === 'Working Day' && r.scheduled_start && r.scheduled_end
    ? Math.max(0, Math.round((Date.parse(r.scheduled_end) - Date.parse(r.scheduled_start)) / 60_000) - (r.break_minutes ?? 0))
    : 0;

/** Your own last two weeks, one tile a day, and this week's hours against your schedule. */
export function MyAttendanceTrend({ rows, today, memberId }: { rows: AttendanceRow[]; today: string; memberId: string }) {
  const mine = new Map(rows.filter((r) => r.member_id === memberId).map((r) => [r.work_date, r]));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const past = days.map((d) => mine.get(d)).filter((r): r is AttendanceRow => !!r);
  const timed = past.filter((r) => ON_TIME.has(r.login_status) || r.login_status === 'Late');
  const onTime = timed.filter((r) => ON_TIME.has(r.login_status)).length;

  // This week runs Monday to Sunday; the schedule counts the whole week, worked time counts up to now.
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => mine.get(addDays(monday, i))).filter((r): r is AttendanceRow => !!r);
  const weekWorked = week.reduce((n, r) => n + r.worked_minutes, 0);
  const weekTarget = week.reduce((n, r) => n + scheduled(r), 0);

  return (
    <div className="card space-y-4 p-4">
      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-navy-900">This week</span>
          <span className="tabular-nums text-slate-600">
            <strong className="text-navy-900">{fmtMinutes(weekWorked)}</strong> worked{weekTarget ? <> of {fmtMinutes(weekTarget)} scheduled</> : null}
          </span>
        </div>
        {weekTarget > 0 && <Meter value={weekWorked} max={weekTarget} label={`Worked ${fmtMinutes(weekWorked)} of ${fmtMinutes(weekTarget)} this week`} />}
      </div>
      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-navy-900">Last 14 days</span>
          <span className="text-slate-600">{timed.length ? <>On time on <strong className="tabular-nums text-navy-900">{onTime}</strong> of {timed.length} days</> : 'No sign-ins yet'}</span>
        </div>
        <ol className="grid grid-cols-7 gap-1.5 sm:grid-cols-14">
          {days.map((d) => {
            const r = mine.get(d);
            const t = tone(r, d === today);
            const p = dayParts(d);
            const detail = [t.label, r?.first_login ? `in ${fmtClock(r.first_login, r.tz)}` : null, r && r.worked_minutes ? `worked ${fmtMinutes(r.worked_minutes)}` : null].filter(Boolean).join(', ');
            return (
              <li key={d}>
                <Link
                  href="/attendance"
                  title={`${p.title}: ${detail}`}
                  aria-label={`${p.title}: ${detail}`}
                  className={`flex flex-col items-center rounded-lg px-1 py-1.5 text-center ring-1 ring-inset transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-navy-600 ${t.cls} ${d === today ? 'outline-2 outline-offset-1 outline-accent' : ''}`}
                >
                  <span className="text-[10px] uppercase leading-none opacity-80">{p.weekday.slice(0, 2)}</span>
                  <span className="text-sm font-semibold leading-tight tabular-nums">{p.day}</span>
                  <span className="text-[10px] leading-none tabular-nums opacity-80">{r && r.worked_minutes ? `${(r.worked_minutes / 60).toFixed(1)}h` : '·'}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500" aria-hidden>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-300" />On time</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-300" />Late</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-300" />Not signed in</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-300" />Leave</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-200" />Off or holiday</span>
        </p>
      </div>
    </div>
  );
}
