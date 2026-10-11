import Link from 'next/link';
import { requireManager } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers, routinesFor, sortTasks } from '@/lib/data';
import { fmtDate, friendlyError, isIsoDate } from '@/lib/format';
import { FREQUENCIES, PRIORITIES, STATUSES, type CapacityStatus, type RoutineRow, type TaskRow } from '@/lib/types';
import { PageHeader, SectionTitle, StatCard, Notice, EmptyState } from '@/components/ui';
import { CapacityBadge, FlaggedStar, PriorityBadge, StatusBadge } from '@/components/badges';
import { TaskTable } from '@/components/task-table';
import { RoutineTable } from '@/components/routine-table';

export const metadata = { title: 'Dashboard' };

interface Person {
  member_id: string;
  name: string;
  role_title: string;
  open: number;
  overdue: number;
  blocked: number;
  due_today: number;
  due_next_7: number;
  stale: number;
  routine_overdue: number;
  routine_not_logged: number;
  max_open_tasks: number;
  has_capacity: boolean;
  on_leave: boolean;
  leave_until: string | null;
  capacity_status: CapacityStatus;
}

interface Dashboard {
  today: string;
  open: number;
  overdue: number;
  blocked: number;
  due_today: number;
  due_next_7: number;
  stale: number;
  done_last_7: number;
  critical_open: number;
  flagged_open: number;
  unassigned_backlog: number;
  routine_overdue: number;
  routine_not_logged: number;
  routines: { active: number; ok: number; due_today: number; overdue: number; not_logged: number; done_today: number; completion_rate: number | null };
  capacity: { open: number; max: number; utilization: number | null; on_leave: number; overloaded: number; at_capacity: number };
  open_data_issues: number;
  people: Person[];
}

type Escalation = Pick<TaskRow, 'id' | 'task_code' | 'title' | 'owner_name' | 'priority' | 'status' | 'due_date' | 'days_left' | 'blocker_reason' | 'blocked_at' | 'is_flagged'>;
type OverdueRoutine = Pick<RoutineRow, 'id' | 'routine_code' | 'title' | 'owner_name' | 'frequency' | 'next_due' | 'owner_on_leave' | 'covered_by_name'>;

type SP = { member?: string; status?: string; priority?: string; from?: string; to?: string; frequency?: string };

const oneOf = (list: readonly string[], v: string | undefined) => (v && list.includes(v) ? v : null);

/** Builds a link that carries only the filters that are set. */
function qs(path: string, params: Record<string, string | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The calendar date (yyyy-mm-dd) of an instant in the company time zone. */
function localDate(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default async function ManagerDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();

  const member = sp.member && /^[0-9a-f-]{36}$/i.test(sp.member) ? sp.member : null;
  const status = oneOf(STATUSES, sp.status);
  const priority = oneOf(PRIORITIES, sp.priority);
  const frequency = oneOf(FREQUENCIES, sp.frequency);
  let from = isIsoDate(sp.from) ? sp.from : null;
  let to = isIsoDate(sp.to) ? sp.to : null;
  const badRange = Boolean(from && to && from > to);
  if (badRange) from = to = null;

  let escalationsQuery = supabase
    .from('task_board')
    .select('id, task_code, title, owner_name, priority, status, due_date, days_left, blocker_reason, blocked_at, is_flagged')
    .is('archived_at', null)
    .neq('status', 'Done')
    .or('status.eq.Blocked,days_left.lt.0');
  if (member) escalationsQuery = escalationsQuery.eq('owner_id', member);
  let overdueRoutinesQuery = supabase
    .from('routine_board')
    .select('id, routine_code, title, owner_name, frequency, next_due, owner_on_leave, covered_by_name')
    .eq('is_active', true)
    .eq('status', 'Overdue');
  if (member) overdueRoutinesQuery = overdueRoutinesQuery.eq('owner_id', member);
  if (frequency) overdueRoutinesQuery = overdueRoutinesQuery.eq('frequency', frequency);

  const [{ data: raw, error }, members, { data: escData, error: escError }, { data: rtData, error: rtError }] = await Promise.all([
    supabase.rpc('manager_dashboard', { p_member: member, p_status: status, p_priority: priority, p_from: from, p_to: to, p_frequency: frequency }),
    activeMembers(),
    escalationsQuery.limit(300),
    overdueRoutinesQuery.order('next_due', { ascending: true }).limit(300),
  ]);

  const header = <PageHeader title="Dashboard" subtitle="Manager view. Updates automatically from the Task Board, Pending Backlog and Routine Tasks." />;
  if (error || !raw) {
    return (
      <>
        {header}
        <Notice tone="error">Could not load the dashboard: {friendlyError(error?.message)}</Notice>
      </>
    );
  }
  const d = raw as Dashboard;
  const people = d.people ?? [];
  const selected = member ? people.find((p) => p.member_id === member) : undefined;
  const selectedName = selected?.name ?? members.find((m) => m.id === member)?.name;

  // Overdue first (most days late first), then blocked (longest blocked first).
  const escalations = ((escData ?? []) as Escalation[]).sort((a, b) => {
    const ao = a.days_left !== null && a.days_left < 0;
    const bo = b.days_left !== null && b.days_left < 0;
    if (ao !== bo) return ao ? -1 : 1;
    if (ao && bo) return (a.days_left ?? 0) - (b.days_left ?? 0);
    return (a.blocked_at ?? '').localeCompare(b.blocked_at ?? '');
  });
  const overdueRoutines = (rtData ?? []) as OverdueRoutine[];
  const blockedFor = (iso: string | null) => (iso ? daysBetween(localDate(iso, me.timezone), d.today) : null);

  let personTasks: TaskRow[] = [];
  let personRoutines: RoutineRow[] = [];
  if (member && selectedName) {
    const [{ data }, r] = await Promise.all([
      supabase.from('task_board').select('*').is('archived_at', null).eq('owner_id', member).limit(500),
      routinesFor(member),
    ]);
    personTasks = sortTasks((data ?? []) as TaskRow[]);
    personRoutines = r;
  }

  const taskFilters = { scope: 'all', owner: member, status, priority, from, to };
  const routineFilters = { owner: member, frequency };
  const hasFilters = Boolean(member || status || priority || from || to || frequency);
  const active = [
    selectedName,
    status,
    priority,
    from || to ? `due ${from ? fmtDate(from) : 'any time'} to ${to ? fmtDate(to) : 'any time'}` : null,
    frequency ? `${frequency} routines` : null,
  ].filter(Boolean);

  const rate = d.routines?.completion_rate ?? null;
  const util = d.capacity?.utilization ?? null;
  const personTasksHref = (p: Person, extra: Record<string, string> = {}) => qs('/tasks', { scope: 'all', owner: p.member_id, ...extra });
  const cell = (n: number, tone: string, href: string) => (
    <td className={`text-center tabular-nums ${n > 0 ? tone : 'text-slate-400'}`}>
      {n > 0 ? <Link href={href} className="hover:underline">{n}</Link> : n}
    </td>
  );
  const availability = (p: Person) =>
    p.on_leave ? (
      <span className="font-medium text-violet-800">On leave{p.leave_until ? ` until ${fmtDate(p.leave_until)}` : ''}</span>
    ) : (
      <span className="text-slate-700">Available</span>
    );
  const why = (t: Escalation) => {
    const late = t.days_left !== null && t.days_left < 0 ? -t.days_left : null;
    const blocked = t.status === 'Blocked' ? blockedFor(t.blocked_at) : null;
    return (
      <div className="space-y-0.5 break-words">
        {late !== null && <div className="font-semibold text-red-700">{plural(late, 'day')} overdue</div>}
        {t.status === 'Blocked' && (
          <div>
            <span className="font-semibold text-orange-700">Blocked{blocked !== null ? (blocked > 0 ? ` ${plural(blocked, 'day')}` : ' today') : ''}</span>
            {t.blocker_reason && <span className="text-slate-600">: {t.blocker_reason}</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={<>Manager view. Updates automatically from the Task Board, Pending Backlog and Routine Tasks. Today is {fmtDate(d.today)}.</>}
      />

      <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-7" role="search" aria-label="Dashboard filters">
        <div>
          <label className="label" htmlFor="f-member">Employee</label>
          <select id="f-member" name="member" defaultValue={member ?? ''} className="input">
            <option value="">Everyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={status ?? ''} className="input">
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-priority">Priority</label>
          <select id="f-priority" name="priority" defaultValue={priority ?? ''} className="input">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-from">Due from</label>
          <input id="f-from" name="from" type="date" defaultValue={from ?? ''} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="f-to">Due to</label>
          <input id="f-to" name="to" type="date" defaultValue={to ?? ''} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="f-frequency">Routine frequency</label>
          <select id="f-frequency" name="frequency" defaultValue={frequency ?? ''} className="input">
            <option value="">Any frequency</option>
            {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex items-end justify-end gap-2 sm:col-span-3 lg:col-span-1">
          {hasFilters && <Link href="/manager" className="btn-ghost">Clear</Link>}
          <button className="btn-secondary" type="submit">Apply</button>
        </div>
      </form>
      {badRange && <Notice tone="warn">&quot;Due from&quot; was after &quot;Due to&quot;, so the date range was not applied.</Notice>}
      {member && !selectedName && <Notice tone="warn">That employee is not an active team member, so the figures below are empty.</Notice>}
      {active.length > 0 && (
        <p className="mb-3 text-sm text-slate-600">
          Showing: <strong>{active.join(' · ')}</strong> · <Link href="/manager" className="underline">clear</Link>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Open tasks" value={d.open} href={qs('/tasks', taskFilters)} />
        <StatCard label="Overdue" value={d.overdue} tone={d.overdue ? 'red' : 'default'} href={qs('/tasks', { ...taskFilters, due: 'overdue' })} />
        <StatCard label="Blocked" value={d.blocked} tone={d.blocked ? 'orange' : 'default'} href={qs('/tasks', { ...taskFilters, status: 'Blocked' })} />
        <StatCard label="Due today" value={d.due_today} tone={d.due_today ? 'amber' : 'default'} href={qs('/tasks', { ...taskFilters, due: 'today' })} />
        <StatCard label="Due in next 7 days" value={d.due_next_7} tone={d.due_next_7 ? 'amber' : 'default'} href={qs('/tasks', { ...taskFilters, due: 'week' })} />
        <StatCard label="Stale" value={d.stale} tone={d.stale ? 'amber' : 'default'} hint="No update in 3+ days" href={qs('/tasks', { ...taskFilters, stale: '1' })} />
        <StatCard label="Critical open" value={d.critical_open} href={qs('/tasks', { ...taskFilters, priority: 'Critical' })} />
        <StatCard label="Unassigned backlog" value={d.unassigned_backlog} href="/backlog" />
        <StatCard
          label="Routine completion rate"
          value={rate === null ? '—' : `${rate}%`}
          hint={`${d.routines?.ok ?? 0} of ${d.routines?.active ?? 0} routines up to date`}
          href={qs('/routines', routineFilters)}
        />
        <StatCard
          label="Capacity utilization"
          value={util === null ? '—' : `${util}%`}
          tone={util !== null && util > 100 ? 'red' : 'default'}
          hint={`${d.capacity?.open ?? 0} / ${d.capacity?.max ?? 0} open tasks`}
          href={member ? `/team?person=${member}` : '/team'}
        />
        <StatCard label="Done in last 7 days" value={d.done_last_7} tone={d.done_last_7 ? 'green' : 'default'} href={qs('/tasks', { ...taskFilters, status: 'Done', completed: '7', sort: 'updated' })} />
        <StatCard
          label="Overdue routines"
          value={d.routine_overdue}
          tone={d.routine_overdue ? 'red' : 'default'}
          hint={`${d.routine_not_logged} not logged yet`}
          href={qs('/routines', { ...routineFilters, status: 'Overdue' })}
        />
      </div>
      {d.open_data_issues > 0 && (
        <div className="mt-4">
          <Notice tone="warn">
            {d.open_data_issues} record(s) from the spreadsheet import need review. <Link href="/data-review" className="font-medium underline">Open Data Review</Link>
          </Notice>
        </div>
      )}

      <SectionTitle action={<Link href="/team" className="text-sm text-navy-700 hover:underline">Team →</Link>}>Per employee</SectionTitle>
      {people.length === 0 ? (
        <EmptyState title="No active team members match" action={hasFilters ? <Link href="/manager" className="btn-secondary">Clear filters</Link> : undefined} />
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="space-y-2 md:hidden">
            {people.map((p) => (
              <li key={p.member_id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={personTasksHref(p)} className="font-medium text-navy-800 hover:underline">{p.name}</Link>
                    <div className="text-xs text-slate-500">{p.role_title}</div>
                  </div>
                  <CapacityBadge status={p.capacity_status} />
                </div>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    ['Open', `${p.open}/${p.max_open_tasks}`, ''],
                    ['Overdue', p.overdue, p.overdue ? 'text-red-700' : ''],
                    ['Blocked', p.blocked, p.blocked ? 'text-orange-700' : ''],
                    ['Due today', p.due_today, p.due_today ? 'text-amber-700' : ''],
                    ['Next 7 days', p.due_next_7, p.due_next_7 ? 'text-amber-700' : ''],
                    ['Stale', p.stale, p.stale ? 'text-amber-700' : ''],
                    ['Routines overdue', p.routine_overdue, p.routine_overdue ? 'text-red-700' : ''],
                    ['Not logged', p.routine_not_logged, ''],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)}>
                      <dt className="text-[11px] text-slate-500">{label}</dt>
                      <dd className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2 text-xs">{availability(p)}</div>
              </li>
            ))}
          </ul>

          {/* Tablet / desktop: sheet */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-center">Open / Max</th>
                  <th className="text-center">Overdue</th>
                  <th className="text-center">Blocked</th>
                  <th className="text-center">Due today</th>
                  <th className="text-center">Next 7 days</th>
                  <th className="text-center">Stale</th>
                  <th className="text-center">Overdue routines</th>
                  <th className="text-center">Routines not logged</th>
                  <th>Capacity</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.member_id} className={p.member_id === member ? 'bg-navy-100' : ''}>
                    <td className="whitespace-nowrap">
                      <Link href={personTasksHref(p)} className="font-medium text-navy-800 hover:underline">{p.name}</Link>
                      <span className="ml-2 text-xs text-slate-500">{p.role_title}</span>
                    </td>
                    <td className="text-center tabular-nums">
                      {p.open}
                      <span className="text-xs text-slate-400">/{p.max_open_tasks}</span>
                    </td>
                    {cell(p.overdue, 'font-semibold text-red-700', personTasksHref(p, { due: 'overdue' }))}
                    {cell(p.blocked, 'font-semibold text-orange-700', personTasksHref(p, { status: 'Blocked' }))}
                    {cell(p.due_today, 'font-semibold text-amber-700', personTasksHref(p, { due: 'today' }))}
                    {cell(p.due_next_7, 'font-semibold text-amber-700', personTasksHref(p, { due: 'week' }))}
                    {cell(p.stale, 'font-semibold text-amber-700', personTasksHref(p, { stale: '1' }))}
                    {cell(p.routine_overdue, 'font-semibold text-red-700', qs('/routines', { owner: p.member_id, status: 'Overdue' }))}
                    {cell(p.routine_not_logged, 'font-semibold text-slate-700', qs('/routines', { owner: p.member_id, status: 'Not Logged' }))}
                    <td><CapacityBadge status={p.capacity_status} /></td>
                    <td className="whitespace-nowrap">{availability(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Per-employee counts cover all of each person&apos;s open tasks and active routines. Select a name to open their tasks, or choose an employee in the filters to see their work below.
      </p>

      <SectionTitle>Escalations: overdue and blocked tasks{selectedName ? ` (${selectedName})` : ''}</SectionTitle>
      {escError && <Notice tone="error">Could not load overdue and blocked tasks: {friendlyError(escError.message)}</Notice>}
      {!escError && escalations.length === 0 ? (
        <EmptyState title="Nothing overdue or blocked" body="Open tasks that pass their due date or become Blocked will appear here." />
      ) : (
        escalations.length > 0 && (
          <>
            <ul className="space-y-2 md:hidden">
              {escalations.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className={`card block border-l-4 p-3 ${t.days_left !== null && t.days_left < 0 ? 'border-l-red-500' : 'border-l-orange-500'}`}>
                    <div className="text-xs text-slate-500">{t.task_code} · Assigned to {t.owner_name ?? '—'}</div>
                    <div className="font-medium text-navy-900">
                      {t.title} <FlaggedStar on={t.is_flagged} />
                    </div>
                    <div className="mt-1.5 text-xs">{why(t)}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                      <span>Due {fmtDate(t.due_date)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="card hidden overflow-x-auto md:block">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Task ID</th>
                    <th>Task</th>
                    <th>Assigned to</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Why it needs attention</th>
                  </tr>
                </thead>
                <tbody>
                  {escalations.map((t) => (
                    <tr key={t.id} className={t.days_left !== null && t.days_left < 0 ? 'bg-red-50/70' : 'bg-orange-50/80'}>
                      <td className="whitespace-nowrap font-mono text-xs text-slate-500">
                        <Link href={`/tasks/${t.id}`} className="hover:underline">{t.task_code}</Link>
                      </td>
                      <td className="min-w-48 font-medium text-navy-900">
                        <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link> <FlaggedStar on={t.is_flagged} />
                      </td>
                      <td className="whitespace-nowrap">{t.owner_name ?? '—'}</td>
                      <td><PriorityBadge priority={t.priority} /></td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(t.due_date)}</td>
                      <td className="min-w-64 max-w-md">{why(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      <SectionTitle>Escalations: overdue routines{selectedName ? ` (${selectedName})` : ''}</SectionTitle>
      {rtError && <Notice tone="error">Could not load overdue routines: {friendlyError(rtError.message)}</Notice>}
      {!rtError && overdueRoutines.length === 0 ? (
        <EmptyState title="No overdue routines" />
      ) : (
        overdueRoutines.length > 0 && (
          <>
            <ul className="space-y-2 md:hidden">
              {overdueRoutines.map((r) => (
                <li key={r.id}>
                  <Link href={`/routines/${r.id}`} className="card block border-l-4 border-l-red-500 p-3">
                    <div className="text-xs text-slate-500">{r.routine_code} · Assigned to {r.owner_name ?? '—'}</div>
                    <div className="font-medium text-navy-900">{r.title}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      {r.frequency} · Next due {fmtDate(r.next_due)}
                      {r.next_due && <span className="font-semibold text-red-700"> · {plural(daysBetween(r.next_due, d.today), 'day')} overdue</span>}
                      {r.owner_on_leave && <> · {r.covered_by_name ? `Covered by ${r.covered_by_name}` : 'On leave, no backup'}</>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="card hidden overflow-x-auto md:block">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Routine ID</th>
                    <th>Routine Task</th>
                    <th>Assigned to</th>
                    <th>Frequency</th>
                    <th>Next Due</th>
                    <th>Overdue by</th>
                    <th>Cover</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRoutines.map((r) => (
                    <tr key={r.id} className="bg-red-50/70">
                      <td className="whitespace-nowrap font-mono text-xs text-slate-500">
                        <Link href={`/routines/${r.id}`} className="hover:underline">{r.routine_code}</Link>
                      </td>
                      <td className="min-w-56 font-medium text-navy-900">
                        <Link href={`/routines/${r.id}`} className="hover:underline">{r.title}</Link>
                      </td>
                      <td className="whitespace-nowrap">{r.owner_name ?? '—'}</td>
                      <td>{r.frequency}</td>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(r.next_due)}</td>
                      <td className="whitespace-nowrap font-semibold text-red-700">{r.next_due ? plural(daysBetween(r.next_due, d.today), 'day') : '—'}</td>
                      <td className="whitespace-nowrap text-slate-600">{r.owner_on_leave ? (r.covered_by_name ? `Covered by ${r.covered_by_name}` : 'On leave, no backup') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {member && selectedName && (
        <section id="person" className="mt-2">
          <SectionTitle action={<Link href={qs('/manager', { status, priority, from, to, frequency })} className="text-sm text-navy-700 hover:underline" scroll={false}>Close</Link>}>
            {selectedName}: open and recent tasks
          </SectionTitle>
          <TaskTable rows={personTasks} empty={{ title: `${selectedName} has no tasks` }} />
          <SectionTitle>{selectedName}: routine tasks</SectionTitle>
          <RoutineTable rows={personRoutines} canComplete={() => true} today={d.today} showOwner={false} />
        </section>
      )}
    </>
  );
}
