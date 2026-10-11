import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { routinesFor, sortTasks } from '@/lib/data';
import type { TaskRow } from '@/lib/types';
import { PageHeader, SectionTitle, StatCard, Notice } from '@/components/ui';
import { TaskTable } from '@/components/task-table';
import { RoutineTable } from '@/components/routine-table';

export const metadata = { title: 'My Dashboard' };

export default async function MyDashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const [{ data: summary }, { data: tasks }, routines] = await Promise.all([
    supabase.rpc('my_summary'),
    supabase.from('task_board').select('*').is('archived_at', null).order('last_update_at', { ascending: false }).limit(500),
    routinesFor(me.memberId),
  ]);
  const all = (tasks ?? []) as TaskRow[];
  const mine = all.filter((t) => t.owner_id === me.memberId);
  const myOpen = sortTasks(mine.filter((t) => t.status !== 'Done'));
  const upcoming = sortTasks(myOpen.filter((t) => t.days_left !== null && t.days_left >= 0 && t.days_left <= 7), 'due');
  const delegated = sortTasks(all.filter((t) => t.owner_id !== me.memberId && (t.created_by === me.memberId || t.assigned_by === me.memberId)));
  const recent = all.filter((t) => t.owner_id === me.memberId || t.created_by === me.memberId || t.assigned_by === me.memberId).slice(0, 8);
  const today: string = summary?.today;
  const myRoutines = routines.filter((r) => r.owner_id === me.memberId);

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="My open tasks" value={summary?.open ?? 0} hint={`Capacity ${summary?.open ?? 0}/${summary?.max_open_tasks ?? '—'}`} href="/tasks?scope=mine" />
        <StatCard label="Overdue" value={summary?.overdue ?? 0} tone={summary?.overdue ? 'red' : 'default'} href="/tasks?scope=mine&flag=Overdue" />
        <StatCard label="Blocked" value={summary?.blocked ?? 0} tone={summary?.blocked ? 'grey' : 'default'} href="/tasks?scope=mine&status=Blocked" />
        <StatCard label="Due next 7 days" value={summary?.due_next_7 ?? 0} tone={summary?.due_next_7 ? 'amber' : 'default'} href="/tasks?scope=mine&due=week" />
        <StatCard label="No update 3+ days" value={summary?.stale ?? 0} tone={summary?.stale ? 'amber' : 'default'} href="/tasks?scope=mine&flag=Stale" />
        <StatCard label="Routine overdue" value={summary?.routine_overdue ?? 0} tone={summary?.routine_overdue ? 'red' : 'default'} href="/routines" />
      </div>

      <SectionTitle action={<Link href="/tasks?scope=mine" className="text-sm text-navy-700 hover:underline">All my tasks →</Link>}>My open tasks</SectionTitle>
      <TaskTable rows={myOpen} compact empty={{ title: 'Nothing open', body: 'Tasks assigned to you will appear here.' }} />

      {upcoming.length > 0 && (
        <>
          <SectionTitle>Upcoming deadlines (next 7 days)</SectionTitle>
          <TaskTable rows={upcoming} compact />
        </>
      )}

      <SectionTitle action={<Link href="/routines" className="text-sm text-navy-700 hover:underline">All routines →</Link>}>My routine tasks</SectionTitle>
      <RoutineTable rows={myRoutines} canComplete={() => true} today={today} showOwner={false} />

      <SectionTitle action={<Link href="/tasks?scope=assigned" className="text-sm text-navy-700 hover:underline">All →</Link>}>Tasks I assigned to others</SectionTitle>
      <TaskTable rows={delegated} compact empty={{ title: 'You have not assigned any open tasks', body: 'Tasks you create for teammates stay visible here so you can track them.' }} />

      <SectionTitle>Recently updated</SectionTitle>
      <TaskTable rows={recent} compact empty={{ title: 'No recent activity' }} />
    </>
  );
}
