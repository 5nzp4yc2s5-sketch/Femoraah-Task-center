import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anonClient, db, login, memberId, provision, resetData } from './helpers';

// Phase 3: company profile and branding, daily quotes, and weekly-off swaps.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};
const TZ = 'Asia/Kolkata';
const MON_TO_SAT = '{1,2,3,4,5,6}';
// 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}

/** A date relative to today, as text. */
async function day(offset: number): Promise<string> {
  return (await sql<{ d: string }>(`select (private.today() + $1::int)::text as d`, [offset]))[0].d;
}

/** The most recent Sunday before today, and the Wednesday after it (both as offsets from today). */
async function lastSundayOffset(): Promise<number> {
  return -(await sql<{ n: number }>(`select extract(isodow from private.today())::int as n`))[0].n;
}

async function quotes(): Promise<{ id: string; body: string; sort_order: number; is_active: boolean }[]> {
  return sql('select id, body, sort_order, is_active from public.quotes order by sort_order, created_at');
}

async function resetQuotes(n: number) {
  await db.query('delete from public.quote_days');
  await db.query('delete from public.quotes');
  for (let i = 1; i <= n; i++) {
    await db.query(`insert into public.quotes (body, author, sort_order) values ($1, 'Test', $2)`, [`Quote ${i}`, i]);
  }
}

beforeAll(async () => {
  await resetData();
  for (const n of TEAM) await provision(n);
  for (const n of TEAM) ids[n] = await memberId(n);
}, 60_000);

beforeEach(async () => {
  await resetData();
  for (const n of TEAM) {
    await db.query('delete from public.work_schedules where member_id = $1', [ids[n]]);
    await db.query(
      `insert into public.work_schedules (member_id, effective_from, start_time, end_time, working_days, break_minutes, grace_minutes, timezone)
       values ($1, private.today() - 60, '10:00', '19:00', $2, 60, 10, $3)`,
      [ids[n], MON_TO_SAT, TZ],
    );
  }
});

afterAll(async () => {
  await resetData();
  await db.query('delete from public.work_schedules');
  await db.query('select private.default_schedule(id) from public.members where is_active');
  await db.end();
});

describe('company profile and branding', () => {
  it('starts empty, so the app keeps its default look, and is readable before sign-in', async () => {
    const { data, error } = await anonClient().rpc('brand_settings');
    expect(error).toBeNull();
    expect(data).toEqual({});
    const logo = await anonClient().rpc('brand_logo');
    expect(logo.error).toBeNull();
    expect(logo.data).toEqual([]);
  });

  it('lets the admin save the name, tagline and colours, and nobody else', async () => {
    const k = await login('Kartik');
    const { error } = await k.rpc('admin_update_branding', {
      p_company_name: '  Femoraah  ', p_tagline: 'Ops command center', p_primary: '#1F3A5F', p_secondary: '#0f1f35', p_accent: '',
    });
    expect(error).toBeNull();
    const { data } = await anonClient().rpc('brand_settings');
    expect(data).toMatchObject({ company_name: 'Femoraah', tagline: 'Ops command center', primary: '#1f3a5f', secondary: '#0f1f35', accent: null, logo_version: null });

    const z = await login('Zinia');
    const denied = await z.rpc('admin_update_branding', { p_company_name: 'X', p_tagline: '', p_primary: '', p_secondary: '', p_accent: '' });
    expect(denied.error?.code).toBe('42501');
    const bad = await k.rpc('admin_update_branding', { p_company_name: 'X', p_tagline: '', p_primary: 'red', p_secondary: '', p_accent: '' });
    expect(bad.error?.message).toMatch(/Colours must be written like/);

    // Only the admin reads the table directly; everyone else sees nothing.
    expect((await z.from('company_profile').select('*')).data).toEqual([]);
    expect((await k.from('company_profile').select('company_name')).data).toEqual([{ company_name: 'Femoraah' }]);
    expect((await anonClient().from('company_profile').select('*')).error).not.toBeNull();
  });

  it('accepts a real PNG logo, rejects anything else, and can remove it', async () => {
    const k = await login('Kartik');
    expect((await k.rpc('admin_set_logo', { p_mime: 'image/png', p_data: PNG })).error).toBeNull();
    const logo = await anonClient().rpc('brand_logo');
    expect(logo.data).toEqual([{ mime: 'image/png', data: PNG }]);
    expect((await anonClient().rpc('brand_settings')).data.logo_version).toEqual(expect.any(Number));

    // Declared as JPEG but the bytes are a PNG.
    expect((await k.rpc('admin_set_logo', { p_mime: 'image/jpeg', p_data: PNG })).error?.message).toMatch(/not a valid PNG, JPEG or WebP/);
    // SVG can carry scripts, so it is never accepted.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect((await k.rpc('admin_set_logo', { p_mime: 'image/svg+xml', p_data: svg })).error?.message).toMatch(/PNG, JPEG or WebP/);
    expect((await k.rpc('admin_set_logo', { p_mime: 'image/png', p_data: 'A'.repeat(409_601) })).error?.message).toMatch(/300 KB/);
    expect((await k.rpc('admin_set_logo', { p_mime: 'image/png', p_data: '!!!not base64' })).error?.message).toMatch(/could not be read|not a valid/);
    const z = await login('Zinia');
    expect((await z.rpc('admin_set_logo', { p_mime: 'image/png', p_data: PNG })).error?.code).toBe('42501');

    // The logo saved first is still there after the rejected attempts.
    expect((await anonClient().rpc('brand_logo')).data).toEqual([{ mime: 'image/png', data: PNG }]);
    expect((await k.rpc('admin_set_logo', { p_mime: null, p_data: null })).error).toBeNull();
    expect((await anonClient().rpc('brand_logo')).data).toEqual([]);
  });

  it('keeps the logo when the colours change, and the colours when the logo changes', async () => {
    const k = await login('Kartik');
    await k.rpc('admin_set_logo', { p_mime: 'image/png', p_data: PNG });
    await k.rpc('admin_update_branding', { p_company_name: 'A', p_tagline: '', p_primary: '#123456', p_secondary: '', p_accent: '' });
    expect((await anonClient().rpc('brand_logo')).data).toHaveLength(1);
    await k.rpc('admin_set_logo', { p_mime: 'image/png', p_data: PNG });
    expect((await anonClient().rpc('brand_settings')).data).toMatchObject({ company_name: 'A', primary: '#123456' });
    const audit = await sql(`select action from public.audit_events where entity = 'company_profile' order by id desc limit 3`);
    expect(audit.map((a) => a.action)).toEqual(['logo_updated', 'branding_updated', 'logo_updated']);
  });
});

describe('daily quotes', () => {
  it('ships with 20 starter quotes', async () => {
    // Other tests add or replace quotes, so this only applies to a freshly migrated database
    // (the starter set is inserted in one statement, so it shares one created_at).
    if ((await sql(`select 1 from public.quotes where created_at <> (select min(created_at) from public.quotes) limit 1`)).length) return;
    const rows = await sql(`select count(*)::int as n, count(*) filter (where author <> '' and is_active)::int as ok from public.quotes`);
    expect(rows[0]).toEqual({ n: 20, ok: 20 });
  });

  it('shows everyone the same quote today', async () => {
    await resetQuotes(3);
    const a = await (await login('Zinia')).rpc('quote_of_the_day');
    const b = await (await login('Dev')).rpc('quote_of_the_day');
    expect(a.error).toBeNull();
    expect(a.data).toHaveLength(1);
    expect(b.data).toEqual(a.data);
    expect(a.data[0].body).toBe('Quote 1');
    expect((await sql('select * from public.quote_days')).length).toBe(1);
  });

  it('does not repeat a quote until every active quote has been shown', async () => {
    await resetQuotes(3);
    const [q1, q2, q3] = await quotes();
    // Quote 1 and 3 were shown on the last two days, so today it is quote 2.
    await db.query('insert into public.quote_days (day, quote_id) values (private.today() - 2, $1), (private.today() - 1, $2)', [q1.id, q3.id]);
    expect((await (await login('Zinia')).rpc('quote_of_the_day')).data[0].body).toBe('Quote 2');
    // Once all three have been shown, the cycle starts again in list order.
    await db.query('delete from public.quote_days where day = private.today()');
    await db.query('insert into public.quote_days (day, quote_id) values (private.today() - 3, $1)', [q2.id]);
    expect((await (await login('Zinia')).rpc('quote_of_the_day')).data[0].body).toBe('Quote 1');
  });

  it('skips archived quotes, and replaces today\'s quote if it gets archived', async () => {
    await resetQuotes(2);
    const k = await login('Kartik');
    const z = await login('Zinia');
    expect((await z.rpc('quote_of_the_day')).data[0].body).toBe('Quote 1');
    const [q1] = await quotes();
    expect((await k.rpc('admin_set_quote_active', { p_id: q1.id, p_active: false })).error).toBeNull();
    expect((await z.rpc('quote_of_the_day')).data[0].body).toBe('Quote 2');
    await k.rpc('admin_set_quote_active', { p_id: (await quotes())[1].id, p_active: false });
    expect((await z.rpc('quote_of_the_day')).data).toEqual([]);
    // Archived quotes are kept, never deleted, and can come back.
    expect((await quotes()).length).toBe(2);
    expect((await k.rpc('admin_set_quote_active', { p_id: q1.id, p_active: true })).error).toBeNull();
    expect((await z.rpc('quote_of_the_day')).data[0].body).toBe('Quote 1');
  });

  it('lets the admin add, edit and reorder quotes, and nobody else', async () => {
    await resetQuotes(2);
    const k = await login('Kartik');
    const added = await k.rpc('admin_save_quote', { p_id: null, p_body: '  Keep going.  ', p_author: 'Team' });
    expect(added.error).toBeNull();
    let list = await quotes();
    expect(list.map((q) => q.body)).toEqual(['Quote 1', 'Quote 2', 'Keep going.']);
    expect((await k.rpc('admin_save_quote', { p_id: added.data, p_body: 'Keep going!', p_author: 'Team' })).error).toBeNull();
    expect((await k.rpc('admin_move_quote', { p_id: added.data, p_up: true })).error).toBeNull();
    list = await quotes();
    expect(list.map((q) => q.body)).toEqual(['Quote 1', 'Keep going!', 'Quote 2']);
    // Moving the first one up does nothing.
    await k.rpc('admin_move_quote', { p_id: list[0].id, p_up: true });
    expect((await quotes()).map((q) => q.body)).toEqual(['Quote 1', 'Keep going!', 'Quote 2']);
    expect((await k.rpc('admin_save_quote', { p_id: null, p_body: '   ', p_author: '' })).error?.message).toMatch(/up to 300 characters/);

    const z = await login('Zinia');
    expect((await z.rpc('admin_save_quote', { p_id: null, p_body: 'x', p_author: '' })).error?.code).toBe('42501');
    expect((await z.rpc('admin_move_quote', { p_id: list[0].id, p_up: false })).error?.code).toBe('42501');
    expect((await z.rpc('admin_set_quote_active', { p_id: list[0].id, p_active: false })).error?.code).toBe('42501');
    expect((await z.from('quotes').select('*')).data).toEqual([]);
    expect((await k.from('quotes').select('id')).data).toHaveLength(3);
  });

  it('needs a verified sign-in', async () => {
    const { error } = await anonClient().rpc('quote_of_the_day');
    expect(error).not.toBeNull();
  });
});

describe('weekly-off swaps', () => {
  it('lets a person swap a weekly off: that Sunday becomes a working day and the swap day is leave', async () => {
    const sun = await lastSundayOffset();
    const sunday = await day(sun);
    const wednesday = await day(sun + 10); // a Wednesday after today (Sunday + 10 days)
    const z = await login('Zinia');

    const before = await (await login('Kartik')).rpc('attendance_days_report', { p_from: sunday, p_to: sunday, p_member: ids.Zinia });
    expect(before.data[0].day_type).toBe('Weekly Off');

    const ins = await z.from('leaves').insert({
      member_id: ids.Zinia, leave_type: 'Holiday Swap', start_date: wednesday, end_date: wednesday, swap_for_date: sunday,
    });
    expect(ins.error).toBeNull();
    const after = await (await login('Kartik')).rpc('attendance_days_report', { p_from: sunday, p_to: sunday, p_member: ids.Zinia });
    expect(after.data[0]).toMatchObject({ day_type: 'Working Day', login_status: 'Not Logged In' });
    // Nobody else's Sunday changes.
    const dev = await (await login('Kartik')).rpc('attendance_days_report', { p_from: sunday, p_to: sunday, p_member: ids.Dev });
    expect(dev.data[0].day_type).toBe('Weekly Off');
  });

  it('counts a Sunday already worked before the swap was recorded', async () => {
    const sun = await lastSundayOffset();
    const sunday = await day(sun);
    // Zinia signed in on Sunday at 10:30: recorded then as a weekly off.
    await db.query(
      `insert into public.attendance_sessions (record_id, member_id, work_date, login_at, logout_at, logout_source)
       values (private.attendance_record_for($1, $2::date), $1, $2::date, ($2::date + time '10:30') at time zone $3,
               ($2::date + time '19:05') at time zone $3, 'sign_out')`,
      [ids.Zinia, sunday, TZ],
    );
    expect((await sql('select is_working_day from public.attendance_records where member_id = $1 and work_date = $2', [ids.Zinia, sunday]))[0].is_working_day).toBe(false);
    const k = await login('Kartik');
    expect((await k.from('leaves').insert({
      member_id: ids.Zinia, leave_type: 'Holiday Swap', start_date: await day(1), end_date: await day(1), swap_for_date: sunday,
    })).error).toBeNull();
    const row = (await k.rpc('attendance_days_report', { p_from: sunday, p_to: sunday, p_member: ids.Zinia })).data[0];
    expect(row).toMatchObject({ day_type: 'Working Day', login_status: 'Late', minutes_late: 30 });
    // The stored record itself is not rewritten.
    expect((await sql('select is_working_day from public.attendance_records where member_id = $1 and work_date = $2', [ids.Zinia, sunday]))[0].is_working_day).toBe(false);
  });

  it('records a future swapped Sunday as a working day when the person signs in', async () => {
    const nextSunday = (await lastSundayOffset()) + 7;
    const k = await login('Kartik');
    expect((await k.from('leaves').insert({
      member_id: ids.Dev, leave_type: 'Holiday Swap', start_date: await day(nextSunday + 2), end_date: await day(nextSunday + 2),
      swap_for_date: await day(nextSunday),
    })).error).toBeNull();
    const id = (await sql<{ id: string }>(`select private.attendance_record_for($1, $2::date) as id`, [ids.Dev, await day(nextSunday)]))[0].id;
    const rec = await sql<{ is_working_day: boolean }>('select is_working_day from public.attendance_records where id = $1', [id]);
    expect(rec[0].is_working_day).toBe(true);
  });

  it('still swaps company holidays as before', async () => {
    const k = await login('Kartik');
    const wed = (await lastSundayOffset()) + 3; // the Wednesday before or after today, a working day
    const holiday = await day(wed + 7);
    await k.from('holidays').insert({ holiday_date: holiday, name: 'Festival' });
    const ins = await (await login('Sanket')).from('leaves').insert({
      member_id: ids.Sanket, leave_type: 'Holiday Swap', start_date: await day(wed + 8), end_date: await day(wed + 8), swap_for_date: holiday,
    });
    expect(ins.error).toBeNull();
  });

  it('refuses a working day, a day inside the leave, and a second swap of the same day', async () => {
    const sun = await lastSundayOffset();
    const z = await login('Zinia');
    const workday = await day(sun + 10); // a Wednesday
    const leaveDay = await day(sun + 11);
    const r1 = await z.from('leaves').insert({ member_id: ids.Zinia, leave_type: 'Holiday Swap', start_date: leaveDay, end_date: leaveDay, swap_for_date: workday });
    expect(r1.error?.message).toMatch(/is not a company holiday or a weekly off for this person/);

    const sunday2 = await day(sun + 14);
    const r2 = await z.from('leaves').insert({ member_id: ids.Zinia, leave_type: 'Holiday Swap', start_date: await day(sun + 13), end_date: await day(sun + 15), swap_for_date: sunday2 });
    expect(r2.error?.message).toMatch(/cannot fall inside the leave dates/);

    expect((await z.from('leaves').insert({ member_id: ids.Zinia, leave_type: 'Holiday Swap', start_date: leaveDay, end_date: leaveDay, swap_for_date: sunday2 })).error).toBeNull();
    const r3 = await z.from('leaves').insert({ member_id: ids.Zinia, leave_type: 'Holiday Swap', start_date: await day(sun + 12), end_date: await day(sun + 12), swap_for_date: sunday2 });
    expect(r3.error?.message).toMatch(/already has a Holiday Swap/);
  });

  it('never blocks editing an existing leave whose dates and swap day stay the same', async () => {
    const sun = await lastSundayOffset();
    const leaveDay = await day(sun + 11);
    // A row from before this check existed, naming a day that is not a holiday or weekly off.
    await db.query('alter table public.leaves disable trigger leaves_swap_guard');
    await db.query(
      `insert into public.leaves (member_id, leave_type, start_date, end_date, swap_for_date, created_by)
       values ($1, 'Holiday Swap', $2, $2, $3, $1)`,
      [ids.Zinia, leaveDay, await day(sun + 10)],
    );
    await db.query('alter table public.leaves enable trigger leaves_swap_guard');
    const k = await login('Kartik');
    const { data, error } = await k.from('leaves').update({ note: 'Covering the Diwali rush' }).eq('member_id', ids.Zinia).select('note');
    expect(error).toBeNull();
    expect(data).toEqual([{ note: 'Covering the Diwali rush' }]);
  });
});
