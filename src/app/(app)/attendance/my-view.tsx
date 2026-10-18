import { createClient } from '@/lib/supabase/server';
import { addDays, fmtClock, fmtDate, friendlyError } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';
import type { Me } from '@/lib/session';
import { AttendanceBadge } from '@/components/badges';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { addBreakAction, requestCorrectionAction } from './actions';
import { AttendanceTable, CorrectionList, FlagList, HoursCell, LoginStatusCell, LogoutStatusCell, PrivacyNote, TimeZoneNote } from './parts';
import { BreakControl } from './break-control';
import { attendanceSettings, loadDays, loadSchedules, memberNames, recordedTimes } from './data';
import { DEFAULT_TZ, daysLabel, hhmm, scheduleOn, sortFlags, validDate, type CorrectionRow, type FlagRow } from './lib';

const HISTORY_DAYS = 30;
const CORRECTION_DAYS = 60;

/** "My attendance": the signed-in person's own records only (the database enforces this too). */
export async function MyAttendance({ me, today, correct }: { me: Me; today: string; correct?: string }) {
  const supabase = await createClient();
  const from = addDays(today, -(HISTORY_DAYS - 1));

  const refresh = await supabase.rpc('attendance_refresh', { p_from: from, p_to: today });
  const [report, flagRes, corrRes, schedules, names, settings] = await Promise.all([
    loadDays(supabase, from, today),
    supabase.from('attendance_flags').select('*').eq('member_id', me.memberId).order('work_date', { ascending: false }).limit(200),
    supabase.from('attendance_corrections').select('*').eq('member_id', me.memberId).order('created_at', { ascending: false }).limit(50),
    loadSchedules(supabase, me.memberId),
    memberNames(supabase),
    attendanceSettings(supabase),
  ]);

  const rows = report.rows.filter((r) => r.member_id === me.memberId);
  const todayRow = rows.find((r) => r.work_date === today) ?? null;
  const flags = sortFlags((flagRes.data ?? []) as FlagRow[]);
  const activeFlags = flags.filter((x) => x.status !== 'Resolved');
  const resolvedFlags = flags.filter((x) => x.status === 'Resolved');
  const corrections = (corrRes.data ?? []) as CorrectionRow[];
  const schedule = scheduleOn(schedules.rows, me.memberId, today);
  const upcoming = schedules.rows.filter((s) => s.effective_from > today);

  const rowTz = new Map(rows.map((r) => [r.work_date, r.tz]));
  const tzFor = (_m: string, d: string) => rowTz.get(d) ?? scheduleOn(schedules.rows, me.memberId, d)?.timezone ?? DEFAULT_TZ;
  const recorded = await recordedTimes(
    supabase,
    corrections.filter((c) => c.status !== 'Approved').map((c) => ({ member_id: c.member_id, work_date: c.work_date })),
    schedules.rows,
  );
  const officeTz = todayRow?.tz ?? schedule?.timezone ?? DEFAULT_TZ;
  const minCorrect = addDays(today, -CORRECTION_DAYS);
  const correctDate = validDate(correct) && correct >= minCorrect && correct <= today ? correct : today;

  return (
    <>
      <PageHeader
        title="My attendance"
        subtitle="Your sign-in and sign-out times, judged against your schedule. This record is read-only; to fix a mistake, request a correction."
        actions={<a href={`/attendance/export?from=${from}&to=${today}`} className="btn-secondary">Download CSV</a>}
      />
      {report.error && <Notice tone="error">Could not load your attendance: {friendlyError(report.error)}</Notice>}
      {refresh.error && !report.error && <Notice tone="warn">Your flags could not be brought up to date ({friendlyError(refresh.error.message)}).</Notice>}

      <TodayCard
        row={todayRow}
        today={today}
        scheduleText={todayRow?.scheduled_start ? `${fmtClock(todayRow.scheduled_start, todayRow.tz)}–${fmtClock(todayRow.scheduled_end, todayRow.tz)}${schedule && !schedule.follows_default ? ` · ${daysLabel(schedule.working_days)}` : ''}` : schedule ? 'No hours today' : null}
        graceText={todayRow?.scheduled_start ? `Grace ${todayRow.grace_minutes} min · break ${todayRow.break_minutes} min · ${todayRow.tz}${todayRow.schedule_source && todayRow.schedule_source !== 'Personal' ? ` · ${todayRow.schedule_source === 'Team' ? `${todayRow.team_name ?? 'team'} default` : 'company default'}` : ''}` : null}
      />
      {todayRow?.exempt && (
        <p className="mt-2 text-xs text-sky-800">You are exempt from late, early and long-break flags today. Your times are still recorded.</p>
      )}
      {upcoming.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          Schedule change from {fmtDate(upcoming[0].effective_from)}:{' '}
          {upcoming[0].follows_default ? 'your team or company default hours' : `${hhmm(upcoming[0].start_time)}–${hhmm(upcoming[0].end_time)} · ${daysLabel(upcoming[0].working_days)}`}.
        </p>
      )}
      {todayRow?.first_login && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-navy-700">Forgot to press Break? Add a missed break for today</summary>
          <ActionForm action={addBreakAction} resetOnSuccess className="card mt-2 grid gap-3 p-4 sm:grid-cols-4 sm:items-end">
            <input type="hidden" name="work_date" value={today} />
            <div>
              <label className="label" htmlFor="mb-start">Break start</label>
              <input id="mb-start" type="time" name="start_time" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="mb-end">Break end</label>
              <input id="mb-end" type="time" name="end_time" className="input" required />
            </div>
            <div>
              <label className="label" htmlFor="mb-note">Note</label>
              <input id="mb-note" name="note" className="input" maxLength={500} placeholder="Optional" />
            </div>
            <SubmitButton>Add break</SubmitButton>
            <p className="text-xs text-slate-500 sm:col-span-4">
              Office time ({todayRow.tz}). Only today, within your signed-in time. For an earlier day, ask the admin.
            </p>
          </ActionForm>
        </details>
      )}

      <SectionTitle>Last {HISTORY_DAYS} days</SectionTitle>
      <AttendanceTable
        rows={report.error ? [] : rows}
        showEmployee={false}
        showDate
        flagsHref="#flags"
        correctHref={(r) => (r.day_type === 'Working Day' || r.first_login ? `/attendance?correct=${r.work_date}#request` : null)}
        empty={
          report.error
            ? { title: 'Attendance could not be loaded', body: 'Please refresh the page to try again.' }
            : { title: 'No attendance yet', body: 'Days appear here once you have a work schedule. Your sign-in and sign-out are recorded automatically.' }
        }
      />
      <TimeZoneNote zones={rows.map((r) => r.tz)} />

      <section id="flags" className="scroll-mt-4">
        <SectionTitle>My flags ({activeFlags.length})</SectionTitle>
        <p className="mb-2 text-xs text-slate-500">
          A flag asks the admin to check a day; it is not a finding. Add an explanation so they have the full picture.
        </p>
        {flagRes.error && <Notice tone="error">Could not load your flags: {friendlyError(flagRes.error.message)}</Notice>}
        <FlagList flags={activeFlags} names={names} tzFor={tzFor} empty={{ title: 'No flags', body: 'Nothing needs your attention.' }} />
        {resolvedFlags.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-navy-700">Decided flags ({resolvedFlags.length})</summary>
            <div className="mt-3">
              <FlagList flags={resolvedFlags} names={names} tzFor={tzFor} empty={{ title: 'No resolved flags' }} />
            </div>
          </details>
        )}
      </section>

      <section id="request" className="scroll-mt-4">
        <SectionTitle>Request a correction</SectionTitle>
        <ActionForm key={correctDate} action={requestCorrectionAction} resetOnSuccess className="card space-y-3 p-4 sm:p-5">
          <p className="text-sm text-slate-600">
            Forgot to sign out, or signed in late because of a technical problem? Ask the admin to correct that day. Enter times in office time ({officeTz}).
            Your original sign-in and sign-out stay on record, and nothing changes until an admin approves.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="c-date">Date</label>
              <input id="c-date" type="date" name="work_date" className="input" required min={minCorrect} max={today} defaultValue={correctDate} />
            </div>
            <div>
              <label className="label" htmlFor="c-login">Correct login time</label>
              <input id="c-login" type="time" name="login_time" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="c-logout">Correct logout time</label>
              <input id="c-logout" type="time" name="logout_time" className="input" />
            </div>
          </div>
          <p className="text-xs text-slate-500">Fill in one or both times. You can ask for today or any of the last {CORRECTION_DAYS} days, one pending request per day.</p>
          <div>
            <label className="label" htmlFor="c-reason">Reason</label>
            <textarea id="c-reason" name="reason" rows={3} className="input" required minLength={3} maxLength={1000} placeholder="e.g. Laptop battery died before I could sign out at 19:05" />
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingText="Sending…">Request correction</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section id="corrections" className="scroll-mt-4">
        <SectionTitle>My correction requests</SectionTitle>
        {corrRes.error && <Notice tone="error">Could not load your requests: {friendlyError(corrRes.error.message)}</Notice>}
        <CorrectionList rows={corrections} names={names} recorded={recorded} tzFor={tzFor} mode="self" empty={{ title: 'No correction requests', body: 'Requests you send appear here with their status.' }} />
      </section>

      <PrivacyNote settings={settings} />
    </>
  );
}

function TodayCard({ row, today, scheduleText, graceText }: { row: AttendanceRow | null; today: string; scheduleText: string | null; graceText: string | null }) {
  const dayLine = !row
    ? scheduleText
      ? 'No attendance recorded for today yet.'
      : 'No work schedule is set for you yet. Ask the admin to set your working hours.'
    : row.day_type === 'Holiday'
      ? `Company holiday${row.holiday_name ? `: ${row.holiday_name}` : ''}. No sign-in expected.`
      : row.day_type === 'On Leave'
        ? `You are on leave today${row.leave_type ? ` (${row.leave_type})` : ''}.`
        : row.day_type === 'Weekly Off'
          ? 'Weekly off. No sign-in expected.'
          : row.day_type === 'No Schedule'
            ? 'No work schedule applies today.'
            : `Scheduled ${fmtClock(row.scheduled_start, row.tz)}–${fmtClock(row.scheduled_end, row.tz)} (${row.tz}).`;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="att-today">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="att-today" className="font-semibold text-navy-900">Today · {fmtDate(today)}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{dayLine}</p>
        </div>
        {row?.open_session && <AttendanceBadge status="Currently Working" />}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="label">Signed in</dt>
          <dd className="text-2xl font-semibold tabular-nums text-navy-900">{row ? fmtClock(row.first_login, row.tz) : '—'}</dd>
          {row && <dd className="mt-1"><LoginStatusCell r={row} /></dd>}
        </div>
        <div>
          <dt className="label">Signed out</dt>
          <dd className="text-2xl font-semibold tabular-nums text-navy-900">{row ? fmtClock(row.last_logout, row.tz) : '—'}</dd>
          {row && <dd className="mt-1"><LogoutStatusCell r={row} /></dd>}
        </div>
        <div>
          <dt className="label">Hours worked</dt>
          <dd className="text-2xl font-semibold text-navy-900">{row ? <HoursCell r={row} /> : '—'}</dd>
        </div>
        <div>
          <dt className="label">My schedule</dt>
          <dd className="text-sm font-medium text-navy-900">{scheduleText ?? 'Not set'}</dd>
          {graceText && <dd className="text-xs text-slate-500">{graceText}</dd>}
        </div>
      </dl>
      {row && (row.open_session || row.break_count > 0) && (
        <div className="mt-4 border-t border-line pt-3">
          <BreakControl
            canBreak={row.open_session}
            onBreak={row.on_break}
            startedAt={row.break_started_at}
            takenMinutes={row.break_taken_minutes}
            allowance={row.day_type === 'Working Day' ? row.break_minutes : null}
            tz={row.tz}
          />
        </div>
      )}
    </section>
  );
}
