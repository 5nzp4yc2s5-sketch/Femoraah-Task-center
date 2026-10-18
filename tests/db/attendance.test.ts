import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, login, memberId, provision, resetData } from './helpers';

// The 12 acceptance tests from the attendance spec, plus the sign-in / sign-out hooks.
// Past days are built by inserting sessions with chosen server timestamps; today's sessions come
// from the real sign-in (verify_pin) and sign-out (end_session) functions.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};
const TZ = 'Asia/Kolkata';

async function day(offset: number): Promise<string> {
  const r = await db.query(`select (private.today() + $1::int)::text as d`, [offset]);
  return r.rows[0].d;
}

/** Every-day 10:00-19:00 schedule, grace 10 min, effective 60 days ago. */
async function setSchedule(name: string, start = '10:00', end = '19:00', grace = 10) {
  await db.query('delete from public.work_schedules where member_id = $1', [ids[name]]);
  await db.query(
    `insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, break_minutes, grace_minutes, timezone)
     values ($1, private.today() - 60, $2, $3, '{1,2,3,4,5,6,7}', 60, $4, $5)`,
    [ids[name], start, end, grace, TZ],
  );
}

/** A finished (or never-finished, when logout is null) session on a past day, at local times. */
async function pastSession(name: string, offset: number, login: string, logout: string | null) {
  const d = await day(offset);
  await db.query(
    `insert into public.attendance_sessions (record_id, member_id, work_date, login_at, logout_at, logout_source)
     values (private.attendance_record_for($1, $2::date), $1, $2::date, ($2::date + $3::time) at time zone $5,
             case when $4::time is null then null else ($2::date + $4::time) at time zone $5 end,
             case when $4::time is null then null else 'sign_out' end)`,
    [ids[name], d, login, logout, TZ],
  );
  return d;
}

async function report(name: string, offset: number) {
  const k = await login('Kartik');
  const d = await day(offset);
  const { data, error } = await k.rpc('attendance_report', { p_from: d, p_to: d, p_member: ids[name] });
  if (error) throw error;
  return data[0];
}

beforeAll(async () => {
  await resetData();
  for (const n of TEAM) await provision(n);
  for (const n of TEAM) ids[n] = await memberId(n);
}, 60_000);

beforeEach(async () => {
  await resetData();
  for (const n of TEAM) await setSchedule(n);
});

afterAll(async () => {
  await db.query('delete from public.work_schedules');
  await db.query('select private.default_schedule(id) from public.members where is_active');
  await db.end();
});

describe('attendance acceptance tests', () => {
  it('1. logs in on time (09:55 for a 10:00 start)', async () => {
    await pastSession('Zinia', -3, '09:55', '19:00');
    const r = await report('Zinia', -3);
    expect(r).toMatchObject({ login_status: 'On Time', minutes_late: 0, day_type: 'Working Day' });
  });

  it('2. logs in within the grace period (10:07, grace 10 min)', async () => {
    await pastSession('Zinia', -3, '10:07', '19:00');
    const r = await report('Zinia', -3);
    expect(r).toMatchObject({ login_status: 'Within Grace Period', minutes_late: 7 });
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-3), p_to: await day(-3) });
    // only Zinia's day counts: signing in as Kartik for the refresh can raise his own Late Login for today
    expect((await db.query("select count(*)::int n from public.attendance_flags where flag_type = 'Late Login' and member_id = $1 and work_date = $2", [ids.Zinia, await day(-3)])).rows[0].n).toBe(0);
  });

  it('3. logs in late (10:15 is 15 min late, grace shown separately) and gets a Late Login flag', async () => {
    await pastSession('Zinia', -3, '10:15', '19:00');
    const r = await report('Zinia', -3);
    expect(r).toMatchObject({ login_status: 'Late', minutes_late: 15, grace_minutes: 10 });
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-3), p_to: await day(-3) });
    const f = await db.query("select * from public.attendance_flags where member_id = $1 and flag_type = 'Late Login'", [ids.Zinia]);
    expect(f.rows[0]).toMatchObject({ minutes: 15, status: 'Open' });
    expect(f.rows[0].reason).toMatch(/15 min after the scheduled start of 10:00 \(grace period 10 min\)/);
  });

  it('4. logs out on time', async () => {
    await pastSession('Dev', -2, '10:00', '19:05');
    const r = await report('Dev', -2);
    expect(r).toMatchObject({ logout_status: 'Logged Out', worked_minutes: 545, minutes_early: null });
  });

  it('5. logs out early (17:30 for a 19:00 end) and gets an Early Logout flag', async () => {
    await pastSession('Dev', -2, '10:00', '17:30');
    const r = await report('Dev', -2);
    expect(r).toMatchObject({ logout_status: 'Left Early', minutes_early: 90 });
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-2), p_to: await day(-2) });
    const f = await db.query("select minutes from public.attendance_flags where member_id = $1 and flag_type = 'Early Logout'", [ids.Dev]);
    expect(f.rows[0].minutes).toBe(90);
  });

  it('6. works overtime (signs out at 20:00)', async () => {
    await pastSession('Dev', -2, '09:58', '20:00');
    const r = await report('Dev', -2);
    expect(r).toMatchObject({ login_status: 'On Time', logout_status: 'Overtime', minutes_overtime: 60, worked_minutes: 602 });
  });

  it('7. closes the browser without signing out: the session becomes Incomplete, no logout is invented', async () => {
    await pastSession('Sanket', -1, '10:00', null);
    const r = await report('Sanket', -1);
    expect(r).toMatchObject({ logout_status: 'Incomplete Session', last_logout: null, worked_minutes: 0, incomplete_sessions: 1 });
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-1), p_to: await day(-1) });
    const f = await db.query("select * from public.attendance_flags where member_id = $1 and flag_type = 'Incomplete Session'", [ids.Sanket]);
    expect(f.rows).toHaveLength(1);
    const s = await db.query('select incomplete_at, logout_at from public.attendance_sessions where member_id = $1', [ids.Sanket]);
    expect(s.rows[0].incomplete_at).not.toBeNull();
    expect(s.rows[0].logout_at).toBeNull();

    // Today: a sign-in that is never signed out expires after 12 hours; the next sign-in starts a new session.
    await login('Shruti');
    await db.query("update public.attendance_sessions set login_at = now() - interval '13 hours' where member_id = $1", [ids.Shruti]);
    await login('Shruti');
    const rows = (await db.query('select logout_at, incomplete_at from public.attendance_sessions where member_id = $1 order by login_at', [ids.Shruti])).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].incomplete_at).not.toBeNull();
    expect(rows[1].incomplete_at).toBeNull();
  });

  it('8. an employee cannot view or change another employee\'s attendance', async () => {
    await pastSession('Dev', -2, '10:00', '19:00');
    const z = await login('Zinia');
    const { error } = await z.rpc('attendance_report', { p_from: await day(-2), p_to: await day(-2), p_member: ids.Dev });
    expect(error?.message).toMatch(/only view your own attendance/);
    const { data: own } = await z.rpc('attendance_report', { p_from: await day(-2), p_to: await day(-2) });
    expect(own.every((r: { member_id: string }) => r.member_id === ids.Zinia)).toBe(true);
    expect((await z.from('attendance_sessions').select('id').eq('member_id', ids.Dev)).data).toHaveLength(0);
    expect((await z.from('attendance_records').select('id').eq('member_id', ids.Dev)).data).toHaveLength(0);
    expect((await z.from('work_schedules').select('id').eq('member_id', ids.Dev)).data).toHaveLength(0);
    // and nobody can write attendance tables directly, including their own rows
    const { data: mine } = await z.from('attendance_sessions').select('id').eq('member_id', ids.Zinia);
    const { error: e2 } = await z.from('attendance_sessions').update({ login_at: new Date().toISOString() } as never).eq('id', mine![0].id);
    expect(e2).not.toBeNull();
    const { error: e3 } = await z.from('attendance_sessions').insert({ member_id: ids.Zinia } as never);
    expect(e3).not.toBeNull();
    const { error: e4 } = await z.rpc('admin_set_schedule', {
      p_member: ids.Zinia, p_effective_from: await day(0), p_start: '11:00', p_end: '18:00',
      p_days: [1, 2, 3], p_break: 30, p_grace: 30, p_timezone: TZ, p_note: '',
    });
    expect(e4?.message).toMatch(/Only an admin/);
  });

  it('9. an admin reviews and resolves a flag; the employee can add an explanation but not resolve it', async () => {
    await pastSession('Zinia', -3, '10:40', '19:00');
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-3), p_to: await day(-3) });
    const flag = (await db.query("select id from public.attendance_flags where member_id = $1 and flag_type = 'Late Login'", [ids.Zinia])).rows[0];
    const z = await login('Zinia');
    expect((await z.rpc('explain_attendance_flag', { p_flag: flag.id, p_explanation: 'Metro was down' })).error).toBeNull();
    expect((await z.rpc('review_attendance_flag', { p_flag: flag.id, p_status: 'Resolved', p_note: 'ok' })).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('review_attendance_flag', { p_flag: flag.id, p_status: 'Reviewed', p_note: 'Spoke to Zinia' })).error).toBeNull();
    expect((await k.rpc('review_attendance_flag', { p_flag: flag.id, p_status: 'Resolved', p_note: 'Transit outage' })).error).toBeNull();
    const row = (await db.query('select * from public.attendance_flags where id = $1', [flag.id])).rows[0];
    expect(row).toMatchObject({ status: 'Resolved', review_note: 'Transit outage', employee_explanation: 'Metro was down', reviewed_by: ids.Kartik });
    // refreshing again never reopens a reviewed flag
    await k.rpc('attendance_refresh', { p_from: await day(-3), p_to: await day(-3) });
    expect((await db.query('select status from public.attendance_flags where id = $1', [flag.id])).rows[0].status).toBe('Resolved');
  });

  it('10. a schedule change applies from its start date and leaves past days unchanged', async () => {
    await pastSession('Dev', -2, '09:30', '18:00');
    const before = await report('Dev', -2);
    expect(before).toMatchObject({ login_status: 'On Time', logout_status: 'Left Early', minutes_early: 60 });
    const k = await login('Kartik');
    const { error } = await k.rpc('admin_set_schedule', {
      p_member: ids.Dev, p_effective_from: await day(0), p_start: '09:00', p_end: '18:00',
      p_days: [1, 2, 3, 4, 5, 6, 7], p_break: 60, p_grace: 5, p_timezone: TZ, p_note: 'Earlier shift',
    });
    expect(error).toBeNull();
    const after = await report('Dev', -2);
    expect(after).toMatchObject({ login_status: 'On Time', logout_status: 'Left Early', minutes_early: 60, grace_minutes: 10 });
    const { error: past } = await k.rpc('admin_set_schedule', {
      p_member: ids.Dev, p_effective_from: await day(-5), p_start: '09:00', p_end: '18:00',
      p_days: [1, 2, 3, 4, 5, 6, 7], p_break: 60, p_grace: 5, p_timezone: TZ, p_note: '',
    });
    expect(past?.message).toMatch(/start today or later/);
    const schedules = await db.query('select effective_from::text, start_time::text from public.work_schedules where member_id = $1 order by effective_from', [ids.Dev]);
    expect(schedules.rows.map((r) => r.start_time)).toEqual(['10:00:00', '09:00:00']);
  });

  it('11. an employee requests a correction; an admin approves it and the original is kept with an audit trail', async () => {
    await pastSession('Sanket', -1, '10:00', null);
    const sa = await login('Sanket');
    const { error: badReason } = await sa.rpc('request_attendance_correction', { p_date: await day(-1), p_login: null, p_logout: '19:10', p_reason: '' });
    expect(badReason).not.toBeNull();
    const { data: reqId, error } = await sa.rpc('request_attendance_correction', {
      p_date: await day(-1), p_login: null, p_logout: '19:10', p_reason: 'Laptop battery died before I signed out',
    });
    expect(error).toBeNull();
    // only one pending request per day
    expect((await sa.rpc('request_attendance_correction', { p_date: await day(-1), p_login: '10:00', p_logout: null, p_reason: 'again' })).error).not.toBeNull();
    // the employee cannot approve it
    expect((await sa.rpc('decide_attendance_correction', { p_id: reqId, p_approve: true, p_note: '' })).error?.message).toMatch(/Only an admin/);
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-1), p_to: await day(-1) });
    expect((await k.rpc('decide_attendance_correction', { p_id: reqId, p_approve: true, p_note: 'Confirmed with Sanket' })).error).toBeNull();

    const r = await report('Sanket', -1);
    // logout 19:10 is 10 min after the end: overtime only counts from 30 min past the end
    expect(r).toMatchObject({ logout_status: 'Logged Out', corrected: true, worked_minutes: 550, incomplete_sessions: 0, minutes_overtime: 10 });
    const session = (await db.query('select logout_at, corrected_logout_at, incomplete_at from public.attendance_sessions where member_id = $1 and work_date = $2', [ids.Sanket, await day(-1)])).rows[0];
    expect(session.logout_at).toBeNull();
    expect(session.corrected_logout_at).not.toBeNull();
    const req = (await db.query('select * from public.attendance_corrections where id = $1', [reqId])).rows[0];
    expect(req).toMatchObject({ status: 'Approved', decided_by: ids.Kartik, original_logout_at: null });
    const flags = (await db.query("select status, review_note from public.attendance_flags where member_id = $1 and flag_type = 'Incomplete Session'", [ids.Sanket])).rows;
    expect(flags[0]).toMatchObject({ status: 'Resolved' });
    const audit = (await db.query("select action from public.audit_events where entity = 'attendance_correction' and entity_id = $1 order by created_at", [reqId])).rows;
    expect(audit.map((a) => a.action)).toEqual(['requested', 'approved']);
    // and the employee sees the corrected day in their own history
    const { data: own } = await sa.rpc('attendance_report', { p_from: await day(-1), p_to: await day(-1) });
    expect(own[0]).toMatchObject({ corrected: true, logout_status: 'Logged Out' });
  });

  it('12. statuses and figures come from the database: no login, leave, holiday, weekly off, and today\'s live session', async () => {
    const k = await login('Kartik');
    // Dev: nothing recorded on a working day -> Not Logged In + No Login flag
    // Zinia: on leave; Shruti: company holiday; Sanket: weekly off (schedule without that weekday)
    // (a company holiday applies to everyone, so it is checked on the day before)
    await k.from('leaves').insert({ member_id: ids.Zinia, start_date: await day(-4), end_date: await day(-4) });
    await k.from('holidays').insert({ holiday_date: await day(-5), name: 'Test holiday' });
    const dow = (await db.query('select extract(isodow from private.today() - 4)::int as d')).rows[0].d;
    await db.query("update public.work_schedules set working_days = (select array_agg(x) from unnest('{1,2,3,4,5,6,7}'::smallint[]) x where x <> $2) where member_id = $1", [ids.Sanket, dow]);
    const from = await day(-4);
    await k.rpc('attendance_refresh', { p_from: from, p_to: from });
    const { data } = await k.rpc('attendance_report', { p_from: from, p_to: from });
    const by = (n: string) => data.find((r: { member_id: string }) => r.member_id === ids[n]);
    expect(by('Dev')).toMatchObject({ login_status: 'Not Logged In', day_type: 'Working Day' });
    expect(by('Zinia')).toMatchObject({ login_status: 'On Leave', day_type: 'On Leave' });
    expect(by('Shruti')).toMatchObject({ login_status: 'Not Logged In' });
    expect(by('Sanket')).toMatchObject({ login_status: 'Weekly Off' });
    const noLogin = await db.query("select member_id from public.attendance_flags where flag_type = 'No Login' and work_date = $1", [from]);
    expect(noLogin.rows.map((r) => r.member_id)).toContain(ids.Dev);
    expect(noLogin.rows.map((r) => r.member_id)).not.toContain(ids.Zinia);
    expect(noLogin.rows.map((r) => r.member_id)).not.toContain(ids.Sanket);
    const h = await k.rpc('attendance_report', { p_from: await day(-5), p_to: await day(-5) });
    expect(h.data.every((r: { login_status: string; holiday_name: string }) => r.login_status === 'Holiday' && r.holiday_name === 'Test holiday')).toBe(true);
    await k.rpc('attendance_refresh', { p_from: await day(-5), p_to: await day(-5) });
    expect((await db.query("select count(*)::int n from public.attendance_flags where work_date = $1", [await day(-5)])).rows[0].n).toBe(0);
    // the admin summary counts match the rows
    const notLogged = data.filter((r: { login_status: string }) => r.login_status === 'Not Logged In').map((r: { member_id: string }) => r.member_id);
    expect(notLogged.sort()).toEqual([ids.Dev, ids.Shruti, ids.Kartik].sort());

    // Today: the real sign-in records a session at database time, sign-out closes it once.
    const z = await login('Zinia');
    const today = await day(0);
    const live = (await z.rpc('attendance_report', { p_from: today, p_to: today })).data[0];
    expect(live).toMatchObject({ logout_status: 'Currently Working', session_count: 1 });
    const dbNow = (await db.query('select now() as n')).rows[0].n as Date;
    expect(Math.abs(new Date(live.first_login).getTime() - dbNow.getTime())).toBeLessThan(60_000);
    // signing in again on another device does not start a second session
    await login('Zinia');
    expect((await db.query('select count(*)::int n from public.attendance_sessions where member_id = $1', [ids.Zinia])).rows[0].n).toBe(1);
    await z.rpc('end_session');
    const closed = (await db.query('select logout_at from public.attendance_sessions where member_id = $1', [ids.Zinia])).rows[0].logout_at;
    expect(closed).not.toBeNull();
    // a second sign-out does not change the recorded logout
    const z2 = await login('Zinia');
    await z2.rpc('end_session');
    await z2.rpc('end_session');
    const rows = (await db.query('select logout_at from public.attendance_sessions where member_id = $1 order by login_at', [ids.Zinia])).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].logout_at.getTime()).toBe(closed.getTime());
    // signing out before the scheduled end is not flagged until the end has passed (it may be a break);
    // a sign-out after 19:00 is not early at all, so with real-time sessions there is never a flag here
    await k.rpc('attendance_refresh', { p_from: today, p_to: today });
    const early = (await db.query("select count(*)::int n from public.attendance_flags where member_id = $1 and flag_type = 'Early Logout' and work_date = $2", [ids.Zinia, today])).rows[0].n;
    expect(early).toBe(0);
  });
});

describe('attendance: repeated lateness', () => {
  it('three late logins in 30 days raise a Repeated Late Login flag', async () => {
    for (const d of [-9, -6, -3]) await pastSession('Dev', d, '10:30', '19:00');
    const k = await login('Kartik');
    await k.rpc('attendance_refresh', { p_from: await day(-9), p_to: await day(-1) });
    const f = await db.query("select work_date::text, minutes from public.attendance_flags where member_id = $1 and flag_type = 'Repeated Late Login'", [ids.Dev]);
    expect(f.rows).toEqual([{ work_date: await day(-3), minutes: 3 }]);
  });
});
