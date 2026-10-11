import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { db, login, memberId, provision, resetData } from './helpers';

// Features added by the "Complete Missing Features" spec: tasks, team calendar and capacity,
// routine backups, backlog workflow and dashboard filters.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};

async function day(offset: number): Promise<string> {
  const r = await db.query(`select (private.today() + $1::int)::text as d`, [offset]);
  return r.rows[0].d;
}

async function createTask(c: SupabaseClient, owner: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await c.from('tasks').insert({ title: `Task for ${owner}`, owner_id: ids[owner], ...extra }).select().single();
  if (error) throw error;
  return data;
}

async function addLeave(c: SupabaseClient, who: string, from: number, to: number, extra: Record<string, unknown> = {}) {
  return c.from('leaves').insert({ member_id: ids[who], start_date: await day(from), end_date: await day(to), ...extra }).select().single();
}

beforeAll(async () => {
  await resetData();
  for (const n of TEAM) await provision(n);
  for (const n of TEAM) ids[n] = await memberId(n);
}, 60_000);

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await db.end();
});

describe('tasks: ids, priorities, statuses, blockers, flags and history', () => {
  it('uses TSK-### ids, Critical priority and the To Do / Active / Blocked / Done statuses', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Shruti', { priority: 'Critical' });
    expect(t.status).toBe('To Do');
    const { data } = await k.from('task_board').select('task_code, priority, status').eq('id', t.id).single();
    expect(data!.task_code).toMatch(/^TSK-\d{3}$/);
    expect(data!.priority).toBe('Critical');
    const s = await login('Shruti');
    expect((await s.from('tasks').update({ status: 'Active', percent_complete: 20 }).eq('id', t.id)).error).toBeNull();
    const { error } = await s.from('tasks').update({ status: 'In Progress' as never }).eq('id', t.id);
    expect(error).not.toBeNull();
  });

  it('Blocked needs a blocker reason, records when it was blocked, and clears when work resumes', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Dev');
    const d = await login('Dev');
    const { error } = await d.from('tasks').update({ status: 'Blocked' }).eq('id', t.id);
    expect(error?.message).toMatch(/blocker reason/);
    const { data: blocked, error: e2 } = await d.from('tasks')
      .update({ status: 'Blocked', blocker_reason: 'Waiting for boxes' }).eq('id', t.id).select().single();
    expect(e2).toBeNull();
    expect(blocked!.blocked_at).not.toBeNull();
    const firstBlockedAt = blocked!.blocked_at;
    const { data: updated } = await d.from('tasks').update({ blocker_reason: 'Boxes arrive Friday' }).eq('id', t.id).select().single();
    expect(updated!.blocked_at).toBe(firstBlockedAt);
    // a manager sees the blocker on the board
    const { data: board } = await k.from('task_board').select('blocker_reason, flag').eq('id', t.id).single();
    expect(board).toMatchObject({ blocker_reason: 'Boxes arrive Friday', flag: 'Blocked' });
    const { data: resumed } = await d.from('tasks').update({ status: 'Active' }).eq('id', t.id).select().single();
    expect(resumed).toMatchObject({ status: 'Active', blocker_reason: '', blocked_at: null });
    // cannot be blocked with an empty reason even straight through SQL
    await expect(db.query(`update public.tasks set status = 'Blocked', blocker_reason = ' ' where id = $1`, [t.id])).rejects.toThrow();
  });

  it('100% marks a task Done, Done means 100%, and reopening drops it to 90%', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Zinia');
    const { data: done } = await k.from('tasks').update({ percent_complete: 100 }).eq('id', t.id).select().single();
    expect(done).toMatchObject({ status: 'Done', percent_complete: 100 });
    expect(done!.completed_at).not.toBeNull();
    const { data: reopened } = await k.from('tasks').update({ status: 'Active' }).eq('id', t.id).select().single();
    expect(reopened).toMatchObject({ status: 'Active', percent_complete: 90, completed_at: null });
  });

  it('the assignee can flag a task and set its blocker but cannot change who delegated it', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Zinia');
    const z = await login('Zinia');
    expect((await z.from('tasks').update({ is_flagged: true }).eq('id', t.id)).error).toBeNull();
    const { error } = await z.from('tasks').update({ assigned_by: ids.Zinia }).eq('id', t.id);
    expect(error?.message).toMatch(/only update status/);
    expect((await k.from('tasks').update({ assigned_by: ids.Shruti }).eq('id', t.id)).error).toBeNull();
  });

  it('history records status, progress, owner, due-date, blocker, flag and delegator changes', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Dev', { due_date: await day(5) });
    await k.from('tasks').update({ due_date: await day(9) }).eq('id', t.id);
    await k.from('tasks').update({ status: 'Blocked', blocker_reason: 'Printer jammed', progress_note: 'Half done', percent_complete: 50 }).eq('id', t.id);
    await k.from('tasks').update({ is_flagged: true, assigned_by: ids.Shruti }).eq('id', t.id);
    await k.from('tasks').update({ owner_id: ids.Sanket, status: 'Active' }).eq('id', t.id);
    const { data } = await k.from('task_activity').select('kind, summary, actor_name').eq('task_id', t.id).order('at');
    const kinds = data!.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['assignment', 'progress', 'due_date', 'blocker', 'flagged', 'delegated_by']));
    const summaries = data!.map((r) => r.summary).join('\n');
    expect(summaries).toMatch(/Due date .* → /);
    expect(summaries).toMatch(/Blocked: “Printer jammed”/);
    expect(summaries).toMatch(/Blocker cleared/);
    expect(summaries).toMatch(/Reassigned from Dev to Sanket/);
    expect(summaries).toMatch(/Delegated by Kartik → Shruti/);
    expect(summaries).toMatch(/Blocked · 50% · “Half done”/);
    // someone with no access to the task sees none of its history
    const z = await login('Zinia');
    expect((await z.from('task_activity').select('task_id').eq('task_id', t.id)).data).toHaveLength(0);
    expect((await z.from('task_changes').select('id').eq('task_id', t.id)).data).toHaveLength(0);
  });

  it('meaningful updates move Last Update; flagging alone does not', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Dev');
    await db.query(`alter table public.tasks disable trigger tasks_before;
      update public.tasks set last_update_at = now() - interval '4 days' where id = '${t.id}';
      alter table public.tasks enable trigger tasks_before;`);
    await k.from('tasks').update({ is_flagged: true }).eq('id', t.id);
    expect((await k.from('task_board').select('flag').eq('id', t.id).single()).data!.flag).toBe('Stale');
    await k.from('tasks').update({ progress_note: 'Started' }).eq('id', t.id);
    expect((await k.from('task_board').select('flag').eq('id', t.id).single()).data!.flag).toBe('On track');
  });
});

describe('team calendar, availability and capacity', () => {
  it('members add their own upcoming leave only; managers add anyone\'s; overlaps are refused', async () => {
    const z = await login('Zinia');
    expect((await addLeave(z, 'Zinia', 3, 4, { backup_member_id: ids.Sanket })).error).toBeNull();
    expect((await addLeave(z, 'Dev', 3, 4)).error).not.toBeNull();
    expect((await addLeave(z, 'Zinia', -3, -2)).error?.message).toMatch(/Past leave can only be recorded by a manager/);
    expect((await addLeave(z, 'Zinia', 4, 6)).error?.message).toMatch(/overlaps/);
    const k = await login('Kartik');
    expect((await addLeave(k, 'Dev', -3, -2, { leave_type: 'Sick Leave' })).error).toBeNull();
  });

  it('only managers manage company holidays; everyone sees them', async () => {
    const d = await login('Dev');
    const { error } = await d.from('holidays').insert({ holiday_date: await day(10), name: 'Founders Day' });
    expect(error).not.toBeNull();
    const k = await login('Kartik');
    expect((await k.from('holidays').insert({ holiday_date: await day(10), name: 'Founders Day' })).error).toBeNull();
    const { data } = await d.rpc('team_calendar', { p_from: await day(0), p_to: await day(30) });
    expect(data.find((r: { kind: string }) => r.kind === 'holiday').label).toBe('Founders Day');
  });

  it('the team calendar shows everyone who is away but hides the leave type from other members', async () => {
    const k = await login('Kartik');
    await addLeave(k, 'Dev', 1, 2, { leave_type: 'Sick Leave', note: 'Fever', backup_member_id: ids.Zinia });
    const s = await login('Shruti');
    const { data: other } = await s.rpc('team_calendar', { p_from: await day(0), p_to: await day(5) });
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ member_name: 'Dev', label: 'Leave', note: '', backup_name: 'Zinia' });
    const z = await login('Zinia');
    const { data: backup } = await z.rpc('team_calendar', { p_from: await day(0), p_to: await day(5) });
    expect(backup[0]).toMatchObject({ label: 'Sick Leave', note: 'Fever' });
    expect((await s.from('leaves').select('id')).data).toHaveLength(0);
  });

  it('capacity status is Available / At Capacity / Overloaded / On Leave, and completed tasks do not count', async () => {
    await db.query("update public.members set max_open_tasks = 2 where name in ('Sanket', 'Zinia', 'Shruti')");
    const k = await login('Kartik');
    await createTask(k, 'Sanket');
    await createTask(k, 'Sanket');
    await createTask(k, 'Zinia');
    await createTask(k, 'Zinia');
    await createTask(k, 'Zinia');
    await createTask(k, 'Shruti', { status: 'Done' });
    await addLeave(k, 'Dev', 0, 1);
    const { data } = await k.rpc('team_overview');
    const status = (n: string) => data.find((r: { name: string }) => r.name === n);
    expect(status('Sanket')).toMatchObject({ open_tasks: 2, capacity_status: 'At Capacity' });
    expect(status('Zinia')).toMatchObject({ open_tasks: 3, capacity_status: 'Overloaded' });
    expect(status('Shruti')).toMatchObject({ open_tasks: 0, capacity_status: 'Available' });
    expect(status('Dev')).toMatchObject({ on_leave: true, capacity_status: 'On Leave', leave_until: await day(1) });
    await db.query("update public.members set max_open_tasks = 10 where name in ('Sanket', 'Zinia', 'Shruti')");
  });
});

describe('routine backups', () => {
  async function routine(title: string) {
    const r = await db.query('select id, owner_id from public.routines where title = $1', [title]);
    return r.rows[0];
  }

  it('a backup covers a routine only while the owner is on leave, and the owner stays the owner', async () => {
    const r = await routine('Pack orders');
    const k = await login('Kartik');
    expect((await k.from('routines').update({ backup_member_id: ids.Zinia }).eq('id', r.id)).error).toBeNull();
    const z = await login('Zinia');
    // the designated backup can see the routine, but cannot tick it off while Dev is working
    const { data: seen } = await z.from('routine_board').select('owner_name, backup_name, covered_by_name').eq('id', r.id).single();
    expect(seen).toMatchObject({ owner_name: 'Dev', backup_name: 'Zinia', covered_by_name: null });
    expect((await z.rpc('complete_routine', { p_routine: r.id })).error?.message).toMatch(/Only the owner, the person covering/);

    await addLeave(k, 'Dev', 0, 2);
    const { data: covered } = await z.from('routine_board').select('owner_name, owner_on_leave, covered_by_name').eq('id', r.id).single();
    expect(covered).toMatchObject({ owner_name: 'Dev', owner_on_leave: true, covered_by_name: 'Zinia' });
    const res = (await z.rpc('complete_routine', { p_routine: r.id })).data;
    expect(res.ok).toBe(true);
    const { data: hist } = await k.from('routine_completions').select('completed_by, covering_for').eq('routine_id', r.id);
    expect(hist).toEqual([{ completed_by: ids.Zinia, covering_for: ids.Dev }]);
    const owner = await db.query('select owner_id from public.routines where id = $1', [r.id]);
    expect(owner.rows[0].owner_id).toBe(ids.Dev);
  });

  it('without a routine backup, the backup named on the leave covers', async () => {
    const r = await routine('Reply to customer queries');
    const k = await login('Kartik');
    await addLeave(k, 'Zinia', 0, 0, { backup_member_id: ids.Shruti });
    const s = await login('Shruti');
    const { data } = await s.from('routine_board').select('covered_by_name, status').eq('id', r.id).single();
    expect(data!.covered_by_name).toBe('Shruti');
    const sa = await login('Sanket');
    expect((await sa.from('routine_board').select('id').eq('id', r.id)).data).toHaveLength(0);
  });

  it('routine ids and statuses use the spec names', async () => {
    const k = await login('Kartik');
    const { data } = await k.from('routine_board').select('routine_code, status');
    expect(data!.every((r) => /^RTN-\d{3}$/.test(r.routine_code))).toBe(true);
    const statuses = new Set(data!.map((r) => r.status));
    for (const s of statuses) expect(['OK', 'Due Today', 'Overdue', 'Not Logged', 'Paused']).toContain(s);
  });
});

describe('backlog: leave-aware suggestions, approval and conversion', () => {
  async function submit(c: SupabaseClient, skills: string) {
    const { data, error } = await c.from('backlog_items')
      .insert({ title: 'Bulk order', skills_needed: skills, priority: 'High', due_date: await day(5) }).select('id').single();
    if (error) throw error;
    return (await c.from('backlog_board').select('*').eq('id', data.id).single()).data!;
  }

  it('someone on leave is not suggested, and the explanation says so', async () => {
    const k = await login('Kartik');
    await addLeave(k, 'Sanket', 0, 3);
    const row = await submit(k, 'dispatch, packing count');
    expect(row.suggested_owner_name).not.toBe('Sanket');
    expect(row.suggestion_reason).toMatch(/Sanket matches more skills but is on leave today/);
    expect(row.suggestion_reason).toMatch(/On leave today, not suggested: Sanket/);
    const sanket = (row.suggestion_candidates as Array<{ name: string; on_leave: boolean; eligible: boolean }>).find((c) => c.name === 'Sanket');
    expect(sanket).toMatchObject({ on_leave: true, eligible: false });
  });

  it('approving someone on leave needs an explicit override', async () => {
    const k = await login('Kartik');
    await addLeave(k, 'Sanket', 0, 3);
    const row = await submit(k, 'dispatch');
    const { error } = await k.rpc('approve_backlog_item', { p_item: row.id, p_owner: ids.Sanket });
    expect(error?.message).toMatch(/Sanket is on leave today/);
    const { data: taskId, error: e2 } = await k.rpc('approve_backlog_item', { p_item: row.id, p_owner: ids.Sanket, p_override_leave: true });
    expect(e2).toBeNull();
    expect(taskId).toBeTruthy();
    const { data: b } = await k.from('backlog_board').select('status, override_leave').eq('id', row.id).single();
    expect(b).toMatchObject({ status: 'Converted to Task', override_leave: true });
  });

  it('approve now, convert later: Approved creates no task until converted, then exactly one', async () => {
    const z = await login('Zinia');
    const row = await submit(z, 'dispatch');
    expect(row.status).toBe('Pending');
    const k = await login('Kartik');
    const { data: none } = await k.rpc('approve_backlog_item', { p_item: row.id, p_convert: false });
    expect(none).toBeNull();
    const { data: approved } = await k.from('backlog_board').select('status, final_owner_name, decided_by_name').eq('id', row.id).single();
    expect(approved).toMatchObject({ status: 'Approved', final_owner_name: 'Sanket', decided_by_name: 'Kartik' });
    expect((await db.query('select count(*)::int n from public.tasks where backlog_item_id = $1', [row.id])).rows[0].n).toBe(0);
    const [a, b] = await Promise.all([
      k.rpc('convert_backlog_item', { p_item: row.id }),
      k.rpc('convert_backlog_item', { p_item: row.id }),
    ]);
    expect(a.data).toBe(b.data);
    expect((await db.query('select count(*)::int n from public.tasks where backlog_item_id = $1', [row.id])).rows[0].n).toBe(1);
    const { data: task } = await k.from('task_board').select('status, owner_name, assigned_by_name, created_by_name, priority, due_date').eq('id', a.data).single();
    expect(task).toMatchObject({ status: 'To Do', owner_name: 'Sanket', assigned_by_name: 'Kartik', created_by_name: 'Zinia', priority: 'High' });
    // members cannot convert
    expect((await z.rpc('convert_backlog_item', { p_item: row.id })).error?.message).toMatch(/Only a manager/);
  });

  it('dismissed items cannot be approved; converted items cannot be dismissed', async () => {
    const k = await login('Kartik');
    const row = await submit(k, 'dispatch');
    await k.rpc('reject_backlog_item', { p_item: row.id, p_note: 'Duplicate' });
    expect((await k.from('backlog_board').select('status').eq('id', row.id).single()).data!.status).toBe('Dismissed');
    expect((await k.rpc('approve_backlog_item', { p_item: row.id })).error?.message).toMatch(/dismissed/);
    const row2 = await submit(k, 'dispatch');
    await k.rpc('approve_backlog_item', { p_item: row2.id });
    expect((await k.rpc('reject_backlog_item', { p_item: row2.id, p_note: '' })).error?.message).toMatch(/Already converted/);
  });
});

describe('manager dashboard filters and KPIs', () => {
  it('filters recalculate the KPIs from real rows', async () => {
    const k = await login('Kartik');
    await createTask(k, 'Sanket', { priority: 'Critical', due_date: await day(-1) });
    await createTask(k, 'Sanket', { priority: 'Low', due_date: await day(2) });
    await createTask(k, 'Zinia', { priority: 'Critical', status: 'Blocked', blocker_reason: 'Courier', due_date: await day(20) });
    const all = (await k.rpc('manager_dashboard')).data;
    expect(all).toMatchObject({ open: 3, overdue: 1, blocked: 1, due_next_7: 1, critical_open: 2 });
    const sanket = (await k.rpc('manager_dashboard', { p_member: ids.Sanket })).data;
    expect(sanket).toMatchObject({ open: 2, overdue: 1, blocked: 0 });
    expect(sanket.people).toHaveLength(1);
    const critical = (await k.rpc('manager_dashboard', { p_priority: 'Critical' })).data;
    expect(critical).toMatchObject({ open: 2, overdue: 1, blocked: 1 });
    const range = (await k.rpc('manager_dashboard', { p_from: await day(0), p_to: await day(7) })).data;
    expect(range).toMatchObject({ open: 1 });
    const blocked = (await k.rpc('manager_dashboard', { p_status: 'Blocked' })).data;
    expect(blocked).toMatchObject({ open: 1, blocked: 1 });
  });

  it('routine completion rate and capacity utilization come from the routine and task tables', async () => {
    const k = await login('Kartik');
    const before = (await k.rpc('manager_dashboard', { p_frequency: 'Weekly' })).data;
    const weekly = before.routines.active as number;
    expect(weekly).toBeGreaterThan(0);
    const ok = before.routines.ok as number;
    const r = await db.query("select id, owner_id from public.routines where frequency = 'Weekly' and is_active order by routine_no limit 1");
    await db.query(`insert into public.routine_completions (routine_id, cycle_due, completed_on, completed_by)
                    values ($1, private.today(), private.today(), $2) on conflict do nothing`, [r.rows[0].id, r.rows[0].owner_id]);
    const after = (await k.rpc('manager_dashboard', { p_frequency: 'Weekly' })).data;
    expect(after.routines.ok).toBe(ok + 1);
    expect(after.routines.completion_rate).toBe(Math.round((100 * (ok + 1)) / weekly));

    await createTask(k, 'Dev');
    await createTask(k, 'Dev');
    const cap = (await k.rpc('manager_dashboard')).data.capacity;
    const total = await db.query('select sum(max_open_tasks)::int as m from public.members where is_active');
    expect(cap).toMatchObject({ open: 2, max: total.rows[0].m, utilization: Math.round((100 * 2) / total.rows[0].m) });
  });

  it('employees cannot open the manager dashboard with filters either', async () => {
    const d = await login('Dev');
    expect((await d.rpc('manager_dashboard', { p_member: ids.Kartik })).error?.message).toMatch(/Managers only/);
  });
});
