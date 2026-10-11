import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers, sortTasks } from '@/lib/data';
import { FLAGS, PRIORITIES, STATUSES, type TaskRow } from '@/lib/types';
import { isIsoDate } from '@/lib/format';
import { Notice, PageHeader } from '@/components/ui';
import { TaskTable } from '@/components/task-table';

export const metadata = { title: 'Task Board' };

type SP = { q?: string; owner?: string; delegated?: string; priority?: string; status?: string; flag?: string; due?: string; from?: string; to?: string; scope?: string; sort?: string; done?: string; archived?: string; stale?: string; flagged?: string; completed?: string };

const UUID = /^[0-9a-f-]{36}$/;

export default async function TaskBoard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const members = await activeMembers();

  let q = supabase.from('task_board').select('*');
  q = sp.archived === '1' ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  const scope = sp.scope ?? 'all';
  if (scope === 'mine') q = q.eq('owner_id', me.memberId);
  if (scope === 'assigned') q = q.or(`created_by.eq.${me.memberId},assigned_by.eq.${me.memberId}`).neq('owner_id', me.memberId);
  if (sp.owner && UUID.test(sp.owner)) q = q.eq('owner_id', sp.owner);
  if (sp.delegated && UUID.test(sp.delegated)) q = q.eq('assigned_by', sp.delegated);
  if (sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority)) q = q.eq('priority', sp.priority);
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) q = q.eq('status', sp.status);
  else if (sp.done !== '1' && !sp.flag) q = q.neq('status', 'Done');
  if (sp.flag && (FLAGS as readonly string[]).includes(sp.flag)) q = q.eq('flag', sp.flag);
  if (sp.due === 'overdue') q = q.lt('days_left', 0);
  if (sp.due === 'today') q = q.eq('days_left', 0);
  if (sp.due === 'week') q = q.gte('days_left', 0).lte('days_left', 7);
  if (sp.due === 'none') q = q.is('due_date', null);
  const term = (sp.q ?? '').replace(/[%,()*\\"']/g, ' ').trim().slice(0, 80);
  if (isIsoDate(sp.from)) q = q.gte('due_date', sp.from);
  if (isIsoDate(sp.to)) q = q.lte('due_date', sp.to);
  if (sp.stale === '1') q = q.eq('is_stale', true);
  if (sp.flagged === '1') q = q.eq('is_flagged', true);
  // "Done in the last 7 days", matching the manager dashboard figure.
  if (sp.completed === '7') q = q.eq('status', 'Done').gte('completed_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
  const idMatch = term.match(/^(?:tsk[-\s]?)?0*(\d{1,6})$/i);
  if (idMatch) q = q.or(`task_no.eq.${Number(idMatch[1])},title.ilike.%${term}%`);
  else if (term) q = q.or(`title.ilike.%${term}%,details.ilike.%${term}%,progress_note.ilike.%${term}%,blocker_reason.ilike.%${term}%`);

  const { data, error } = await q.limit(1000);
  const rows = sortTasks((data ?? []) as TaskRow[], sp.sort);

  const hasFilters = Boolean(
    sp.q || sp.owner || sp.delegated || sp.priority || sp.status || sp.flag || sp.due || sp.from || sp.to || sp.done || sp.archived || sp.stale || sp.flagged || sp.completed || (sp.scope && sp.scope !== 'all'),
  );
  const tab = (key: string, label: string) => (
    <Link
      href={`/tasks${key === 'all' ? '' : `?scope=${key}`}`}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${scope === key ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Task Board"
        subtitle={me.isManager ? 'All work across the team.' : 'Tasks assigned to you, tasks you delegated, and tasks shared with you.'}
        actions={<Link href="/tasks/new" className="btn-primary">New task</Link>}
      />
      <div className="mb-3 flex flex-wrap gap-1">
        {tab('all', me.isManager ? 'Everyone' : 'All I can see')}
        {tab('mine', 'Mine')}
        {tab('assigned', 'Delegated by me')}
      </div>
      <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-8" role="search">
        <input type="hidden" name="scope" value={scope} />
        <input name="q" defaultValue={sp.q} placeholder="Search title or ID (TSK-012)…" className="input col-span-2 lg:col-span-2" aria-label="Search" />
        <select name="owner" defaultValue={sp.owner ?? ''} className="input" aria-label="Assigned to">
          <option value="">Assigned to: anyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select name="delegated" defaultValue={sp.delegated ?? ''} className="input" aria-label="Delegated by">
          <option value="">Delegated by: anyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select name="priority" defaultValue={sp.priority ?? ''} className="input" aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="input" aria-label="Status">
          <option value="">Open statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="flag" defaultValue={sp.flag ?? ''} className="input" aria-label="Flag">
          <option value="">Any flag</option>
          {FLAGS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select name="due" defaultValue={sp.due ?? ''} className="input" aria-label="Due date">
          <option value="">Any due date</option>
          <option value="overdue">Past due</option>
          <option value="today">Due today</option>
          <option value="week">Due in next 7 days</option>
          <option value="none">No due date</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <span className="shrink-0 text-xs text-slate-500">Due from</span>
          <input type="date" name="from" defaultValue={isIsoDate(sp.from) ? sp.from : ''} className="input" aria-label="Due from" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <span className="shrink-0 text-xs text-slate-500">to</span>
          <input type="date" name="to" defaultValue={isIsoDate(sp.to) ? sp.to : ''} className="input" aria-label="Due to" />
        </label>
        <select name="sort" defaultValue={sp.sort ?? 'flag'} className="input" aria-label="Sort">
          <option value="flag">Sort: urgency</option>
          <option value="due">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="updated">Sort: last update</option>
          <option value="owner">Sort: assigned to</option>
          <option value="delegated">Sort: delegated by</option>
          <option value="created">Sort: newest</option>
          <option value="id">Sort: Task ID</option>
        </select>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-8">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="done" value="1" defaultChecked={sp.done === '1'} /> Include Done
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="flagged" value="1" defaultChecked={sp.flagged === '1'} /> Flagged <span className="text-amber-500" aria-hidden>★</span>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === '1'} /> Archived only
          </label>
          {sp.stale && <input type="hidden" name="stale" value="1" />}
          {sp.completed && <input type="hidden" name="completed" value={sp.completed} />}
          <div className="ml-auto flex gap-2">
            {hasFilters && <Link href="/tasks" className="btn-ghost">Clear</Link>}
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
      </form>
      {sp.flag && <p className="mb-2 text-sm text-slate-600">Showing flag: <strong>{sp.flag}</strong> · <Link href="/tasks" className="underline">clear</Link></p>}
      {error && <Notice tone="error">Could not load tasks: {error.message}</Notice>}
      <p className="mb-2 text-xs text-slate-500">
        {rows.length} task{rows.length === 1 ? '' : 's'} · Red = overdue · Orange = blocked · Amber = due within 3 days or no update for 3+ days · Yellow = due within 7 days · Green = done · ★ = flagged as important
      </p>
      <TaskTable
        rows={rows}
        me={{ memberId: me.memberId, isManager: me.isManager }}
        empty={
          hasFilters
            ? { title: 'No tasks match these filters', action: <Link href="/tasks" className="btn-secondary">Clear filters</Link> }
            : { title: 'No open tasks', body: 'Create a task and assign it to a teammate, or approve something from the Pending Backlog.', action: <Link href="/tasks/new" className="btn-primary">New task</Link> }
        }
      />
    </>
  );
}
