import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { addDays, fmtClock, fmtDate, fmtMinutes, friendlyError } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';
import { EmptyState, Notice, PageHeader, SectionTitle, StatCard } from '@/components/ui';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { AttendanceTable, CorrectionList, PrivacyNote, TimeZoneNote } from './parts';
import { addBreakAction, voidBreakAction } from './actions';
import { attendanceSettings, loadDays, loadSchedules, loadTeams, memberNames, recordedTimes } from './data';
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
  type AttendanceSearch,
  type CorrectionRow,
} from './lib';

interface BreakRow {
  id: string;
  member_id: string;
  work_date: string;
  source: 'app' | 'manual';
  start_at: string;
  end_at: string | null;
  note: string;
  entered_by: string | null;
  closed_incomplete_at: string | null;
}

/** Days before today that are refreshed on every visit, so recent flags exist even when viewing one day. */
const RECENT_DAYS = 14;

export async function AdminAttendance({ sp, today }: { sp: AttendanceSearch; today: string }) {
  const supabase = await createClient();
  const { filters: f, error: rangeError } = parseFilters(sp, today);

  // Expire stale sessions and create flags before reading (idempotent). Sequential on purpose.
  const refreshErrors: string[] = [];
  const r1 = await supabase.rpc('attendance_refresh', { p_from: f.from, p_to: f.to });
  if (r1.error) refreshErrors.push(r1.error.message);
  const recentFrom = addDays(today, -(RECENT_DAYS - 1));
  if (!(f.from <= recentFrom && f.to >= today)) {
    const r2 = await supabase.rpc('attendance_refresh', { p_from: recentFrom, p_to: today });
    if (r2.error) refreshErrors.push(r2.error.message);
  }

  let flagQuery = supabase.from('attendance_flags').select('id', { count: 'exact', head: true }).neq('status', 'Resolved');
  if (f.member) flagQuery = flagQuery.eq('member_id', f.member);
  let breakQuery = supabase.from('attendance_breaks').select('*').is('voided_at', null).gte('work_date', f.from).lte('work_date', f.to);
  if (f.member) breakQuery = breakQuery.eq('member_id', f.member);
  let pendingQuery = supabase.from('attendance_corrections').select('*').eq('status', 'Pending');
  if (f.member) pendingQuery = pendingQuery.eq('member_id', f.member);
  let decidedQuery = supabase.from('attendance_corrections').select('*').neq('status', 'Pending');
  if (f.member) decidedQuery = decidedQuery.eq('member_id', f.member);

  const [report, flagRes, breakRes, pendingRes, decidedRes, members, names, schedules, settings, teams] = await Promise.all([
    loadDays(supabase, f.from, f.to, { team: f.team }),
    flagQuery,
    breakQuery.order('start_at', { ascending: false }).limit(300),
    pendingQuery.order('work_date', { ascending: true }).order('created_at', { ascending: true }).limit(200),
    decidedQuery.order('decided_at', { ascending: false }).limit(10),
    activeMembers(),
    memberNames(supabase),
    loadSchedules(supabase),
    attendanceSettings(supabase),
    loadTeams(supabase),
  ]);

  const rows = report.rows;
  const scoped = scopeRows(rows, f);
  const shown = applyFilters(rows, f);
  const openExceptions = flagRes.count ?? 0;
  const breaks = ((breakRes.data ?? []) as BreakRow[]).filter((b) => !f.team || rows.some((r) => r.member_id === b.member_id));
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
  const teamName = f.team ? teams.find((t) => t.id === f.team)?.name ?? 'Unknown team' : null;

  // Summary figures for the chosen period and employee (status filters below only narrow the table).
  const count = (p: (r: AttendanceRow) => boolean) => scoped.filter(p).length;
  const expected = count((r) => r.day_type === 'Working Day');
  const loggedIn = count((r) => r.first_login !== null);
  const working = count((r) => r.open_session);
  const late = count((r) => r.login_status === 'Late');
  const notLogged = count((r) => r.login_status === 'Not Logged In');
  const leftEarly = count((r) => r.logout_status === 'Left Early');
  const incomplete = scoped.reduce((n, r) => n + r.incomplete_sessions, 0);
  const onBreak = count((r) => r.on_break);
  const unit = f.isRange ? 'person-days' : 'people';

  const isToday = !f.isRange && f.from === today;
  const period = f.isRange ? `${fmtDate(f.from)} to ${fmtDate(f.to)}` : isToday ? `today, ${fmtDate(today)}` : fmtDate(f.from);
  const q = (o: Parameters<typeof filterQuery>[1] = {}) => {
    const s = filterQuery(f, o);
    return s ? `/attendance?${s}` : '/attendance';
  };
  const periodOnly = { status: null, late: false, early: false, incomplete: false, leave: false };
  const exportHref = `/attendance/export?${filterQuery(f, { to: f.to })}`;
  const filtered = Boolean(f.member) || Boolean(f.team) || hasStatusFilters(f);
  const exceptionsHref = `/attendance/exceptions${f.member ? `?member=${f.member}` : ''}`;

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
        subtitle={`Sign-in and sign-out times for the team, judged against each person's schedule. Showing ${period}${memberName ? ` for ${memberName}` : ''}${teamName ? ` in ${teamName}` : ''}.`}
        actions={
          <>
            <Link href="/attendance/exceptions" className="btn-primary">Exceptions{openExceptions ? ` (${openExceptions})` : ''}</Link>
            <Link href="/attendance/exemptions" className="btn-secondary">Exemptions</Link>
            <Link href="/attendance/schedules" className="btn-secondary">Schedules</Link>
            <a href={exportHref} className="btn-secondary">Export CSV</a>
          </>
        }
      />
      {rangeError && <Notice tone="warn">{rangeError}</Notice>}
      {report.error && <Notice tone="error">Could not load attendance: {friendlyError(report.error)}</Notice>}
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
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="f-member">Employee</label>
          <select id="f-member" name="member" defaultValue={f.member ?? ''} className="input">
            <option value="">Everyone</option>
            {Array.from(options.entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-team">Team</label>
          <select id="f-team" name="team" defaultValue={f.team ?? ''} className="input">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (archived)'}</option>)}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-1">
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
          <span className="text-[13px] font-medium text-slate-600">Only show</span>
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
          <div className="ml-auto flex gap-2">
            {(filtered || f.isRange || !isToday) && <Link href="/attendance" className="btn-ghost">Clear</Link>}
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
        <p className="col-span-2 text-xs text-slate-500 sm:col-span-4 lg:col-span-6">
          Leave &ldquo;To&rdquo; empty for a single day, or set it for a range of up to 93 days. Ticked boxes show rows matching any of them.
        </p>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Expected" value={expected} hint={`Scheduled to work (${unit})`} />
        <StatCard label="Logged in" value={loggedIn} hint={`Signed in at least once (${unit})`} />
        <StatCard label="Currently working" value={working} tone={working ? 'green' : 'default'} href={q({ ...periodOnly, status: 'Currently Working' })} hint="Signed in, not yet signed out" />
        <StatCard label="On a break" value={onBreak} tone={onBreak ? 'amber' : 'default'} href="#breaks" hint="Break running now" />
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
        flagsHref={exceptionsHref}
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
        <SectionTitle action={<Link href={exceptionsHref} className="link text-sm">Open the exception queue</Link>}>
          Exceptions to review ({openExceptions})
        </SectionTitle>
        {flagRes.error ? (
          <Notice tone="error">Could not count open exceptions: {friendlyError(flagRes.error.message)}</Notice>
        ) : (
          <p className="card p-4 text-sm text-slate-700">
            {openExceptions
              ? `${openExceptions} exception${openExceptions === 1 ? ' is' : 's are'} waiting for a decision${memberName ? ` for ${memberName}` : ''}. Approve, reject or waive them one by one or in bulk in the exception queue.`
              : 'No exceptions are waiting for a decision.'}{' '}
            A flag is a prompt to check with the person, not a finding. Read their explanation before deciding.
          </p>
        )}
      </section>

      <section id="breaks" className="scroll-mt-4">
        <SectionTitle>Breaks · {period}</SectionTitle>
        {breakRes.error && <Notice tone="error">Could not load breaks: {friendlyError(breakRes.error.message)}</Notice>}
        {breaks.length === 0 ? (
          <EmptyState title="No breaks recorded in this period" body="Breaks appear here when people use the Break button on their dashboard, or when one is added by hand below." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Start</th>
                  <th>End</th>
                  <th className="text-right">Length</th>
                  <th>Recorded</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {breaks.map((b) => {
                  const tz = tzFor(b.member_id, b.work_date);
                  const mins = b.end_at ? Math.floor((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000) : null;
                  return (
                    <tr key={b.id}>
                      <td className="whitespace-nowrap font-medium text-slate-900">{names.get(b.member_id) ?? 'Former member'}</td>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(b.work_date)}</td>
                      <td className="tabular-nums">{fmtClock(b.start_at, tz)}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {b.end_at ? fmtClock(b.end_at, tz) : b.closed_incomplete_at ? <span className="text-orange-700">Not ended</span> : <span className="text-amber-800">On break</span>}
                      </td>
                      <td className="text-right tabular-nums">{mins === null ? '—' : fmtMinutes(mins)}</td>
                      <td className="whitespace-nowrap text-xs text-slate-600">
                        {b.source === 'app' ? 'Break button' : `Added by ${b.entered_by ? names.get(b.entered_by) ?? 'someone' : 'someone'}`}
                      </td>
                      <td className="max-w-64 text-slate-600"><span className="line-clamp-2">{b.note || '—'}</span></td>
                      <td>
                        <ConfirmAction
                          action={voidBreakAction}
                          label="Remove"
                          title="Remove this break?"
                          body="It stops counting towards break time and hours worked. The record is kept, marked as removed, with your reason."
                          confirmLabel="Remove break"
                          className="btn-ghost px-2.5 py-1 text-xs"
                          hidden={{ id: b.id }}
                          withNote
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-navy-700">Add a missed break</summary>
          <ActionForm action={addBreakAction} resetOnSuccess className="card mt-2 grid gap-3 p-4 sm:grid-cols-5 sm:items-end">
            <div>
              <label className="label" htmlFor="b-member">Employee</label>
              <select id="b-member" name="member_id" className="input" required defaultValue={f.member ?? ''}>
                <option value="" disabled>Choose…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="b-date">Date</label>
              <input id="b-date" type="date" name="work_date" className="input" required max={today} min={addDays(today, -60)} defaultValue={f.isRange ? today : f.from} />
            </div>
            <div>
              <label className="label" htmlFor="b-start">Start</label>
              <input id="b-start" type="time" name="start_time" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="b-end">End</label>
              <input id="b-end" type="time" name="end_time" className="input" required />
            </div>
            <SubmitButton>Add break</SubmitButton>
            <div className="sm:col-span-5">
              <label className="label" htmlFor="b-note">Note</label>
              <input id="b-note" name="note" className="input" maxLength={500} placeholder="e.g. Forgot to press Break at lunch" />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-5">
              Office time. The break must fall within that day&apos;s signed-in time and must not overlap another break.
            </p>
          </ActionForm>
        </details>
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
