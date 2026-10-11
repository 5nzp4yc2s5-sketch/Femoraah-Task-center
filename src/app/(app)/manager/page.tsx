import Link from 'next/link';
import { requireManager } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { routinesFor, sortTasks } from '@/lib/data';
import type { TaskRow } from '@/lib/types';
import { PageHeader, SectionTitle, StatCard, Notice } from '@/components/ui';
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
  due_next_7: number;
  stale: number;
  routine_overdue: number;
  max_open_tasks: number;
  has_capacity: boolean;
}

export default async function ManagerDashboard({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: d, error } = await supabase.rpc('manager_dashboard');
  if (error) return <Notice tone="error">Could not load the dashboard: {error.message}</Notice>;
  const people: Person[] = d.people;
  const selected = people.find((p) => p.member_id === sp.member);

  let personTasks: TaskRow[] = [];
  let personRoutines: Awaited<ReturnType<typeof routinesFor>> = [];
  if (selected) {
    const [{ data }, r] = await Promise.all([
      supabase.from('task_board').select('*').is('archived_at', null).eq('owner_id', selected.member_id).limit(500),
      routinesFor(selected.member_id),
    ]);
    personTasks = sortTasks((data ?? []) as TaskRow[]);
    personRoutines = r;
  }

  const cell = (n: number, tone: string) => <td className={`text-center tabular-nums ${n > 0 ? tone : 'text-slate-400'}`}>{n}</td>;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Manager view. Updates automatically from the Task Board, Pending Backlog and Routine Tasks." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Open tasks" value={d.open} href="/tasks?scope=all" />
        <StatCard label="Overdue" value={d.overdue} tone={d.overdue ? 'red' : 'default'} href="/tasks?scope=all&flag=Overdue" />
        <StatCard label="Blocked" value={d.blocked} tone={d.blocked ? 'grey' : 'default'} href="/tasks?scope=all&status=Blocked" />
        <StatCard label="Due in next 7 days" value={d.due_next_7} tone={d.due_next_7 ? 'amber' : 'default'} href="/tasks?scope=all&due=week" />
        <StatCard label="No update in 3+ days" value={d.stale} tone={d.stale ? 'amber' : 'default'} href="/tasks?scope=all&stale=1" />
        <StatCard label="Unassigned backlog" value={d.unassigned_backlog} href="/backlog" />
        <StatCard label="Routine tasks overdue" value={d.routine_overdue} tone={d.routine_overdue ? 'red' : 'default'} href="/routines?status=Overdue" hint={`${d.routine_not_logged} not logged yet`} />
      </div>
      {d.open_data_issues > 0 && (
        <div className="mt-4">
          <Notice tone="warn">
            {d.open_data_issues} record(s) from the spreadsheet import need review. <Link href="/data-review" className="font-medium underline">Open Data Review</Link>
          </Notice>
        </div>
      )}

      <SectionTitle>Per person</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="sheet">
          <thead>
            <tr>
              <th>Name</th>
              <th className="text-center">Open</th>
              <th className="text-center">Overdue</th>
              <th className="text-center">Blocked</th>
              <th className="text-center">Due next 7 days</th>
              <th className="text-center">No update 3+ days</th>
              <th className="text-center">Routine overdue</th>
              <th className="text-center">Has Capacity?</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.member_id} className={p.member_id === sp.member ? 'bg-navy-100' : ''}>
                <td className="whitespace-nowrap">
                  <Link href={`/manager?member=${p.member_id}`} className="font-medium text-navy-800 hover:underline" scroll={false}>
                    {p.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-500">{p.role_title}</span>
                </td>
                <td className="text-center tabular-nums">{p.open}<span className="text-xs text-slate-400">/{p.max_open_tasks}</span></td>
                {cell(p.overdue, 'font-semibold text-red-700')}
                {cell(p.blocked, 'font-semibold text-slate-700')}
                {cell(p.due_next_7, 'font-semibold text-amber-700')}
                {cell(p.stale, 'font-semibold text-amber-700')}
                {cell(p.routine_overdue, 'font-semibold text-red-700')}
                <td className="text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.has_capacity ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{p.has_capacity ? 'Yes' : 'No'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Select a name to inspect that person&apos;s tasks and routines.</p>

      {selected && (
        <section id="person" className="mt-2">
          <SectionTitle action={<Link href="/manager" className="text-sm text-navy-700 hover:underline" scroll={false}>Close</Link>}>
            {selected.name}: open and recent tasks
          </SectionTitle>
          <TaskTable rows={personTasks} empty={{ title: `${selected.name} has no tasks` }} />
          <SectionTitle>{selected.name}: routine tasks</SectionTitle>
          <RoutineTable rows={personRoutines} canComplete={() => true} today={d.today} showOwner={false} />
        </section>
      )}
    </>
  );
}
