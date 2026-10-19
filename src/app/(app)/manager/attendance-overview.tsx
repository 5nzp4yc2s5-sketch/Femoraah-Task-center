import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { addDays, dayParts, fmtClock, fmtMinutes, friendlyError } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';
import { BarChart, Legend, type Bar, type Series } from '@/components/charts';
import { Notice, SectionTitle, StatCard } from '@/components/ui';
import { dbToday, loadDays, loadTeams } from '../attendance/data';
import { WhoIsIn, type Presence, type PresenceState } from './who-is-in';

const DAYS = 14;
const ON_TIME = new Set(['On Time', 'Within Grace Period']);

const TREND: Series[] = [
  { key: 'onTime', label: 'On time', className: 'bg-emerald-500' },
  { key: 'late', label: 'Late', className: 'bg-amber-400' },
  { key: 'absent', label: 'Not signed in', className: 'bg-red-400' },
  { key: 'leave', label: 'On leave', className: 'bg-violet-400' },
  { key: 'dayOff', label: 'Worked a day off', className: 'bg-sky-400' },
];

const OFF_DAYS = new Set(['Weekly Off', 'Holiday', 'No Schedule']);

function stateOf(r: AttendanceRow): PresenceState {
  if (r.on_break) return 'break';
  if (r.open_session) return 'working';
  if (r.first_login) return 'out';
  if (r.day_type === 'On Leave') return 'leave';
  if (r.day_type === 'Working Day') return 'not_in';
  return 'off';
}

function targetMinutes(r: AttendanceRow): number | null {
  if (r.day_type !== 'Working Day' || !r.scheduled_start || !r.scheduled_end) return null;
  const span = Math.round((Date.parse(r.scheduled_end) - Date.parse(r.scheduled_start)) / 60_000) - (r.break_minutes ?? 0);
  return span > 0 ? span : null;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/**
 * Attendance at a glance for attendance admins: who is in right now, the last two weeks, each
 * team, and the actions that usually follow. Reads the same report as the Attendance page.
 */
export async function AttendanceOverview() {
  const supabase = await createClient();
  const { today, error: todayError } = await dbToday(supabase);
  if (!today) return <Notice tone="error">Could not load today&apos;s attendance ({friendlyError(todayError)}). Please refresh the page.</Notice>;
  const from = addDays(today, -(DAYS - 1));

  // Close stale sessions and create recent exceptions first, as the Attendance page does (idempotent).
  const refresh = await supabase.rpc('attendance_refresh', { p_from: from, p_to: today });
  const [report, flagsRes, correctionsRes, teams] = await Promise.all([
    loadDays(supabase, from, today),
    supabase.from('attendance_flags').select('member_id').neq('status', 'Resolved').limit(5000),
    supabase.from('attendance_corrections').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    loadTeams(supabase),
  ]);
  if (report.error) return <Notice tone="error">Could not load attendance: {friendlyError(report.error)}</Notice>;

  const rows = report.rows;
  const todayRows = rows.filter((r) => r.work_date === today);
  const openByMember = new Map<string, number>();
  for (const f of (flagsRes.data ?? []) as { member_id: string }[]) openByMember.set(f.member_id, (openByMember.get(f.member_id) ?? 0) + 1);
  const openExceptions = [...openByMember.values()].reduce((a, b) => a + b, 0);
  const corrections = correctionsRes.count ?? 0;

  const people: Presence[] = todayRows.map((r) => ({
    id: r.member_id,
    name: r.member_name,
    teamId: r.team_id,
    teamName: r.team_name,
    state: stateOf(r),
    signedIn: r.first_login ? fmtClock(r.first_login, r.tz) : null,
    signedOut: r.last_logout ? fmtClock(r.last_logout, r.tz) : null,
    late: r.login_status === 'Late' ? r.minutes_late : null,
    breakSince: r.break_started_at ? fmtClock(r.break_started_at, r.tz) : null,
    workedMinutes: r.worked_minutes,
    targetMinutes: targetMinutes(r),
    note: r.day_type === 'On Leave' ? r.leave_type ?? 'On leave' : r.day_type === 'Holiday' ? r.holiday_name ?? 'Holiday' : r.day_type === 'Weekly Off' ? 'Weekly off' : r.day_type === 'No Schedule' ? 'No hours set' : null,
    exempt: r.exempt,
    openFlags: openByMember.get(r.member_id) ?? 0,
  }));
  const count = (s: PresenceState) => people.filter((p) => p.state === s).length;
  const expected = todayRows.filter((r) => r.day_type === 'Working Day').length;
  const present = todayRows.filter((r) => r.first_login).length;
  const lateToday = todayRows.filter((r) => r.login_status === 'Late').length;
  const todayHoliday = todayRows.find((r) => r.day_type === 'Holiday')?.holiday_name ?? null;

  // Two weeks, one bar a day. Today is still in progress, so it is drawn lighter.
  const bars: Bar[] = Array.from({ length: DAYS }, (_, i) => {
    const d = addDays(from, i);
    const dayRows = rows.filter((r) => r.work_date === d);
    const worked = dayRows.filter((r) => r.first_login);
    const holiday = dayRows.find((r) => r.day_type === 'Holiday')?.holiday_name;
    const allOff = dayRows.length > 0 && dayRows.every((r) => OFF_DAYS.has(r.day_type));
    const avg = worked.length ? Math.round(worked.reduce((n, r) => n + r.worked_minutes, 0) / worked.length) : null;
    const notes = [
      d === today ? 'Today, so far' : null,
      holiday ? `Holiday: ${holiday}` : allOff ? 'Weekly off' : null,
      avg !== null ? `Average worked ${fmtMinutes(avg)}` : null,
    ].filter(Boolean);
    const p = dayParts(d);
    return {
      key: d,
      label: p.day,
      sublabel: p.weekday.slice(0, 2),
      title: p.title,
      values: {
        onTime: dayRows.filter((r) => ON_TIME.has(r.login_status) || (r.login_status === 'Exempt' && r.first_login)).length,
        late: dayRows.filter((r) => r.login_status === 'Late').length,
        absent: dayRows.filter((r) => r.login_status === 'Not Logged In').length,
        leave: dayRows.filter((r) => r.day_type === 'On Leave').length,
        dayOff: dayRows.filter((r) => r.first_login && OFF_DAYS.has(r.day_type)).length,
      },
      note: notes.join(' · ') || undefined,
      href: `/attendance?from=${d}`,
      muted: allOff || d === today,
    };
  });
  const timedLogins = rows.filter((r) => ON_TIME.has(r.login_status) || r.login_status === 'Late');
  const onTimeRate = pct(timedLogins.filter((r) => ON_TIME.has(r.login_status)).length, timedLogins.length);
  const workedDays = rows.filter((r) => r.first_login && r.work_date !== today);
  const avgHours = workedDays.length ? fmtMinutes(Math.round(workedDays.reduce((n, r) => n + r.worked_minutes, 0) / workedDays.length)) : '—';

  // One line per team, with today's numbers and the two-week rates.
  const teamKeys = [...teams.filter((t) => t.is_active).map((t) => ({ id: t.id as string | null, name: t.name })), ...(rows.some((r) => !r.team_id) ? [{ id: null, name: 'No team' }] : [])];
  const teamLines = teamKeys
    .map((t) => {
      const tr = rows.filter((r) => r.team_id === t.id);
      const tt = tr.filter((r) => r.work_date === today);
      const timed = tr.filter((r) => ON_TIME.has(r.login_status) || r.login_status === 'Late');
      const wd = tr.filter((r) => r.first_login && r.work_date !== today);
      return {
        ...t,
        people: tt.length,
        expected: tt.filter((r) => r.day_type === 'Working Day').length,
        present: tt.filter((r) => r.first_login).length,
        late: tt.filter((r) => r.login_status === 'Late').length,
        leave: tt.filter((r) => r.day_type === 'On Leave').length,
        onTime: pct(timed.filter((r) => ON_TIME.has(r.login_status)).length, timed.length),
        onTimeShare: timed.length ? timed.filter((r) => ON_TIME.has(r.login_status)).length / timed.length : null,
        avg: wd.length ? fmtMinutes(Math.round(wd.reduce((n, r) => n + r.worked_minutes, 0) / wd.length)) : '—',
        open: tt.reduce((n, r) => n + (openByMember.get(r.member_id) ?? 0), 0),
      };
    })
    .filter((t) => t.people > 0);

  const actions = [
    { href: '/attendance/exceptions', label: 'Review exceptions', count: openExceptions },
    { href: '/attendance', label: 'Corrections to decide', count: corrections },
    { href: '/calendar#add-leave', label: 'Record leave' },
    { href: '/calendar#add-holiday', label: 'Add a holiday' },
    { href: '/attendance/exemptions', label: 'Exemptions' },
    { href: `/attendance/export?from=${from}&to=${today}`, label: 'Download 14-day report', download: true },
  ];

  return (
    <section aria-labelledby="att-today" className="fade-up">
      {refresh.error && <Notice tone="warn">Attendance could not be brought fully up to date ({friendlyError(refresh.error.message)}). Figures may miss the latest exceptions.</Notice>}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="att-today" className="text-sm font-semibold uppercase tracking-wide text-navy-800">Attendance today</h2>
        <Link href="/attendance" className="text-sm text-navy-700 hover:underline">Attendance →</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard
          label="Present"
          value={expected ? `${present}/${expected}` : present}
          tone={expected && present >= expected ? 'green' : 'default'}
          hint={expected ? 'Signed in of expected today' : todayHoliday ? `Holiday: ${todayHoliday}` : 'No one is scheduled today'}
          href="/attendance"
        />
        <StatCard label="Working now" value={count('working')} tone={count('working') ? 'green' : 'default'} href="/attendance?status=Currently+Working" />
        <StatCard label="On a break" value={count('break')} tone={count('break') ? 'amber' : 'default'} href="/attendance#breaks" />
        <StatCard label="Late today" value={lateToday} tone={lateToday ? 'amber' : 'default'} href="/attendance?late=1" />
        <StatCard label="Not signed in" value={count('not_in')} tone={count('not_in') ? 'red' : 'default'} hint="Working day, no sign-in" href="/attendance?status=Not+Logged+In" />
        <StatCard label="On leave" value={count('leave')} tone={count('leave') ? 'grey' : 'default'} href="/attendance?leave=1" />
        <StatCard label="Open exceptions" value={openExceptions} tone={openExceptions ? 'red' : 'default'} hint="Waiting for a decision" href="/attendance/exceptions" />
        <StatCard label="Corrections" value={corrections} tone={corrections ? 'amber' : 'default'} hint="Requests to decide" href="/attendance" />
      </div>

      <nav aria-label="Quick actions" className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) =>
          a.download ? (
            <a key={a.href} href={a.href} className="btn-secondary">{a.label}</a>
          ) : (
            <Link key={a.href} href={a.href} className="btn-secondary">
              {a.label}
              {a.count ? <span className="rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-white">{a.count}</span> : null}
            </Link>
          ),
        )}
      </nav>

      <SectionTitle>Who is in</SectionTitle>
      {people.length === 0 ? (
        <p className="card p-4 text-sm text-slate-600">No one has working hours set for today yet.</p>
      ) : (
        <WhoIsIn people={people} teams={teams.filter((t) => t.is_active && people.some((p) => p.teamId === t.id)).map((t) => ({ id: t.id, name: t.name }))} />
      )}

      <div className="grid gap-x-6 xl:grid-cols-5">
        <section className="xl:col-span-3">
          <SectionTitle action={<span className="text-xs text-slate-500">Select a day to open it</span>}>Last 14 days</SectionTitle>
          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-slate-600">On time <strong className="tabular-nums text-navy-900">{onTimeRate}</strong></span>
              <span className="text-slate-600">Average day <strong className="tabular-nums text-navy-900">{avgHours}</strong></span>
            </div>
            <BarChart bars={bars} series={TREND} label="Sign-ins per day over the last 14 days: on time, late, not signed in, on leave and worked a day off" />
            <Legend series={TREND} />
          </div>
        </section>
        <section className="xl:col-span-2">
          <SectionTitle>By team</SectionTitle>
          {teamLines.length === 0 ? (
            <p className="card p-4 text-sm text-slate-600">Add teams in Settings to compare them here.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {teamLines.map((t) => (
                <li key={t.id ?? 'none'} className="p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={t.id ? `/attendance?team=${t.id}` : '/attendance'} className="font-medium text-navy-900 hover:underline">{t.name}</Link>
                    <span className="text-xs tabular-nums text-slate-600">
                      {t.expected ? `${t.present}/${t.expected} in` : t.present ? `${t.present} in, none scheduled` : 'Day off today'}
                      {t.late ? ` · ${t.late} late` : ''}
                      {t.leave ? ` · ${t.leave} on leave` : ''}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={`${t.name}: on time ${t.onTime} over 14 days`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((t.onTimeShare ?? 0) * 100)}>
                      <div className="bar-grow-x h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((t.onTimeShare ?? 0) * 100)}%` }} />
                    </div>
                    <span className="w-24 shrink-0 tabular-nums">On time {t.onTime}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>Average day {t.avg}</span>
                    {t.open > 0 ? (
                      <Link href={t.id ? `/attendance/exceptions?team=${t.id}` : '/attendance/exceptions'} className="font-medium text-amber-800 hover:underline">
                        {t.open} open exception{t.open === 1 ? '' : 's'}
                      </Link>
                    ) : (
                      <span>No open exceptions</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

/** Shown while the attendance overview loads, so the rest of the dashboard appears straight away. */
export function AttendanceOverviewSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading attendance">
      <div className="mb-2 h-4 w-40 rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-200" />
        ))}
      </div>
      <div className="mt-6 h-40 rounded-xl bg-slate-200" />
    </div>
  );
}
