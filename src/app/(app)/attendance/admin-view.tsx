import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { addDays, fmtDate, friendlyError } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';
import { Notice, PageHeader, SectionTitle, StatCard } from '@/components/ui';
import { AttendanceTable, CorrectionList, FlagList, PrivacyNote, TimeZoneNote } from './parts';
import { attendanceSettings, loadSchedules, memberNames, recordedTimes } from './data';
import {
  DEFAULT_TZ,
  LOGIN_STATUSES,
  LOGOUT_STATUSES,
  applyFilters,
  filterQuery,
  hasStatusFilters,
  parseFilters,
  scheduleOn,
  scopeRows,
  sortFlags,
  type AttendanceSearch,
  type CorrectionRow,
  type FlagRow,
} from './lib';

/** Days before today that are refreshed on every visit, so recent flags exist even when viewing one day. */
const RECENT_DAYS = 14;

export async function AdminAttendance({ sp, today }: { sp: AttendanceSearch & { flags?: string }; today: string }) {
  const supabase = await createClient();
  const { filters: f, error: rangeError } = parseFilters(sp, today);
  const showAllFlags = sp.flags === 'all';

  // Expire stale sessions and create flags before reading (idempotent). Sequential on purpose.
  const refreshErrors: string[] = [];
  const r1 = await supabase.rpc('attendance_refresh', { p_from: f.from, p_to: f.to });
  if (r1.error) refreshErrors.push(r1.error.message);
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));
  if (!(f.from <= recentFrom && f.to >= today)) {
    const r2 = await supabase.rpc('attendance_refresh', { p_from: recentFrom, p_to: today });
    if (r2.error) refreshErrors.push(r2.error.message);
  }

  let flagQuery = supabase.from('attendance_flags').select('*');
  if (f.member) flagQuery = flagQuery.eq('member_id', f.member);
  if (!showAllFlags) flagQuery = flagQuery.eq('status', 'Open');
  let pendingQuery = supabase.from('attendance_corrections').select('*').eq('status', 'Pending');
  if (f.member) pendingQuery = pendingQuery.eq('member_id', f.member);
  let decidedQuery = supabase.from('attendance_corrections').select('*').neq('status', 'Pending');
  if (f.member) decidedQuery = decidedQuery.eq('member_id', f.member);

  const [report, flagRes, pendingRes, decidedRes, members, names, schedules, settings] = await Promise.all([
    supabase.rpc('attendance_report', { p_from: f.from, p_to: f.to }),
    flagQuery.order('work_date', { ascending: false }).order('created_at', { ascending: false }).limit(300),
    pendingQuery.order('work_date', { ascending: true }).order('created_at', { ascending: true }).limit(200),
    decidedQuery.order('decided_at', { ascending: false }).limit(10),
    activeMembers(),
    memberNames(supabase),
    loadSchedules(supabase),
    attendanceSettings(supabase),
  ]);

  const rows = (report.data ?? []) as AttendanceRow[];
  const scoped = scopeRows(rows, f);
  const shown = applyFilters(rows, f);
  const flags = sortFlags((flagRes.data ?? []) as FlagRow[]);
  const pending = (pendingRes.data ?? []) as CorrectionRow[];
  const decided = (decidedRes.data ?? []) as CorrectionRow[];

  const rowTz = new Map(rows.map((r) => [`${r.member_id}|${r.work_date}`, r.tz]));
  const tzFor = (m: string, d: string) => rowTz.get(`${m}|${d}`) ?? scheduleOn(schedules.rows, m, d)?.timezone ?? DEFAULT_TZ;
  const recorded = await recordedTimes(
    supabase,
    [...pending, ...decided.filter((c) => c.status !== 'Approved')].map((c) => ({ member_id: c.member_id, work_date: c.work_date })),
    schedules.rows,
  );

  // Employee choices: active members, plus anyone (e.g. a former member) who has rows in this period.
  const options = new Map(members.map((m) => [m.id, m.name]));
  for (const r of rows) if (!options.has(r.member_id)) options.set(r.member_id, r.member_name);
  if (f.member && !options.has(f.member)) options.set(f.member, names.get(f.member) ?? 'Unknown member');
  const memberName = f.member ? options.get(f.member) : null;

  // Summary figures for the chosen period and employee (status filters below only narrow the table).
  const count = (p: (r: AttendanceRow) => boolean) => scoped.filter(p).length;
  const expected = count((r) => r.day_type === 'Working Day');
  const loggedIn = count((r) => r.first_login !== null);
  const working = count((r) => r.open_session);
  const late = count((r) => r.login_status === 'Late');
  const notLogged = count((r) => r.login_status === 'Not Logged In');
  const leftEarly = count((r) => r.logout_status === 'Left Early');
  const incomplete = scoped.reduce((n, r) => n + r.incomplete_sessions, 0);
  const unit = f.isRange ? 'person-days' : 'people';

  const isToday = !f.isRange && f.from === today;
  const period = f.isRange ? `${fmtDate(f.from)} to ${fmtDate(f.to)}` : isToday ? `today, ${fmtDate(today)}` : fmtDate(f.from);
  const q = (o: Parameters<typeof filterQuery>[1] = {}) => {
    const s = filterQuery(f, o);
    return s ? `/attendance?${s}` : '/attendance';
  };
  const periodOnly = { status: null, late: false, early: false, incomplete: false, leave: false };
  const exportHref = `/attendance/export?${filterQuery(f, { to: f.to })}`;
  const flagsToggle = (() => {
    const s = filterQuery(f);
    if (showAllFlags) return `${s ? `/attendance?${s}` : '/attendance'}#flags`;
    return `/attendance?${s ? `${s}&` : ''}flags=all#flags`;
  })();
  const filtered = Boolean(f.member) || hasStatusFilters(f);

  const quick = [
    { label: 'Today', from: today, to: null as string | null },
    { label: 'Yesterday', from: addDays(today, -1), to: null },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`Sign-in and sign-out times for the team, judged against each person's schedule. Showing ${period}${memberName ? ` for ${memberName}` : ''}.`}
        actions={
          <>
            <Link href="/attendance/schedules" className="btn-secondary">Schedules</Link>
            <a href={exportHref} className="btn-secondary">Export CSV</a>
          </>
        }
      />
      {rangeError && <Notice tone="warn">{rangeError}</Notice>}
      {report.error && <Notice tone="error">Could not load attendance: {friendlyError(report.error.message)}</Notice>}
      {refreshErrors.length > 0 && !report.error && (
        <Notice tone="warn">Attendance flags could not be brought up to date ({friendlyError(refreshErrors[0])}). The figures below may miss the latest flags.</Notice>
      )}
      {pending.length > 0 && (
        <Notice>
          {pending.length} correction request{pending.length === 1 ? ' is' : 's are'} waiting for your decision.{' '}
          <a href="#corrections" className="font-medium underline">Review</a>
        </Notice>
      )}

      <div className="mb-3 flex flex-wrap gap-1">
        {quick.map((p) => {
          const active = f.from === p.from && (p.to ? f.isRange && f.to === p.to : !f.isRange);
          return (
            <Link
              key={p.label}
              href={q({ from: p.from, to: p.to })}
              aria-current={active ? 'true' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <form action="/attendance" className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-6" role="search">
        <div>
          <label className="label" htmlFor="f-from">Date / from</label>
          <input id="f-from" type="date" name="from" defaultValue={f.from} max={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="f-to">To (optional)</label>
          <input id="f-to" type="date" name="to" defaultValue={f.isRange ? f.to : ''} max={today} className="input" />
        </div>
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
          <label className="label" htmlFor="f-member">Employee</label>
          <select id="f-member" name="member" defaultValue={f.member ?? ''} className="input">
            <option value="">Everyone</option>
            {Array.from(options.entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={f.status ?? ''} className="input">
            <option value="">Any status</option>
            <optgroup label="Login status">
              {LOGIN_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </optgroup>
            <optgroup label="Logout status">
              {LOGOUT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-4 lg:col-span-6">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Only show</span>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="late" value="1" defaultChecked={f.late} /> Late
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="early" value="1" defaultChecked={f.early} /> Left early
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="incomplete" value="1" defaultChecked={f.incomplete} /> Incomplete sessions
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="leave" value="1" defaultChecked={f.leave} /> On approved leave
          </label>
          {showAllFlags && <input type="hidden" name="flags" value="all" />}
          <div className="ml-auto flex gap-2">
            {(filtered || f.isRange || !isToday) && <Link href="/attendance" className="btn-ghost">Clear</Link>}
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
        <p className="col-span-2 text-xs text-slate-500 sm:col-span-4 lg:col-span-6">
          Leave &ldquo;To&rdquo; empty for a single day, or set it for a range of up to 93 days. Ticked boxes show rows matching any of them.
        </p>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Expected" value={expected} hint={`Scheduled to work (${unit})`} />
        <StatCard label="Logged in" value={loggedIn} hint={`Signed in at least once (${unit})`} />
        <StatCard label="Currently working" value={working} tone={working ? 'green' : 'default'} href={q({ ...periodOnly, status: 'Currently Working' })} hint="Signed in, not yet signed out" />
        <StatCard label="Late" value={late} tone={late ? 'amber' : 'default'} href={q({ ...periodOnly, late: true })} hint="After the grace period" />
        <StatCard label="Not logged in" value={notLogged} tone={notLogged ? 'grey' : 'default'} href={q({ ...periodOnly, status: 'Not Logged In' })} hint={isToday ? 'No sign-in yet on a working day' : 'No sign-in on a working day'} />
        <StatCard label="Left early" value={leftEarly} tone={leftEarly ? 'amber' : 'default'} href={q({ ...periodOnly, early: true })} hint="Signed out before the scheduled end" />
        <StatCard label="Incomplete sessions" value={incomplete} tone={incomplete ? 'amber' : 'default'} href={q({ ...periodOnly, incomplete: true })} hint="Never signed out" />
      </div>

      <SectionTitle>Attendance · {period}</SectionTitle>
      <p className="mb-2 text-xs text-slate-500">
        {shown.length} row{shown.length === 1 ? '' : 's'}
        {hasStatusFilters(f) && ` matching the filters (of ${scoped.length})`} · Minutes late, early or overtime are shown next to each status.
      </p>
      <AttendanceTable
        rows={report.error ? [] : shown}
        showEmployee
        showDate={f.isRange}
        flagsHref="#flags"
        employeeHref={f.member ? undefined : (r) => q({ member: r.member_id })}
        empty={
          report.error
            ? { title: 'Attendance could not be loaded', body: 'Please refresh the page to try again.' }
            : filtered
              ? { title: 'No attendance rows match these filters', action: <Link href={q(periodOnly)} className="btn-secondary">Clear status filters</Link> }
              : { title: 'No attendance rows for this period', body: 'Days in the future have no attendance yet, and people without a schedule are not listed. Set schedules on the Schedules page.' }
        }
      />
      <TimeZoneNote zones={shown.map((r) => r.tz)} />

      <section id="flags" className="scroll-mt-4">
        <SectionTitle
          action={
            <Link href={flagsToggle} className="text-sm text-navy-700 hover:underline" scroll={false}>
              {showAllFlags ? 'Show open flags only' : 'Show reviewed and resolved'}
            </Link>
          }
        >
          Flags{showAllFlags ? '' : ' to review'} ({flags.length})
        </SectionTitle>
        <p className="mb-2 text-xs text-slate-500">
          {showAllFlags ? 'All flags, open first (latest 300)' : 'Open flags from every date'}
          {memberName ? ` for ${memberName}` : ''}. A flag is a prompt to check with the person, not a finding. Read their explanation before deciding.
        </p>
        {flagRes.error && <Notice tone="error">Could not load flags: {friendlyError(flagRes.error.message)}</Notice>}
        <FlagList
          flags={flags}
          names={names}
          tzFor={tzFor}
          mode="admin"
          empty={{ title: showAllFlags ? 'No flags yet' : 'No open flags', body: 'Late logins, early logouts, missed sign-ins and incomplete sessions appear here for review.' }}
        />
      </section>

      <section id="corrections" className="scroll-mt-4">
        <SectionTitle>Correction requests ({pending.length} pending)</SectionTitle>
        <p className="mb-2 text-xs text-slate-500">
          Approving uses the corrected times for statuses and hours; the original timestamps are kept and the decision is written to the audit log.
        </p>
        {pendingRes.error && <Notice tone="error">Could not load correction requests: {friendlyError(pendingRes.error.message)}</Notice>}
        <CorrectionList
          rows={pending}
          names={names}
          recorded={recorded}
          tzFor={tzFor}
          mode="admin"
          empty={{ title: 'No pending correction requests', body: 'When someone asks to correct a sign-in or sign-out time, it appears here for your decision.' }}
        />
        {decided.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-navy-700">Recently decided ({decided.length})</summary>
            <div className="mt-3">
              <CorrectionList rows={decided} names={names} recorded={recorded} tzFor={tzFor} mode="admin" empty={{ title: 'No decisions yet' }} />
            </div>
          </details>
        )}
      </section>

      <PrivacyNote settings={settings} />
    </>
  );
}
