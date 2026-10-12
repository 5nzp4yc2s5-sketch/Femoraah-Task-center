import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { routinesFor, sortTasks } from '@/lib/data';
import { addDays, fmtClock, fmtDate, fmtMinutes, friendlyError } from '@/lib/format';
import type { AttendanceRow, CalendarEntry, CapacityStatus, RoutineRow, TaskRow } from '@/lib/types';
import { PageHeader, SectionTitle, StatCard, Notice, EmptyState } from '@/components/ui';
import { AttendanceBadge, Avatar, CapacityBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { TaskTable } from '@/components/task-table';
import { RoutineTable } from '@/components/routine-table';

export const metadata = { title: 'My Dashboard' };

interface MySummary {
  today: string;
  open: number;
  overdue: number;
  blocked: number;
  due_today: number;
  due_next_7: number;
  stale: number;
  routine_overdue: number;
  routine_not_logged: number;
  routine_due_today: number;
  routine_ok: number;
  routines_active: number;
  max_open_tasks: number;
  has_capacity: boolean;
  on_leave: boolean;
  capacity_status: CapacityStatus;
  covering: number;
}

interface Activity {
  task_id: string;
  task_code: string;
  title: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: string;
  summary: string;
}

export default async function MyDashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const [
    { data: summaryData, error: summaryError },
    { data: tasks, error: tasksError },
    routines,
    { data: coveringData },
    { data: activityData, error: activityError },
  ] = await Promise.all([
    supabase.rpc('my_summary'),
    supabase.from('task_board').select('*').is('archived_at', null).order('last_update_at', { ascending: false }).limit(500),
    routinesFor(me.memberId),
    // Routines I cover today because the person they are assigned to is on leave.
    supabase.from('routine_board').select('*').eq('covered_by_id', me.memberId).neq('owner_id', me.memberId).eq('is_active', true).order('title'),
    // Changes other people made to tasks I can see (row access follows the task).
    supabase
      .from('task_activity')
      .select('task_id, task_code, title, at, actor_id, actor_name, kind, summary')
      .or(`actor_id.is.null,actor_id.neq.${me.memberId}`)
      .order('at', { ascending: false })
      .limit(15),
  ]);
  const summary = (summaryData ?? null) as MySummary | null;
  const today = summary?.today;

  // "Today" comes from the database, so these wait for my_summary().
  const [calendar, attendance] = today
    ? await Promise.all([
        supabase.rpc('team_calendar', { p_from: today, p_to: addDays(today, 30) }),
        supabase.rpc('attendance_report', { p_from: today, p_to: today, p_member: me.memberId }),
      ])
    : [null, null];
  const upcoming30 = (calendar?.data ?? []) as CalendarEntry[];
  const attendanceToday = ((attendance?.data ?? []) as AttendanceRow[]).find((r) => r.member_id === me.memberId && r.work_date === today);

  const all = (tasks ?? []) as TaskRow[];
  const mine = all.filter((t) => t.owner_id === me.memberId);
  const myOpen = sortTasks(mine.filter((t) => t.status !== 'Done'));
  const upcoming = sortTasks(myOpen.filter((t) => t.days_left !== null && t.days_left >= 0 && t.days_left <= 7), 'due');
  const delegated = sortTasks(all.filter((t) => t.owner_id !== me.memberId && t.assigned_by === me.memberId));
  const recent = all.filter((t) => t.owner_id === me.memberId || t.created_by === me.memberId || t.assigned_by === me.memberId).slice(0, 8);
  const myRoutines = routines.filter((r) => r.owner_id === me.memberId);
  const covering = (coveringData ?? []) as RoutineRow[];
  const activity = (activityData ?? []) as Activity[];
  const routinesHref = (status: string) => `/routines?owner=${me.memberId}&status=${encodeURIComponent(status)}`;

  return (
    <>
      {sp.error === 'managers-only' && <Notice tone="warn">That page is for managers.</Notice>}
      {sp.error === 'admins-only' && <Notice tone="warn">That page is for admins.</Notice>}
      <PageHeader
        title={`Hello, ${me.name}`}
        subtitle="Your work at a glance. Update status, % complete and a one-line note on anything you worked on today."
        actions={
          <>
            <Link href="/tasks/new" className="btn-primary">New task</Link>
            <Link href="/backlog/new" className="btn-secondary">Add to backlog</Link>
          </>
        }
      />
      {summaryError && <Notice tone="error">Could not load your summary: {friendlyError(summaryError.message)}</Notice>}
      {tasksError && <Notice tone="error">Could not load your tasks: {friendlyError(tasksError.message)}</Notice>}
      {summary?.on_leave && <Notice>You are on leave today.</Notice>}
      {summary && summary.covering > 0 && (
        <Notice>
          You are covering {summary.covering} routine{summary.covering === 1 ? '' : 's'} today for a teammate on leave.{' '}
          <a href="#covering" className="font-medium underline">See them below</a>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard label="My open tasks" value={summary?.open ?? 0} hint={`Capacity ${summary?.open ?? 0}/${summary?.max_open_tasks ?? '—'}`} href="/tasks?scope=mine" />
        <StatCard label="Due today" value={summary?.due_today ?? 0} tone={summary?.due_today ? 'amber' : 'default'} href="/tasks?scope=mine&due=today" />
        <StatCard label="Overdue" value={summary?.overdue ?? 0} tone={summary?.overdue ? 'red' : 'default'} href="/tasks?scope=mine&flag=Overdue" />
        <StatCard label="Blocked" value={summary?.blocked ?? 0} tone={summary?.blocked ? 'orange' : 'default'} href="/tasks?scope=mine&status=Blocked" />
        <StatCard label="Due next 7 days" value={summary?.due_next_7 ?? 0} tone={summary?.due_next_7 ? 'amber' : 'default'} href="/tasks?scope=mine&due=week" />
        <StatCard label="No update 3+ days" value={summary?.stale ?? 0} tone={summary?.stale ? 'amber' : 'default'} href="/tasks?scope=mine&stale=1" />
        <StatCard label="Routines due today" value={summary?.routine_due_today ?? 0} tone={summary?.routine_due_today ? 'amber' : 'default'} href={routinesHref('Due Today')} />
        <StatCard
          label="Routine overdue"
          value={summary?.routine_overdue ?? 0}
          tone={summary?.routine_overdue ? 'red' : 'default'}
          hint={`${summary?.routine_not_logged ?? 0} not logged yet`}
          href={routinesHref('Overdue')}
        />
      </div>
      {summary && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-600">
          <span>
            Workload: <strong className="tabular-nums text-navy-900">{summary.open}</strong> of {summary.max_open_tasks} open tasks
          </span>
          <CapacityBadge status={summary.capacity_status} />
          <span>
            · Routines: <strong className="tabular-nums text-navy-900">{summary.routine_ok}</strong> of {summary.routines_active} up to date
            {summary.routine_not_logged > 0 && <>, {summary.routine_not_logged} not logged yet</>}
          </span>
        </div>
      )}

      <SectionTitle action={<Link href="/tasks?scope=mine" className="text-sm text-navy-700 hover:underline">All my tasks →</Link>}>My open tasks</SectionTitle>
      <TaskTable rows={myOpen} compact empty={{ title: 'Nothing open', body: 'Tasks assigned to you will appear here.' }} />

      {upcoming.length > 0 && (
        <>
          <SectionTitle>Upcoming deadlines (next 7 days)</SectionTitle>
          <TaskTable rows={upcoming} compact />
        </>
      )}

      <SectionTitle action={<Link href="/routines" className="text-sm text-navy-700 hover:underline">All routines →</Link>}>My routine tasks</SectionTitle>
      <RoutineTable rows={myRoutines} canComplete={() => true} today={today ?? ''} showOwner={false} />

      {covering.length > 0 && (
        <section id="covering">
          <SectionTitle>Routines I am covering</SectionTitle>
          <RoutineTable rows={covering} canComplete={() => true} today={today ?? ''} viewerId={me.memberId} />
        </section>
      )}

      <div className="grid gap-x-6 lg:grid-cols-2">
        <section>
          <SectionTitle action={<Link href="/attendance" className="text-sm text-navy-700 hover:underline">Attendance →</Link>}>My attendance today</SectionTitle>
          {attendance?.error ? (
            <Notice tone="error">Could not load your attendance: {friendlyError(attendance.error.message)}</Notice>
          ) : !attendanceToday ? (
            <EmptyState title="No attendance record for today" body="Your sign-in time appears here once a work schedule is set for you." />
          ) : (
            <div className="card p-4 text-sm">
              {attendanceToday.day_type !== 'Working Day' && (
                <p className="mb-3 flex flex-wrap items-center gap-2">
                  <AttendanceBadge status={attendanceToday.day_type} />
                  {attendanceToday.holiday_name && <span className="text-slate-600">{attendanceToday.holiday_name}</span>}
                  {attendanceToday.leave_type && <span className="text-slate-600">{attendanceToday.leave_type}</span>}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="label">Signed in</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-navy-900">{fmtClock(attendanceToday.first_login, attendanceToday.tz)}</span>
                    <AttendanceBadge status={attendanceToday.login_status} />
                  </dd>
                </div>
                <div>
                  <dt className="label">Signed out</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums text-navy-900">{fmtClock(attendanceToday.last_logout, attendanceToday.tz)}</span>
                    <AttendanceBadge status={attendanceToday.logout_status} />
                  </dd>
                </div>
                <div>
                  <dt className="label">Schedule</dt>
                  <dd className="tabular-nums text-slate-700">
                    {attendanceToday.scheduled_start
                      ? `${fmtClock(attendanceToday.scheduled_start, attendanceToday.tz)}–${fmtClock(attendanceToday.scheduled_end, attendanceToday.tz)}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="label">Worked so far</dt>
                  <dd className="tabular-nums text-slate-700">{fmtMinutes(attendanceToday.worked_minutes)}</dd>
                </div>
              </dl>
              {attendanceToday.pending_correction && <p className="mt-3 text-xs text-slate-600">You have a correction request waiting for review.</p>}
              <p className="mt-3 text-xs text-slate-500">Times are recorded by the server when you sign in and out (shown in {attendanceToday.tz}).</p>
            </div>
          )}
        </section>

        <section>
          <SectionTitle action={<Link href="/calendar" className="text-sm text-navy-700 hover:underline">Team Calendar →</Link>}>Upcoming leave and holidays</SectionTitle>
          {calendar?.error ? (
            <Notice tone="error">Could not load the team calendar: {friendlyError(calendar.error.message)}</Notice>
          ) : upcoming30.length === 0 ? (
            <EmptyState title="No leave or holidays in the next 30 days" />
          ) : (
            <ul className="card divide-y divide-line">
              {upcoming30.map((e) => (
                <li key={`${e.kind}-${e.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-navy-900">
                      {e.kind === 'holiday' ? e.label : e.member_name}
                      {e.member_id === me.memberId && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {e.kind === 'holiday' ? 'Company holiday' : e.label}
                      {e.backup_name && <> · Backup: {e.backup_member_id === me.memberId ? <strong className="text-navy-900">you</strong> : e.backup_name}</>}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-right text-xs tabular-nums text-slate-600">
                    {fmtDate(e.start_date)}
                    {e.end_date !== e.start_date && <> – {fmtDate(e.end_date)}</>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <SectionTitle action={<Link href="/tasks?scope=assigned" className="text-sm text-navy-700 hover:underline">All →</Link>}>Tasks I delegated to others</SectionTitle>
      <TaskTable rows={delegated} compact empty={{ title: 'You have not delegated any open tasks', body: 'Tasks where you are Delegated by stay visible here so you can track them.' }} />

      <SectionTitle>Recent changes</SectionTitle>
      {activityError ? (
        <Notice tone="error">Could not load recent changes: {friendlyError(activityError.message)}</Notice>
      ) : activity.length === 0 ? (
        <EmptyState title="No recent changes" body="Updates other people make to tasks you can see will appear here." />
      ) : (
        <ul className="card divide-y divide-line">
          {activity.map((a, i) => (
            <li key={`${a.task_id}-${a.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
              <Avatar name={a.actor_name ?? '?'} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-slate-800">
                  <span className="font-medium text-navy-900">{a.actor_name ?? 'Someone'}</span> · {a.summary}
                </p>
                <p className="mt-0.5 break-words text-xs text-slate-500">
                  <Link href={`/tasks/${a.task_id}`} className="hover:underline">
                    <span className="font-mono">{a.task_code}</span> {a.title}
                  </Link>{' '}
                  · <LocalTime iso={a.at} mode="relative" />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Recently updated</SectionTitle>
      <TaskTable rows={recent} compact empty={{ title: 'No recent activity' }} />
    </>
  );
}
