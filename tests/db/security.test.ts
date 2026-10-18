import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { admin, anonClient, db, login, memberId, provision, resetData, signIn } from './helpers';

const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
let ids: Record<string, string> = {};

async function sqlDate(expr: string): Promise<string> {
  const r = await db.query(`select (${expr})::text as d`);
  return r.rows[0].d;
}

async function createTask(c: SupabaseClient, owner: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await c.from('tasks').insert({ title: `Task for ${owner}`, owner_id: ids[owner], ...extra }).select().single();
  if (error) throw error;
  return data;
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

describe('authentication gates', () => {
  it('anon (public key only) reads nothing and cannot call RPCs', async () => {
    const a = anonClient();
    const { data: members } = await a.from('members').select('*');
    expect(members ?? []).toHaveLength(0);
    const { error } = await a.from('tasks').select('*');
    expect(error).not.toBeNull();
    const { error: rpcErr } = await a.rpc('manager_dashboard');
    expect(rpcErr).not.toBeNull();
  });

  it('password without PIN sees nothing (PIN enforced in the database)', async () => {
    const k = await signIn('Kartik');
    const { data: status } = await k.rpc('session_status');
    expect(status.verified).toBe(false);
    const { data } = await k.from('members').select('*');
    expect(data ?? []).toHaveLength(0);
    const { error } = await k.rpc('manager_dashboard');
    expect(error?.message).toMatch(/Managers only/);
  });

  it('wrong PINs lock the account until an admin resets the PIN, even with the right PIN afterwards', async () => {
    const s = await signIn('Shruti');
    for (let i = 0; i < 4; i++) {
      const { data } = await s.rpc('verify_pin', { p_pin: '999' });
      expect(data.error).toBe('wrong_pin');
    }
    const { data: fifth } = await s.rpc('verify_pin', { p_pin: '999' });
    expect(fifth.error).toBe('locked');
    const { data: right } = await s.rpc('verify_pin', { p_pin: '222' });
    expect(right.ok).toBe(false);
    expect(right.error).toBe('locked');
    const { data: rows } = await s.from('tasks').select('*');
    expect(rows ?? []).toHaveLength(0);

    const k = await login('Kartik');
    expect((await k.rpc('admin_pin_locked', { p_member: ids.Shruti })).data).toBe(true);
    await db.query(`update public.member_pins set locked_until = now() + interval '1 year' where member_id = $1`, [ids.Shruti]);
    expect((await s.rpc('verify_pin', { p_pin: '222' })).data.error).toBe('locked');
    expect((await k.rpc('admin_set_pin', { p_member: ids.Shruti, p_pin: '222' })).error).toBeNull();
    expect((await k.rpc('admin_pin_locked', { p_member: ids.Shruti })).data).toBe(false);
    expect((await s.rpc('verify_pin', { p_pin: '222' })).data.ok).toBe(true);
  });

  it('PIN-only sign-in check: the right PIN returns the login email; wrong PIN or unknown user does not', async () => {
    const { data: ok } = await admin.rpc('service_pin_login', { p_identifier: 'Zinia', p_pin: '555' });
    expect(ok).toEqual({ ok: true, email: 'zinia@test.opspulse.local' });
    const { data: byEmail } = await admin.rpc('service_pin_login', { p_identifier: 'zinia@test.opspulse.local', p_pin: '555' });
    expect(byEmail.ok).toBe(true);
    const { data: wrong } = await admin.rpc('service_pin_login', { p_identifier: 'zinia', p_pin: '554' });
    expect(wrong).toEqual({ ok: false, error: 'invalid' });
    const { data: nobody } = await admin.rpc('service_pin_login', { p_identifier: 'nobody', p_pin: '555' });
    expect(nobody).toEqual({ ok: false, error: 'invalid' });
    const { data: junk } = await admin.rpc('service_pin_login', { p_identifier: 'zinia', p_pin: "' or 1=1 --" });
    expect(junk.ok).toBe(false);
  });

  it('five wrong PINs at sign-in lock the account until an admin resets it', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await admin.rpc('service_pin_login', { p_identifier: 'dev', p_pin: '000' })).data.error).toBe('invalid');
    }
    expect((await admin.rpc('service_pin_login', { p_identifier: 'dev', p_pin: '000' })).data.error).toBe('locked');
    expect((await admin.rpc('service_pin_login', { p_identifier: 'dev', p_pin: '444' })).data.error).toBe('locked');
    const k = await login('Kartik');
    await k.rpc('admin_set_pin', { p_member: ids.Dev, p_pin: '444' });
    expect((await admin.rpc('service_pin_login', { p_identifier: 'dev', p_pin: '444' })).data.ok).toBe(true);
  });

  it('a successful PIN check resets the wrong-PIN count', async () => {
    for (let i = 0; i < 4; i++) await admin.rpc('service_pin_login', { p_identifier: 'sanket', p_pin: '000' });
    expect((await admin.rpc('service_pin_login', { p_identifier: 'sanket', p_pin: '333' })).data.ok).toBe(true);
    expect((await admin.rpc('service_pin_login', { p_identifier: 'sanket', p_pin: '000' })).data.error).toBe('invalid');
  });

  it('deactivated members cannot sign in with their PIN', async () => {
    await db.query('update public.members set is_active = false where id = $1', [ids.Zinia]);
    expect((await admin.rpc('service_pin_login', { p_identifier: 'zinia', p_pin: '555' })).data.error).toBe('invalid');
  });

  it('the server-minted session (magic-link token, no password) is a normal session that still needs the PIN', async () => {
    const { data: check } = await admin.rpc('service_pin_login', { p_identifier: 'zinia', p_pin: '555' });
    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: check.email });
    expect(error).toBeNull();
    const c = anonClient();
    const { error: otpErr } = await c.auth.verifyOtp({ type: 'email', token_hash: link.properties!.hashed_token });
    expect(otpErr).toBeNull();
    expect((await c.from('members').select('id')).data ?? []).toHaveLength(0);
    expect((await c.rpc('verify_pin', { p_pin: '555' })).data.ok).toBe(true);
    expect((await c.from('members').select('id')).data!.length).toBeGreaterThan(0);
    // The one-time token cannot be replayed.
    const replay = anonClient();
    expect((await replay.auth.verifyOtp({ type: 'email', token_hash: link.properties!.hashed_token })).error).not.toBeNull();
  });

  it('PIN verification is bound to the session: a second password login must verify again', async () => {
    await login('Dev');
    const second = await signIn('Dev');
    const { data } = await second.rpc('session_status');
    expect(data.verified).toBe(false);
  });

  it('logout (end_session) removes PIN verification for that session', async () => {
    const z = await login('Zinia');
    expect((await z.from('members').select('id')).data!.length).toBeGreaterThan(0);
    await z.rpc('end_session');
    expect((await z.from('members').select('id')).data ?? []).toHaveLength(0);
  });

  it('PIN hashes are never readable and PINs are not stored in plaintext', async () => {
    const k = await login('Kartik');
    const { error } = await k.from('member_pins').select('*');
    expect(error).not.toBeNull();
    const r = await db.query('select pin_hash from public.member_pins limit 1');
    expect(r.rows[0].pin_hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('password-step lockout gate trips after 5 failures per identifier', async () => {
    for (let i = 0; i < 5; i++) await admin.rpc('service_record_login', { p_identifier: 'dev', p_ip: '1.2.3.4', p_success: false });
    const { data } = await admin.rpc('service_login_gate', { p_identifier: 'dev', p_ip: '5.6.7.8' });
    expect(data.allowed).toBe(false);
    const { data: other } = await admin.rpc('service_login_gate', { p_identifier: 'zinia', p_ip: '5.6.7.8' });
    expect(other.allowed).toBe(true);
  });

  it('service-only functions cannot be called by signed-in users', async () => {
    const d = await login('Dev');
    const { error } = await d.rpc('service_bootstrap_admin', { p_member: ids.Dev, p_user: ids.Dev, p_username: 'dev', p_pin: '000' });
    expect(error).not.toBeNull();
    const { error: e2 } = await d.rpc('service_resolve_login', { p_identifier: 'kartik' });
    expect(e2).not.toBeNull();
    const { error: e3 } = await d.rpc('service_pin_login', { p_identifier: 'kartik', p_pin: '111' });
    expect(e3).not.toBeNull();
    const { error: e4 } = await anonClient().rpc('service_pin_login', { p_identifier: 'kartik', p_pin: '111' });
    expect(e4).not.toBeNull();
    const { error: e5 } = await d.rpc('admin_pin_locked', { p_member: ids.Kartik });
    expect(e5).not.toBeNull();
  });
});

describe('task visibility and permissions', () => {
  it('owner sees own tasks; another member cannot read them, even by id', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Shruti');
    const s = await login('Shruti');
    const z = await login('Zinia');
    expect((await s.from('tasks').select('id').eq('id', t.id)).data).toHaveLength(1);
    expect((await z.from('tasks').select('id').eq('id', t.id)).data).toHaveLength(0);
    expect((await z.from('task_board').select('id').eq('id', t.id)).data).toHaveLength(0);
    expect((await z.from('task_updates').select('id').eq('task_id', t.id)).data).toHaveLength(0);
    expect((await z.from('task_assignments').select('id').eq('task_id', t.id)).data).toHaveLength(0);
  });

  it('creator tracks the task they assigned but not the assignee\'s other tasks', async () => {
    const s = await login('Shruti');
    const k = await login('Kartik');
    const assigned = await createTask(s, 'Zinia', { title: 'Shruti -> Zinia' });
    const privateOne = await createTask(k, 'Zinia', { title: 'Kartik -> Zinia' });
    const { data } = await s.from('task_board').select('id, title, created_by_name, assigned_by_name');
    const visible = (data ?? []).map((r) => r.id);
    expect(visible).toContain(assigned.id);
    expect(visible).not.toContain(privateOne.id);
    expect(data!.find((r) => r.id === assigned.id)!.created_by_name).toBe('Shruti');
  });

  it('created_by is always the signed-in member; Delegated By defaults to them and must be an active member', async () => {
    const d = await login('Dev');
    const { data, error } = await d.from('tasks')
      .insert({ title: 'spoof', owner_id: ids.Dev, created_by: ids.Kartik } as never).select();
    // column-level grants reject the spoofed column outright
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    const ok = await createTask(d, 'Dev');
    expect(ok.created_by).toBe(ids.Dev);
    expect(ok.assigned_by).toBe(ids.Dev);
    const named = await createTask(d, 'Dev', { assigned_by: ids.Kartik });
    expect(named).toMatchObject({ created_by: ids.Dev, assigned_by: ids.Kartik });
    await db.query('update public.members set is_active = false where id = $1', [ids.Zinia]);
    const { error: e2 } = await d.from('tasks').insert({ title: 'x', owner_id: ids.Dev, assigned_by: ids.Zinia });
    expect(e2?.message).toMatch(/Delegated by must be an active team member/);
  });

  it('owner can update progress but not reassign, retitle or move the due date', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Dev', { due_date: await sqlDate('private.today() + 5') });
    const d = await login('Dev');
    const { error: okErr } = await d.from('tasks').update({ status: 'Active', percent_complete: 40, progress_note: 'Half packed' }).eq('id', t.id);
    expect(okErr).toBeNull();
    const { error: e1 } = await d.from('tasks').update({ owner_id: ids.Zinia }).eq('id', t.id);
    expect(e1?.message).toMatch(/only update status/);
    const { error: e2 } = await d.from('tasks').update({ due_date: await sqlDate('private.today() + 30') }).eq('id', t.id);
    expect(e2?.message).toMatch(/only update status/);
    const { data: updates } = await d.from('task_updates').select('*').eq('task_id', t.id).order('created_at');
    expect(updates!.at(-1)!.note).toBe('Half packed');
  });

  it('a stranger cannot update or archive a task by guessing its id', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Shruti');
    const z = await login('Zinia');
    const { data } = await z.from('tasks').update({ status: 'Done' }).eq('id', t.id).select();
    expect(data ?? []).toHaveLength(0);
    const r = await db.query('select status from public.tasks where id = $1', [t.id]);
    expect(r.rows[0].status).toBe('To Do');
    const { error } = await z.from('tasks').delete().eq('id', t.id);
    expect(error).not.toBeNull();
  });

  it('percent complete is constrained to 0..100 and Done forces 100', async () => {
    const k = await login('Kartik');
    const { error } = await k.from('tasks').insert({ title: 'bad', owner_id: ids.Kartik, percent_complete: 10000 });
    expect(error).not.toBeNull();
    const t = await createTask(k, 'Kartik');
    const { data } = await k.from('tasks').update({ status: 'Done' }).eq('id', t.id).select().single();
    expect(data!.percent_complete).toBe(100);
    expect(data!.completed_at).not.toBeNull();
  });

  it('reassignment by creator is recorded in assignment history', async () => {
    const s = await login('Shruti');
    const t = await createTask(s, 'Zinia');
    await s.from('tasks').update({ owner_id: ids.Dev }).eq('id', t.id);
    const { data } = await s.from('task_assignments').select('from_owner_id, to_owner_id, changed_by').eq('task_id', t.id).order('created_at');
    expect(data).toHaveLength(2);
    expect(data![1]).toMatchObject({ from_owner_id: ids.Zinia, to_owner_id: ids.Dev, changed_by: ids.Shruti });
    // Shruti still sees it as creator; Zinia no longer does.
    const z = await login('Zinia');
    expect((await z.from('tasks').select('id').eq('id', t.id)).data).toHaveLength(0);
  });

  it('there is no supervisor visibility: Sanket cannot see Dev\'s tasks, nor can Zinia', async () => {
    await db.query("update public.members set reports_to = (select id from public.members where name = 'Sanket') where name = 'Dev'");
    const k = await login('Kartik');
    const t = await createTask(k, 'Dev');
    const sa = await login('Sanket');
    expect((await sa.from('tasks').select('id').eq('id', t.id)).data).toHaveLength(0);
    await db.query("update public.members set reports_to = null where name = 'Dev'");
    const z = await login('Zinia');
    expect((await z.from('tasks').select('id').eq('id', t.id)).data).toHaveLength(0);
  });

  it('collaborators can see and update progress on a shared task', async () => {
    const k = await login('Kartik');
    const t = await createTask(k, 'Shruti');
    const { error } = await k.from('task_collaborators').insert({ task_id: t.id, member_id: ids.Zinia });
    expect(error).toBeNull();
    const z = await login('Zinia');
    expect((await z.from('tasks').select('id').eq('id', t.id)).data).toHaveLength(1);
    const { error: e2 } = await z.from('tasks').update({ progress_note: 'Called customer' }).eq('id', t.id);
    expect(e2).toBeNull();
    // but cannot add more collaborators
    const { error: e3 } = await z.from('task_collaborators').insert({ task_id: t.id, member_id: ids.Dev });
    expect(e3).not.toBeNull();
  });

  it('cannot assign a task to a deactivated member', async () => {
    await db.query('update public.members set is_active = false where name = $1', ['Zinia']);
    const k = await login('Kartik');
    const { error } = await k.from('tasks').insert({ title: 'x', owner_id: ids.Zinia });
    expect(error?.message).toMatch(/active team member/);
  });
});

describe('flags and dashboards', () => {
  it('flags follow the precedence Done > Overdue > Blocked > Due soon > Stale > Due in 7 days > On track', async () => {
    const k = await login('Kartik');
    const past = await sqlDate('private.today() - 2');
    const soon = await sqlDate('private.today() + 2');
    const later = await sqlDate('private.today() + 20');
    const done = await createTask(k, 'Shruti', { title: 'done', due_date: past, status: 'Done' });
    const overdueBlocked = await createTask(k, 'Shruti', { title: 'od', due_date: past, status: 'Blocked', blocker_reason: 'Waiting' });
    const blocked = await createTask(k, 'Shruti', { title: 'bl', due_date: later, status: 'Blocked', blocker_reason: 'Waiting' });
    const week = await createTask(k, 'Shruti', { title: 'week', due_date: await sqlDate('private.today() + 6') });
    const dueSoon = await createTask(k, 'Shruti', { title: 'soon', due_date: soon });
    const stale = await createTask(k, 'Shruti', { title: 'stale', due_date: later });
    const fine = await createTask(k, 'Shruti', { title: 'fine', due_date: later });
    await db.query(`alter table public.tasks disable trigger tasks_before;
      update public.tasks set last_update_at = now() - interval '4 days' where id = '${stale.id}';
      alter table public.tasks enable trigger tasks_before;`);
    const { data } = await k.from('task_board').select('id, flag, days_left');
    const flag = (id: string) => data!.find((r) => r.id === id)!.flag;
    expect(flag(done.id)).toBe('Done');
    expect(flag(overdueBlocked.id)).toBe('Overdue');
    expect(flag(blocked.id)).toBe('Blocked');
    expect(flag(dueSoon.id)).toBe('Due soon');
    expect(flag(stale.id)).toBe('Stale');
    expect(flag(fine.id)).toBe('On track');
    expect(flag(week.id)).toBe('Due in 7 days');
    expect(data!.find((r) => r.id === done.id)!.days_left).toBeNull();
    expect(data!.find((r) => r.id === dueSoon.id)!.days_left).toBe(2);
  });

  it('manager dashboard counts update after changes; members cannot open it', async () => {
    const k = await login('Kartik');
    const past = await sqlDate('private.today() - 1');
    const before = (await k.rpc('manager_dashboard')).data;
    expect(before.open).toBe(0);
    const t = await createTask(k, 'Sanket', { due_date: past });
    await createTask(k, 'Sanket', { status: 'Blocked', blocker_reason: 'No stock', due_date: await sqlDate('private.today() + 3') });
    const mid = (await k.rpc('manager_dashboard')).data;
    expect(mid).toMatchObject({ open: 2, overdue: 1, blocked: 1, due_next_7: 1 });
    const sanket = mid.people.find((p: { name: string }) => p.name === 'Sanket');
    expect(sanket).toMatchObject({ open: 2, overdue: 1, blocked: 1 });
    await k.from('tasks').update({ status: 'Done' }).eq('id', t.id);
    const after = (await k.rpc('manager_dashboard')).data;
    expect(after).toMatchObject({ open: 1, overdue: 0 });
    const s = await login('Sanket');
    const { error } = await s.rpc('manager_dashboard');
    expect(error?.message).toMatch(/Managers only/);
    const mine = (await s.rpc('my_summary')).data;
    expect(mine).toMatchObject({ open: 1, blocked: 1 });
  });

  it('team overview gives counts to everyone but usernames only to admins', async () => {
    const z = await login('Zinia');
    const { data } = await z.rpc('team_overview');
    expect(data.length).toBe(5);
    expect(data.every((r: { username: string | null }) => r.username === null)).toBe(true);
    const k = await login('Kartik');
    const { data: kd } = await k.rpc('team_overview');
    expect(kd.find((r: { name: string }) => r.name === 'Zinia').username).toBe('zinia');
  });
});

describe('backlog workflow', () => {
  async function submit(c: SupabaseClient, skills: string, title = 'New work') {
    const { data, error } = await c.from('backlog_items')
      .insert({ title, skills_needed: skills, priority: 'High', due_date: await sqlDate('private.today() + 5') }).select('id').single();
    if (error) throw error;
    const { data: row } = await c.from('backlog_board').select('*').eq('id', data.id).single();
    return row!;
  }

  it('any member can submit; suggestion follows expertise', async () => {
    const z = await login('Zinia');
    const row = await submit(z, 'packing count, dispatch');
    expect(row.requested_by_name).toBe('Zinia');
    expect(row.suggested_owner_name).toBe('Sanket');
    expect(row.suggestion_reason).toMatch(/matches 2 of 2 skill\(s\)/);
    expect(row.suggestion_reason).toMatch(/of 10 open-task slots used; no overdue tasks/);
    const row2 = await submit(z, 'NDR, order confirmation calls');
    expect(row2.suggested_owner_name).toBe('Zinia');
    const row3 = await submit(z, 'Listings, exchanges');
    expect(row3.suggested_owner_name).toBe('Shruti');
  });

  it('workload shifts the suggestion when the best skill match is at capacity', async () => {
    await db.query("update public.members set max_open_tasks = 2 where name = 'Sanket'");
    const k = await login('Kartik');
    await createTask(k, 'Sanket');
    await createTask(k, 'Sanket');
    const row = await submit(k, 'dispatch, packing');
    expect(row.suggested_owner_name).toBe('Dev');
    expect(row.suggestion_reason).toMatch(/Sanket matches more skills but is at capacity/);
    await db.query("update public.members set max_open_tasks = 10 where name = 'Sanket'");
  });

  it('between equal skill matches, the lighter workload wins', async () => {
    await db.query("update public.members set expertise = 'Packing, dispatch' where name = 'Dev'");
    const k = await login('Kartik');
    for (let i = 0; i < 4; i++) await createTask(k, 'Sanket');
    const row = await submit(k, 'dispatch');
    expect(row.suggested_owner_name).toBe('Dev');
    expect(row.suggestion_reason).toMatch(/Alternatives: Sanket/);
    await db.query("update public.members set expertise = 'Packing' where name = 'Dev'");
  });

  it('unmatched skills fall back to the fallback owner with capacity', async () => {
    const k = await login('Kartik');
    const row = await submit(k, 'Unrelated widget polishing');
    expect(row.suggested_owner_name).toBe('Kartik'); // fallback owner when nothing matches
    expect(row.suggestion_reason).toMatch(/No available person's skills match/);
    const cands = row.suggestion_candidates as Array<{ name: string; score: number }>;
    expect(cands.length).toBeGreaterThan(1);
  });

  it('members cannot approve or forge approval fields', async () => {
    const s = await login('Shruti');
    const row = await submit(s, 'dispatch');
    const { error } = await s.rpc('approve_backlog_item', { p_item: row.id });
    expect(error?.message).toMatch(/Only a manager/);
    const { error: e2 } = await s.from('backlog_items').update({ status: 'Converted to Task', approval: 'Yes' } as never).eq('id', row.id);
    expect(e2).not.toBeNull();
    const { error: e3 } = await s.from('backlog_items').update({ suggested_owner_id: ids.Shruti } as never).eq('id', row.id);
    expect(e3).not.toBeNull();
  });

  it('approval creates exactly one task, even when submitted twice or concurrently', async () => {
    const s = await login('Shruti');
    const row = await submit(s, 'dispatch');
    const k = await login('Kartik');
    const results = await Promise.all([
      k.rpc('approve_backlog_item', { p_item: row.id }),
      k.rpc('approve_backlog_item', { p_item: row.id }),
      k.rpc('approve_backlog_item', { p_item: row.id }),
    ]);
    const taskIds = new Set(results.map((r) => r.data));
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(taskIds.size).toBe(1);
    const count = await db.query('select count(*)::int as n from public.tasks where backlog_item_id = $1', [row.id]);
    expect(count.rows[0].n).toBe(1);
    const { data: b } = await k.from('backlog_board').select('*').eq('id', row.id).single();
    expect(b).toMatchObject({ status: 'Converted to Task', approval: 'Yes', final_owner_name: 'Sanket', overrode_suggestion: false, decided_by_name: 'Kartik' });
    expect(b.backlog_code).toMatch(/^BCK-1\d\d$/);
    const { data: task } = await k.from('task_board').select('status, assigned_by_name, task_code').eq('backlog_item_id', row.id).single();
    expect(task).toMatchObject({ status: 'To Do', assigned_by_name: 'Kartik' });
    expect(task!.task_code).toMatch(/^TSK-\d{3}$/);
    // requester can track the resulting task; owner sees it too
    expect((await s.from('task_board').select('id, owner_name').eq('backlog_item_id', row.id)).data).toHaveLength(1);
    const sa = await login('Sanket');
    expect((await sa.from('tasks').select('id').eq('backlog_item_id', row.id)).data).toHaveLength(1);
  });

  it('manager can override the suggestion and the decision is recorded', async () => {
    const z = await login('Zinia');
    const row = await submit(z, 'dispatch');
    const k = await login('Kartik');
    const { data: taskId, error } = await k.rpc('approve_backlog_item', { p_item: row.id, p_owner: ids.Dev, p_note: 'Sanket is busy' });
    expect(error).toBeNull();
    const { data: b } = await k.from('backlog_board').select('*').eq('id', row.id).single();
    expect(b).toMatchObject({ final_owner_name: 'Dev', overrode_suggestion: true, decision_note: 'Sanket is busy', task_id: taskId });
    const { data: audit } = await k.from('audit_events').select('action').eq('entity_id', row.id);
    expect(audit!.map((a) => a.action)).toEqual(expect.arrayContaining(['submitted', 'approved', 'converted']));
  });

  it('decided backlog rows are frozen for members', async () => {
    const z = await login('Zinia');
    const row = await submit(z, 'dispatch');
    const k = await login('Kartik');
    await k.rpc('reject_backlog_item', { p_item: row.id, p_note: 'Not needed' });
    const { data } = await z.from('backlog_items').update({ title: 'changed' }).eq('id', row.id).select();
    expect(data ?? []).toHaveLength(0);
  });
});

describe('routines', () => {
  async function routineId(title: string) {
    const r = await db.query('select id, owner_id from public.routines where title = $1', [title]);
    return r.rows[0];
  }

  it('members see only their own routines (no supervisor visibility)', async () => {
    const z = await login('Zinia');
    const { data } = await z.from('routine_board').select('title, owner_name');
    expect(data!.every((r) => r.owner_name === 'Zinia')).toBe(true);
    const sa = await login('Sanket');
    const { data: sd } = await sa.from('routine_board').select('owner_name');
    expect(new Set(sd!.map((r) => r.owner_name))).toEqual(new Set(['Sanket']));
  });

  it('marking done sets Last Done / Next Due and refuses a second completion in the same cycle', async () => {
    const r = await routineId('Check listings are live and correct on all platforms');
    const s = await login('Shruti');
    const today = await sqlDate('private.today()');
    const first = (await s.rpc('complete_routine', { p_routine: r.id })).data;
    expect(first.ok).toBe(true);
    expect(first.next_due).toBe(await sqlDate('private.today() + 7'));
    const again = (await s.rpc('complete_routine', { p_routine: r.id })).data;
    expect(again).toMatchObject({ ok: false, error: 'already_done' });
    const { data: board } = await s.from('routine_board').select('*').eq('id', r.id).single();
    expect(board).toMatchObject({ last_done: today, status: 'OK', times_done: 1 });
  });

  it('overdue routine shows Overdue, counts on the dashboard, and history is kept', async () => {
    const r = await routineId('Pack orders');
    // imported spreadsheet completions age with the calendar, so compare with the count before this routine goes overdue
    const k = await login('Kartik');
    const base = (await k.rpc('manager_dashboard')).data;
    const baseDev = base.people.find((p: { name: string }) => p.name === 'Dev').routine_overdue;
    await db.query(`insert into public.routine_completions (routine_id, cycle_due, completed_on, completed_by)
                    values ($1, private.today() - 5, private.today() - 5, $2)`, [r.id, r.owner_id]);
    const dash = (await k.rpc('manager_dashboard')).data;
    expect(dash.routine_overdue).toBe(base.routine_overdue + 1);
    expect(dash.people.find((p: { name: string }) => p.name === 'Dev').routine_overdue).toBe(baseDev + 1);
    const d = await login('Dev');
    const { data: before } = await d.from('routine_board').select('status').eq('id', r.id).single();
    expect(before!.status).toBe('Overdue');
    const res = (await d.rpc('complete_routine', { p_routine: r.id })).data;
    expect(res.ok).toBe(true);
    const { data: hist } = await d.from('routine_completions').select('cycle_due, completed_on').eq('routine_id', r.id).order('completed_on');
    expect(hist).toHaveLength(2);
    expect(hist![1].cycle_due).toBe(await sqlDate('private.today() - 4'));
  });

  it('a member cannot tick off someone else\'s routine', async () => {
    const r = await routineId('Pack orders');
    const z = await login('Zinia');
    const { error } = await z.rpc('complete_routine', { p_routine: r.id });
    expect(error?.message).toMatch(/not found/);
  });

  it('Daily/Weekly/Monthly intervals are fixed at 1/7/30 days; only managers create routines', async () => {
    const k = await login('Kartik');
    const { data: monthly, error } = await k.from('routines').insert({ title: 'Monthly thing', owner_id: ids.Dev, frequency: 'Monthly', every_n_days: 3 }).select().single();
    expect(error).toBeNull();
    expect(monthly!.every_n_days).toBe(30);
    await db.query('delete from public.routines where id = $1', [monthly!.id]);
    const { data, error: e2 } = await k.from('routines').insert({ title: 'Every 3 days', owner_id: ids.Dev, frequency: 'Custom', every_n_days: 3 }).select().single();
    expect(e2).toBeNull();
    await db.query('delete from public.routines where id = $1', [data!.id]);
    const d = await login('Dev');
    const { error: e3 } = await d.from('routines').insert({ title: 'mine', owner_id: ids.Dev, frequency: 'Daily', every_n_days: 1 });
    expect(e3).not.toBeNull();
  });
});

describe('roles, escalation and deactivation', () => {
  it('a member cannot make themselves admin or edit the directory', async () => {
    const d = await login('Dev');
    const { data } = await d.from('members').update({ access_role: 'admin' }).eq('id', ids.Dev).select();
    expect(data ?? []).toHaveLength(0);
    const r = await db.query('select access_role from public.members where id = $1', [ids.Dev]);
    expect(r.rows[0].access_role).toBe('member');
    const { error } = await d.from('members').insert({ name: 'Intruder', access_role: 'admin' });
    expect(error).not.toBeNull();
    const { error: e2 } = await d.rpc('admin_set_pin', { p_member: ids.Kartik, p_pin: '000' });
    expect(e2?.message).toMatch(/Admins only/);
    const { error: e3 } = await d.from('members').update({ user_id: ids.Dev } as never).eq('id', ids.Kartik);
    expect(e3).not.toBeNull();
  });

  it('admin cannot remove the last admin', async () => {
    const k = await login('Kartik');
    const { error } = await k.from('members').update({ access_role: 'member' }).eq('id', ids.Kartik);
    expect(error?.message).toMatch(/At least one active admin/);
  });

  it('a promoted manager can approve; a demoted one cannot', async () => {
    const k = await login('Kartik');
    await k.from('members').update({ access_role: 'manager' }).eq('id', ids.Shruti);
    const s = await login('Shruti');
    expect((await s.rpc('manager_dashboard')).error).toBeNull();
    await k.from('members').update({ access_role: 'member' }).eq('id', ids.Shruti);
    expect((await s.rpc('manager_dashboard')).error).not.toBeNull();
  });

  it('deactivated accounts lose access immediately, including open sessions', async () => {
    const z = await login('Zinia');
    expect((await z.from('members').select('id')).data!.length).toBeGreaterThan(0);
    const k = await login('Kartik');
    const { error } = await k.from('members').update({ is_active: false }).eq('id', ids.Zinia);
    expect(error).toBeNull();
    expect((await z.from('members').select('id')).data ?? []).toHaveLength(0);
    const { data: st } = await z.rpc('session_status');
    expect(st.verified).toBe(false);
    const { data: pin } = await z.rpc('verify_pin', { p_pin: '555' });
    expect(pin.ok).toBe(false);
  });

  it('audit log is manager-only', async () => {
    const d = await login('Dev');
    expect((await d.from('audit_events').select('id')).data ?? []).toHaveLength(0);
    expect((await d.from('data_issues').select('id')).data ?? []).toHaveLength(0);
    const k = await login('Kartik');
    expect((await k.from('data_issues').select('id')).data!.length).toBe(12);
  });
});
