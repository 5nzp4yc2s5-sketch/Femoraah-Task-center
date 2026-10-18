import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anonClient, db, login, memberId, provision, resetData } from './helpers';

// Attendance phase 2: teams and default hours (with weekly offs), exemptions, exception decisions
// with history, breaks, late logout and long break flags.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};
const TZ = 'Asia/Kolkata';
const EVERY_DAY = '{1,2,3,4,5,6,7}';

async function day(offset: number): Promise<string> {
  const r = await db.query(`select (private.today() + $1::int)::text as d`, [offset]);
  return r.rows[0].d;
}

/** Personal schedule, every day 10:00-19:00, effective 60 days ago (same as the phase 1 tests). */
async function setSchedule(name: string) {
  await db.query('delete from public.work_schedules where member_id = $1', [ids[name]]);
  await db.query(
    `insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, break_minutes, grace_minutes, timezone)
     values ($1, private.today() - 60, '10:00', '19:00', $2, 60, 10, $3)`,
    [ids[name], EVERY_DAY, TZ],
  );
}

/** Makes a person follow the defaults from `offset` days ago (past dates go straight into the table). */
async function follow(name: string, offset: number) {
  await db.query('delete from public.work_schedules where member_id = $1', [ids[name]]);
  await db.query(
    `insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, break_minutes, grace_minutes, timezone, follows_default)
     values ($1, private.today() + $2::int, '10:00', '19:00', $3, 60, 10, $4, true)`,
    [ids[name], offset, EVERY_DAY, TZ],
  );
}

async function addDefault(team: string | null, offset: number, start: string, end: string, days = EVERY_DAY) {
  await db.query(
    `insert into public.schedule_defaults (team_id, effective_from, start_time, end_time, working_days, timezone)
     values ($1, private.today() + $2::int, $3, $4, $5, $6)`,
    [team, offset, start, end, days, TZ],
  );
}

async function addTeam(name: string): Promise<string> {
  return (await db.query('insert into public.teams (name) values ($1) returning id', [name])).rows[0].id;
}

async function pastSession(name: string, offset: number, loginAt: string, logoutAt: string | null) {
  const d = await day(offset);
  await db.query(
    `insert into public.attendance_sessions (record_id, member_id, work_date, login_at, logout_at, logout_source)
     values (private.attendance_record_for($1, $2::date), $1, $2::date, ($2::date + $3::time) at time zone $5,
             case when $4::time is null then null else ($2::date + $4::time) at time zone $5 end,
             case when $4::time is null then null else 'sign_out' end)`,
    [ids[name], d, loginAt, logoutAt, TZ],
  );
  return d;
}

async function pastBreak(name: string, offset: number, from: string, to: string) {
  const d = await day(offset);
  await db.query(
    `insert into public.attendance_breaks (member_id, work_date, record_id, source, start_at, end_at)
     values ($1, $2::date, private.attendance_record_for($1, $2::date), 'manual',
             ($2::date + $3::time) at time zone $5, ($2::date + $4::time) at time zone $5)`,
    [ids[name], d, from, to, TZ],
  );
}

type Row = Record<string, unknown> & { member_id: string; scheduled_start: string };

async function days(offset: number, name?: string): Promise<Row[]> {
  const k = await login('Kartik');
  const d = await day(offset);
  const { data, error } = await k.rpc('attendance_days_report', { p_from: d, p_to: d, p_member: name ? ids[name] : null });
  if (error) throw error;
  return data;
}

const localTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

async function refresh(from: number, to = from) {
  const k = await login('Kartik');
  const { error } = await k.rpc('attendance_refresh', { p_from: await day(from), p_to: await day(to) });
  if (error) throw error;
}

async function flags(name: string, type: string) {
  return (await db.query('select * from public.attendance_flags where member_id = $1 and flag_type = $2 order by work_date', [ids[name], type])).rows;
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
  await resetData();
  await db.query('delete from public.work_schedules');
  await db.query('select private.default_schedule(id) from public.members where is_active');
  await db.end();
});

describe('default hours and weekly offs', () => {
  it('applies personal > team > company, each from its own date', async () => {
    await follow('Zinia', -30);
    await addDefault(null, -30, '09:00', '18:00');
    let [r] = await days(-3, 'Zinia');
    expect(localTime(r.scheduled_start)).toBe('09:00');
    expect(r).toMatchObject({ schedule_source: 'Company', team_name: null });

    const ops = await addTeam('Operations');
    await db.query('insert into public.member_teams (member_id, team_id, effective_from) values ($1, $2, private.today() - 30)', [ids.Zinia, ops]);
    await addDefault(ops, -10, '11:00', '20:00');
    [r] = await days(-3, 'Zinia');
    expect(localTime(r.scheduled_start)).toBe('11:00');
    expect(r).toMatchObject({ schedule_source: 'Team', team_name: 'Operations' });
    // before the team default started, the company default applied
    [r] = await days(-15, 'Zinia');
    expect(localTime(r.scheduled_start)).toBe('09:00');

    // a personal schedule wins from its date; earlier days keep the team hours
    await db.query(
      `insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, timezone)
       values ($1, private.today() - 5, '08:00', '17:00', $2, $3)`,
      [ids.Zinia, EVERY_DAY, TZ],
    );
    [r] = await days(-3, 'Zinia');
    expect(localTime(r.scheduled_start)).toBe('08:00');
    expect(r.schedule_source).toBe('Personal');
    [r] = await days(-7, 'Zinia');
    expect(localTime(r.scheduled_start)).toBe('11:00');
  });

  it('a day outside the default working days is a Weekly Off with no flags', async () => {
    await follow('Zinia', -30);
    await addDefault(null, -30, '10:00', '19:00', '{1,2,3,4,5}');
    const sat = (await db.query(
      `select (private.today() - k)::text d, k from generate_series(1, 7) k where extract(isodow from private.today() - k) = 6`,
    )).rows[0];
    const [r] = await days(-sat.k, 'Zinia');
    expect(r).toMatchObject({ day_type: 'Weekly Off', login_status: 'Weekly Off' });
    await refresh(-sat.k);
    expect((await db.query('select count(*)::int n from public.attendance_flags where member_id = $1 and work_date = $2', [ids.Zinia, sat.d])).rows[0].n).toBe(0);
    // a working day with no sign-in is still flagged
    const wk = (await db.query(
      `select k from generate_series(1, 7) k where extract(isodow from private.today() - k) between 1 and 5 limit 1`,
    )).rows[0].k;
    await refresh(-wk);
    expect((await flags('Zinia', 'No Login')).map((f) => f.work_date.toISOString().slice(0, 10))).toHaveLength(1);
  });

  it('admins set company and team hours, teams and following from today; past dates are refused', async () => {
    const k = await login('Kartik');
    const z = await login('Zinia');
    const today = await day(0);
    const args = { p_team: null, p_effective_from: today, p_start: '09:30', p_end: '18:30', p_days: [5, 1, 2, 3, 4, 4], p_break: 45, p_grace: 5, p_timezone: TZ, p_note: '' };
    expect((await z.rpc('admin_set_default_schedule', args)).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('admin_set_default_schedule', { ...args, p_effective_from: await day(-1) })).error?.message).toMatch(/today or later/);
    expect((await k.rpc('admin_set_default_schedule', { ...args, p_days: [] })).error?.message).toMatch(/at least one working day/);
    expect((await k.rpc('admin_set_default_schedule', args)).error).toBeNull();
    // the same date again updates the row instead of adding a second one
    expect((await k.rpc('admin_set_default_schedule', { ...args, p_start: '09:00' })).error).toBeNull();
    const rows = (await db.query('select start_time::text, working_days from public.schedule_defaults where team_id is null')).rows;
    expect(rows).toEqual([{ start_time: '09:00:00', working_days: [1, 2, 3, 4, 5] }]);

    const { data: teamId, error: teamErr } = await k.rpc('admin_save_team', { p_id: null, p_name: 'Support', p_note: '', p_active: true });
    expect(teamErr).toBeNull();
    expect((await k.rpc('admin_save_team', { p_id: null, p_name: ' support ', p_note: '', p_active: true })).error?.message).toMatch(/already exists/);
    expect((await z.rpc('admin_save_team', { p_id: null, p_name: 'Mine', p_note: '', p_active: true })).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('admin_set_member_team', { p_member: ids.Dev, p_team: teamId, p_from: await day(-1) })).error?.message).toMatch(/today or later/);
    expect((await k.rpc('admin_set_member_team', { p_member: ids.Dev, p_team: teamId, p_from: today })).error).toBeNull();
    expect((await k.rpc('admin_set_default_schedule', { ...args, p_team: teamId, p_start: '12:00', p_end: '21:00' })).error).toBeNull();

    // Dev still has a personal schedule; following the defaults from today switches to the team hours
    let ov = (await k.rpc('schedule_overview', {})).data.find((o: { member_id: string }) => o.member_id === ids.Dev);
    expect(ov).toMatchObject({ source: 'Personal', team_name: 'Support', start_time: '10:00:00' });
    expect((await k.rpc('admin_follow_default', { p_member: ids.Dev, p_effective_from: await day(-1) })).error?.message).toMatch(/today or later/);
    expect((await k.rpc('admin_follow_default', { p_member: ids.Dev, p_effective_from: today })).error).toBeNull();
    ov = (await k.rpc('schedule_overview', {})).data.find((o: { member_id: string }) => o.member_id === ids.Dev);
    expect(ov).toMatchObject({ source: 'Team', follows_default: true, start_time: '12:00:00', break_minutes: 45 });
    // yesterday is unchanged
    const [y] = await days(-1, 'Dev');
    expect(localTime(y.scheduled_start)).toBe('10:00');
    // a personal schedule from today stops following
    expect((await k.rpc('admin_set_schedule', {
      p_member: ids.Dev, p_effective_from: today, p_start: '08:00', p_end: '16:00',
      p_days: [1, 2, 3, 4, 5, 6, 7], p_break: 30, p_grace: 5, p_timezone: TZ, p_note: '',
    })).error).toBeNull();
    ov = (await k.rpc('schedule_overview', {})).data.find((o: { member_id: string }) => o.member_id === ids.Dev);
    expect(ov).toMatchObject({ source: 'Personal', follows_default: false, start_time: '08:00:00' });
    // employees only see themselves
    const mine = (await z.rpc('schedule_overview', {})).data;
    expect(mine.map((o: { member_id: string }) => o.member_id)).toEqual([ids.Zinia]);
  });

  it('a new member follows the company default from the day they are added', async () => {
    await addDefault(null, -30, '09:15', '18:15');
    const id = (await db.query("insert into public.members (name) values ('Temp Person') returning id")).rows[0].id;
    const s = (await db.query('select follows_default, start_time::text, effective_from = private.today() as today from public.work_schedules where member_id = $1', [id])).rows;
    expect(s).toEqual([{ follows_default: true, start_time: '09:15:00', today: true }]);
  });
});

describe('exemptions', () => {
  it('no late or early flags while exempt, times still recorded, missed sign-ins still flagged', async () => {
    await db.query("insert into public.attendance_exemptions (member_id, start_date, note) values ($1, private.today() - 5, 'Field work')", [ids.Zinia]);
    await pastSession('Zinia', -3, '10:45', '17:00');
    const [r] = await days(-3, 'Zinia');
    expect(r).toMatchObject({ exempt: true, login_status: 'Exempt', logout_status: 'Logged Out', minutes_late: null, minutes_early: null });
    expect(localTime(r.first_login as string)).toBe('10:45');
    await refresh(-4, -2);
    expect(await flags('Zinia', 'Late Login')).toHaveLength(0);
    expect(await flags('Zinia', 'Early Logout')).toHaveLength(0);
    expect((await flags('Zinia', 'No Login')).length).toBe(2);
    // the day before the exemption started is judged as usual
    await pastSession('Zinia', -6, '10:45', '19:00');
    await refresh(-6);
    expect(await flags('Zinia', 'Late Login')).toHaveLength(1);
  });

  it('admins add and end exemptions; the end applies from tomorrow', async () => {
    const k = await login('Kartik');
    const z = await login('Zinia');
    const base = { p_member: ids.Dev, p_start: await day(0), p_end: null, p_note: 'Flexible hours agreed' };
    expect((await z.rpc('admin_add_exemption', base)).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('admin_add_exemption', { ...base, p_start: await day(-1) })).error?.message).toMatch(/today or later/);
    expect((await k.rpc('admin_add_exemption', { ...base, p_note: '' })).error?.message).toMatch(/why/);
    expect((await k.rpc('admin_add_exemption', { ...base, p_end: await day(-1) })).error?.message).toMatch(/end date is before/);
    const { data: id, error } = await k.rpc('admin_add_exemption', base);
    expect(error).toBeNull();
    const exempt = async (o: number) => (await db.query('select private.is_exempt($1, private.today() + $2::int) e', [ids.Dev, o])).rows[0].e;
    expect([await exempt(0), await exempt(30)]).toEqual([true, true]);
    expect((await k.rpc('admin_end_exemption', { p_id: id, p_note: 'Back to fixed hours' })).error).toBeNull();
    expect([await exempt(0), await exempt(1)]).toEqual([true, false]);
    expect((await k.rpc('admin_end_exemption', { p_id: id, p_note: '' })).error?.message).toMatch(/already ended/);
    // Zinia cannot read Dev's exemption
    expect((await z.from('attendance_exemptions').select('id')).data).toHaveLength(0);
  });
});

describe('exception decisions', () => {
  async function lateFlags() {
    for (const d of [-5, -4, -3]) await pastSession('Dev', d, '10:40', '19:00');
    await refresh(-5, -3);
    return (await flags('Dev', 'Late Login')).map((f) => f.id as string);
  }

  it('bulk approve decides each exception once, with history, and can be reopened', async () => {
    const ids3 = await lateFlags();
    expect(ids3).toHaveLength(3);
    const k = await login('Kartik');
    const z = await login('Zinia');
    expect((await z.rpc('decide_attendance_flags', { p_ids: ids3, p_decision: 'Approved', p_note: '' })).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('decide_attendance_flags', { p_ids: ids3, p_decision: 'Maybe', p_note: '' })).error?.message).toMatch(/Approve, Reject or Waive/);
    expect((await k.rpc('decide_attendance_flags', { p_ids: [], p_decision: 'Approved', p_note: '' })).error?.message).toMatch(/at least one/);

    const first = await k.rpc('decide_attendance_flags', { p_ids: ids3.slice(0, 2), p_decision: 'Approved', p_note: 'Traffic diversion' });
    expect(first.data).toEqual({ decided: 2, skipped: 0 });
    const again = await k.rpc('decide_attendance_flags', { p_ids: ids3.slice(0, 2), p_decision: 'Rejected', p_note: 'double click' });
    expect(again.data).toEqual({ decided: 0, skipped: 2 });
    const row = (await db.query('select status, decision, review_note, reviewed_by from public.attendance_flags where id = $1', [ids3[0]])).rows[0];
    expect(row).toEqual({ status: 'Resolved', decision: 'Approved', review_note: 'Traffic diversion', reviewed_by: ids.Kartik });

    // two admin tabs deciding the same exception at once: only one wins
    const k2 = await login('Kartik');
    const [a, b] = await Promise.all([
      k.rpc('decide_attendance_flags', { p_ids: [ids3[2]], p_decision: 'Waived', p_note: '' }),
      k2.rpc('decide_attendance_flags', { p_ids: [ids3[2]], p_decision: 'Rejected', p_note: '' }),
    ]);
    expect(a.data.decided + b.data.decided).toBe(1);
    expect((await db.query('select count(*)::int n from public.attendance_flag_actions where flag_id = $1', [ids3[2]])).rows[0].n).toBe(1);

    expect((await k.rpc('reopen_attendance_flag', { p_flag: ids3[0], p_note: 'Need more detail' })).error).toBeNull();
    const reopened = (await db.query('select status, decision from public.attendance_flags where id = $1', [ids3[0]])).rows[0];
    expect(reopened).toEqual({ status: 'Open', decision: null });

    const { data: q } = await k.rpc('attendance_exceptions', { p_from: await day(-10), p_to: await day(0), p_member: ids.Dev, p_type: 'Late Login' });
    const byId = new Map(q.map((x: { id: string }) => [x.id, x]));
    const h = (byId.get(ids3[0]) as { history: { action: string; actor: string; note: string }[] }).history;
    expect(h.map((x) => x.action)).toEqual(['Approved', 'Reopened']);
    expect(h[0]).toMatchObject({ actor: 'Kartik', note: 'Traffic diversion' });
    const approved = await k.rpc('attendance_exceptions', { p_from: await day(-10), p_to: await day(0), p_status: 'Approved' });
    expect(approved.data.map((x: { id: string }) => x.id)).toEqual([ids3[1]]);
    const open = await k.rpc('attendance_exceptions', { p_from: await day(-10), p_to: await day(0), p_status: 'Open', p_member: ids.Dev });
    expect(open.data.map((x: { id: string }) => x.id)).toContain(ids3[0]);
  });

  it('filters by team; employees see only their own exceptions', async () => {
    await lateFlags();
    const ops = await addTeam('Operations');
    const other = await addTeam('Design');
    await db.query('insert into public.member_teams (member_id, team_id, effective_from) values ($1, $2, private.today() - 30)', [ids.Dev, ops]);
    const k = await login('Kartik');
    const range = { p_from: await day(-10), p_to: await day(0) };
    const inOps = (await k.rpc('attendance_exceptions', { ...range, p_team: ops })).data;
    expect(inOps.length).toBeGreaterThan(0);
    expect(inOps.every((x: { member_id: string; team_name: string }) => x.member_id === ids.Dev && x.team_name === 'Operations')).toBe(true);
    expect((await k.rpc('attendance_exceptions', { ...range, p_team: other })).data).toHaveLength(0);
    const z = await login('Zinia');
    expect((await z.rpc('attendance_exceptions', { ...range, p_member: ids.Dev })).error?.message).toMatch(/only view your own/);
    expect((await z.rpc('attendance_exceptions', range)).data.every((x: { member_id: string }) => x.member_id === ids.Zinia)).toBe(true);
    const d = await login('Dev');
    expect((await d.rpc('attendance_exceptions', range)).data.every((x: { member_id: string }) => x.member_id === ids.Dev)).toBe(true);
    expect((await d.rpc('decide_attendance_flags', { p_ids: [inOps[0].id], p_decision: 'Waived', p_note: '' })).error?.message).toMatch(/Only an admin/);
  });

  it('approved and waived lateness does not count towards a repeated flag', async () => {
    for (const d of [-9, -6]) await pastSession('Sanket', d, '10:30', '19:00');
    await refresh(-9, -6);
    const [firstFlag] = await flags('Sanket', 'Late Login');
    const k = await login('Kartik');
    await k.rpc('decide_attendance_flags', { p_ids: [firstFlag.id], p_decision: 'Waived', p_note: 'Known outage' });
    await pastSession('Sanket', -3, '10:30', '19:00');
    await refresh(-3);
    expect(await flags('Sanket', 'Late Login')).toHaveLength(3);
    expect(await flags('Sanket', 'Repeated Late Login')).toHaveLength(0);
  });

  it('the older one-at-a-time review is recorded in the history too', async () => {
    const [id] = await lateFlags();
    const k = await login('Kartik');
    await k.rpc('review_attendance_flag', { p_flag: id, p_status: 'Reviewed', p_note: 'Asked Dev' });
    await k.rpc('review_attendance_flag', { p_flag: id, p_status: 'Resolved', p_note: 'Fine' });
    await k.rpc('decide_attendance_flags', { p_ids: [id], p_decision: 'Approved', p_note: 'already resolved' });
    await k.rpc('review_attendance_flag', { p_flag: id, p_status: 'Open', p_note: '' });
    const h = (await db.query('select action from public.attendance_flag_actions where flag_id = $1 order by created_at', [id])).rows;
    expect(h.map((x) => x.action)).toEqual(['Reviewed', 'Resolved', 'Reopened']);
  });
});

describe('breaks', () => {
  it('start and end a break while signed in; repeats change nothing; signing out ends a running break', async () => {
    const z = await login('Zinia');
    const s1 = await z.rpc('start_break', { p_note: '' });
    expect(s1.error).toBeNull();
    expect(s1.data.already_running).toBe(false);
    expect((await z.rpc('start_break', { p_note: '' })).data).toMatchObject({ id: s1.data.id, already_running: true });
    const today = await day(0);
    let me = (await z.rpc('attendance_days_report', { p_from: today, p_to: today })).data[0];
    expect(me).toMatchObject({ on_break: true, break_count: 1, open_session: true });
    const e1 = await z.rpc('end_break');
    expect(e1.data.id).toBe(s1.data.id);
    expect((await z.rpc('end_break')).data.id).toBeNull();
    me = (await z.rpc('attendance_days_report', { p_from: today, p_to: today })).data[0];
    expect(me).toMatchObject({ on_break: false, break_count: 1 });

    await z.rpc('start_break', { p_note: '' });
    const z2 = await login('Zinia');
    await z.rpc('end_session');
    const open = (await db.query('select count(*)::int n from public.attendance_breaks where member_id = $1 and end_at is null', [ids.Zinia])).rows[0].n;
    expect(open).toBe(0);
    // still PIN-verified on a second device, but the work session has ended
    expect((await z2.rpc('start_break', { p_note: '' })).error?.message).toMatch(/work session has ended/);
    expect((await anonClient().rpc('start_break', { p_note: '' })).error).not.toBeNull();
  });

  it('worked time subtracts breaks inside signed-in time; long breaks are flagged unless exempt', async () => {
    await pastSession('Dev', -2, '10:00', '19:00');
    await pastBreak('Dev', -2, '13:00', '14:00');
    let [r] = await days(-2, 'Dev');
    expect(r).toMatchObject({ worked_minutes: 480, break_taken_minutes: 60, break_count: 1 });
    // a break that runs past the sign-out only subtracts the part inside signed-in time
    await pastBreak('Dev', -2, '18:30', '19:30');
    [r] = await days(-2, 'Dev');
    expect(r).toMatchObject({ worked_minutes: 450, break_taken_minutes: 120, break_count: 2 });
    await refresh(-2);
    const [lb] = await flags('Dev', 'Long Break');
    expect(lb).toMatchObject({ minutes: 60 });
    expect(lb.reason).toMatch(/120 min against an allowance of 60 min \(plus 10 min grace\)/);
    // within allowance + grace: no flag
    await pastSession('Shruti', -2, '10:00', '19:00');
    await pastBreak('Shruti', -2, '13:00', '14:10');
    await refresh(-2);
    expect(await flags('Shruti', 'Long Break')).toHaveLength(0);
    // exempt: no flag
    await db.query("insert into public.attendance_exemptions (member_id, start_date, note) values ($1, private.today() - 5, 'Flexible')", [ids.Sanket]);
    await pastSession('Sanket', -2, '10:00', '19:00');
    await pastBreak('Sanket', -2, '12:00', '15:00');
    await refresh(-2);
    expect(await flags('Sanket', 'Long Break')).toHaveLength(0);
  });

  it('breaks entered by hand: employees today only, admins up to 60 days back; no overlaps; admins can remove one', async () => {
    await pastSession('Dev', -2, '10:00', '19:00');
    const k = await login('Kartik');
    const d = await login('Dev');
    const date = await day(-2);
    const add = (c: typeof k, start: string, end: string, extra: Record<string, unknown> = {}) =>
      c.rpc('add_attendance_break', { p_member: ids.Dev, p_date: date, p_start: start, p_end: end, p_note: 'Missed the button', ...extra });
    expect((await add(d, '13:00', '13:30')).error?.message).toMatch(/today only/);
    expect((await add(k, '09:00', '09:30')).error?.message).toMatch(/between the first sign-in/);
    expect((await add(k, '13:30', '13:00')).error?.message).toMatch(/end after it starts/);
    const { data: id, error } = await add(k, '13:00', '13:45');
    expect(error).toBeNull();
    expect((await add(k, '13:30', '14:00')).error?.message).toMatch(/overlaps/);
    expect((await add(k, '14:00', '14:30', { p_date: await day(1) })).error?.message).toMatch(/today or earlier/);
    expect((await add(k, '14:00', '14:30', { p_date: await day(-61) })).error?.message).toMatch(/last 60 days/);
    expect((await d.rpc('add_attendance_break', { p_member: ids.Zinia, p_date: await day(0), p_start: '10:00', p_end: '10:10', p_note: '' })).error?.message).toMatch(/Only an admin/);
    let [r] = await days(-2, 'Dev');
    expect(r).toMatchObject({ worked_minutes: 495, break_taken_minutes: 45 });
    expect((await d.rpc('void_attendance_break', { p_id: id, p_note: 'mistake' })).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('void_attendance_break', { p_id: id, p_note: '' })).error?.message).toMatch(/why/);
    expect((await k.rpc('void_attendance_break', { p_id: id, p_note: 'Entered for the wrong day' })).error).toBeNull();
    [r] = await days(-2, 'Dev');
    expect(r).toMatchObject({ worked_minutes: 540, break_taken_minutes: 0, break_count: 0 });
    expect((await db.query('select count(*)::int n from public.attendance_breaks where id = $1 and voided_at is not null', [id])).rows[0].n).toBe(1);

    // an employee's own missed break today, inside their signed-in time
    const hour = (await db.query(`select extract(hour from now() at time zone $1)::int h`, [TZ])).rows[0].h;
    const zl = await login('Zinia');
    expect((await zl.rpc('add_attendance_break', { p_member: null, p_date: await day(0), p_start: '00:00', p_end: '00:01', p_note: '' })).error?.message)
      .toMatch(/between the first sign-in/);
    if (hour >= 3) {
      await db.query("update public.attendance_sessions set login_at = now() - interval '2 hours' where member_id = $1", [ids.Zinia]);
      const t = (await db.query(
        `select to_char(now() at time zone $1 - interval '90 minutes', 'HH24:MI') a, to_char(now() at time zone $1 - interval '60 minutes', 'HH24:MI') b`, [TZ],
      )).rows[0];
      expect((await zl.rpc('add_attendance_break', { p_member: null, p_date: await day(0), p_start: t.a, p_end: t.b, p_note: '' })).error).toBeNull();
    }
    // nobody writes the table directly
    expect((await zl.from('attendance_breaks').insert({ member_id: ids.Zinia, work_date: await day(0), start_at: new Date().toISOString() } as never)).error).not.toBeNull();
    expect((await zl.from('attendance_breaks').select('member_id')).data!.every((b: { member_id: string }) => b.member_id === ids.Zinia)).toBe(true);
  });
});

describe('late logout', () => {
  it('is off by default and flags sign-outs past the chosen threshold once switched on', async () => {
    await pastSession('Dev', -2, '10:00', '20:30');
    await refresh(-2);
    expect(await flags('Dev', 'Late Logout')).toHaveLength(0);
    const k = await login('Kartik');
    const z = await login('Zinia');
    expect((await z.rpc('admin_update_attendance_settings', { p_late_logout_minutes: 60, p_long_break_grace: 10 })).error?.message).toMatch(/Only an admin/);
    expect((await k.rpc('admin_update_attendance_settings', { p_late_logout_minutes: 5, p_long_break_grace: 10 })).error?.message).toMatch(/between 15 and 600/);
    expect((await k.rpc('admin_update_attendance_settings', { p_late_logout_minutes: 60, p_long_break_grace: 10 })).error).toBeNull();
    await pastSession('Shruti', -2, '10:00', '20:30');
    await pastSession('Sanket', -2, '10:00', '19:45');
    await refresh(-2);
    const [f] = await flags('Shruti', 'Late Logout');
    expect(f).toMatchObject({ minutes: 90 });
    expect(await flags('Sanket', 'Late Logout')).toHaveLength(0);
  });
});
