import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, login, memberId, provision, resetData } from './helpers';

// Phase 4a: Super Admin / Admin / Employee with admin areas, and the Google Sheets workspace.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};
const SHEET = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0';
const SHEET2 = 'https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210/edit';

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}

async function makeAdmin(name: string) {
  await db.query(`update public.members set access_role = 'manager' where name = $1`, [name]);
}

function sheetArgs(over: Record<string, unknown> = {}) {
  return {
    p_id: null, p_name: 'Daily orders', p_purpose: 'Orders to pack today', p_category: 'Operations', p_team: null,
    p_owner: null, p_people: [], p_url: SHEET, p_visibility: 'everyone', ...over,
  };
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
  await resetData();
  await db.end();
});

describe('admin areas', () => {
  it('gives the Super Admin every area and nobody else any, so nothing changes until areas are given', async () => {
    await makeAdmin('Shruti');
    const k = await login('Kartik');
    expect((await k.rpc('my_admin_areas')).data).toEqual(['attendance', 'settings', 'sheets', 'credentials']);
    const s = await login('Shruti');
    expect((await s.rpc('my_admin_areas')).data).toEqual([]);
    const z = await login('Zinia');
    expect((await z.rpc('my_admin_areas')).data).toEqual([]);

    // An Admin without areas is refused exactly as before.
    const today = (await sql<{ d: string }>('select private.today()::text as d'))[0].d;
    const ex = await s.rpc('attendance_exceptions', { p_from: today, p_to: today, p_member: ids.Dev });
    expect(ex.error?.code).toBe('42501');
    const brand = await s.rpc('admin_update_branding', { p_company_name: 'X', p_tagline: '', p_primary: '', p_secondary: '', p_accent: '' });
    expect(brand.error?.code).toBe('42501');
  });

  it('lets the Super Admin give an Admin the attendance area, which opens attendance and nothing else', async () => {
    await makeAdmin('Shruti');
    const today = (await sql<{ d: string }>('select private.today()::text as d'))[0].d;
    await db.query(
      `insert into public.attendance_flags (member_id, work_date, flag_type, minutes, reason) values ($1, $2, 'Late Login', 20, 'test')`,
      [ids.Dev, today],
    );
    const k = await login('Kartik');
    expect((await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['attendance'] })).error).toBeNull();

    const s = await login('Shruti');
    expect((await s.rpc('my_admin_areas')).data).toEqual(['attendance']);
    const ex = await s.rpc('attendance_exceptions', { p_from: today, p_to: today, p_member: ids.Dev });
    expect(ex.error).toBeNull();
    const flags = await s.from('attendance_flags').select('member_id');
    expect(flags.data?.map((f) => f.member_id)).toContain(ids.Dev);
    const decide = await s.rpc('decide_attendance_flags', { p_ids: [(await sql<{ id: string }>('select id from public.attendance_flags'))[0].id], p_decision: 'Waived', p_note: 'ok' });
    expect(decide.error).toBeNull();
    expect((await s.rpc('admin_save_team', { p_id: null, p_name: 'Warehouse' })).error).toBeNull();

    // Still no company settings, sheets admin or Super Admin powers (adding a sheet is open to everyone).
    const brand = await s.rpc('admin_update_branding', { p_company_name: 'X', p_tagline: '', p_primary: '', p_secondary: '', p_accent: '' });
    expect(brand.error?.code).toBe('42501');
    const sheet = await s.rpc('sheet_save', sheetArgs());
    expect(sheet.error).toBeNull();
    expect((await s.rpc('sheet_set_archived', { p_id: sheet.data, p_archived: true })).error?.code).toBe('42501');
    expect((await s.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['settings'] })).error?.code).toBe('42501');
    expect((await s.rpc('admin_set_pin', { p_member: ids.Dev, p_pin: '999' })).error?.code).toBe('42501');

    const audit = await sql<{ details: { added: string[] } }>(
      `select details from public.audit_events where action = 'admin_areas_changed' and entity_id = $1 order by created_at desc, id desc limit 1`, [ids.Shruti]);
    expect(audit[0].details.added).toEqual(['attendance']);
  });

  it('opens company settings and quotes with the settings area', async () => {
    await makeAdmin('Shruti');
    const k = await login('Kartik');
    await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['settings'] });
    const s = await login('Shruti');
    const brand = await s.rpc('admin_update_branding', { p_company_name: 'Femoraah', p_tagline: '', p_primary: '', p_secondary: '', p_accent: '' });
    expect(brand.error).toBeNull();
    expect((await s.rpc('admin_save_quote', { p_id: null, p_body: 'Keep going.', p_author: '' })).error).toBeNull();
    expect((await s.from('quotes').select('id')).data!.length).toBeGreaterThan(0);
    const today = (await sql<{ d: string }>('select private.today()::text as d'))[0].d;
    expect((await s.rpc('attendance_exceptions', { p_from: today, p_to: today, p_member: ids.Dev })).error?.code).toBe('42501');
  });

  it('only gives areas to active Admins, and refuses unknown areas', async () => {
    const k = await login('Kartik');
    const emp = await k.rpc('admin_set_areas', { p_member: ids.Zinia, p_areas: ['sheets'] });
    expect(emp.error?.message).toMatch(/active Admin/);
    await makeAdmin('Shruti');
    const bad = await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['payroll'] });
    expect(bad.error?.message).toMatch(/Unknown admin area/);
  });

  it('keeps revoked areas in history, and removes areas when someone stops being an active Admin', async () => {
    await makeAdmin('Shruti');
    const k = await login('Kartik');
    await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['attendance', 'sheets'] });
    await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['sheets'] });
    let rows = await sql<{ area: string; revoked: boolean }>(
      `select area, revoked_at is not null as revoked from public.admin_area_grants where member_id = $1 order by granted_at, area`, [ids.Shruti]);
    expect(rows).toEqual([{ area: 'attendance', revoked: true }, { area: 'sheets', revoked: false }]);

    // Made an Employee: every area goes. Made an Admin again: none come back.
    await db.query(`update public.members set access_role = 'member' where id = $1`, [ids.Shruti]);
    await makeAdmin('Shruti');
    const s = await login('Shruti');
    expect((await s.rpc('my_admin_areas')).data).toEqual([]);

    await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['sheets'] });
    await db.query(`update public.members set is_active = false where id = $1`, [ids.Shruti]);
    rows = await sql(`select area from public.admin_area_grants where member_id = $1 and revoked_at is null`, [ids.Shruti]);
    expect(rows).toEqual([]);
    expect((await sql('select count(*)::int as n from public.admin_area_grants where member_id = $1', [ids.Shruti]))[0]).toEqual({ n: 3 });
  });

  it('changed only the admin check inside the 24 attendance and settings functions', async () => {
    const rows = await sql<{ fn: string; has_area: boolean; is_admin: boolean }>(`
      select fn, def like '%private.has_area(%' as has_area, def like '%private.is_admin()%' as is_admin
        from (select p.proname as fn, case when p.prokind = 'f' then pg_get_functiondef(p.oid) end as def
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname not like 'sheet\\_%' and p.proname not like 'cred\\_%') x
       where def like '%private.has_area(%'`);
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => r.has_area && !r.is_admin)).toBe(true);
  });
});

describe('Google Sheets workspace', () => {
  it('lets a Sheets admin add a real Google Sheets link and refuses anything else', async () => {
    const k = await login('Kartik');
    const { data: id, error } = await k.rpc('sheet_save', sheetArgs({ p_owner: ids.Dev, p_people: [ids.Dev, ids.Zinia, ids.Dev] }));
    expect(error).toBeNull();
    const row = (await sql<{ people: string[]; created_by: string }>('select people, created_by from public.work_sheets where id = $1', [id]))[0];
    expect(row.people.sort()).toEqual([ids.Dev, ids.Zinia].sort());
    expect(row.created_by).toBe(ids.Kartik);

    for (const url of [
      'http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
      'https://docs.google.com.evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'javascript:alert(1)',
      'https://docs.google.com/spreadsheets/d/short',
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit"><script>',
    ]) {
      const bad = await k.rpc('sheet_save', sheetArgs({ p_url: url, p_name: 'Bad' }));
      expect(bad.error?.message, url).toMatch(/full Google Sheets link/);
    }
    const dup = await k.rpc('sheet_save', sheetArgs({ p_name: 'Again' }));
    expect(dup.error?.message).toMatch(/already in the workspace/);
    // The same spreadsheet with a different ending (tab, sharing link) is still a duplicate.
    for (const url of [SHEET.replace('/edit#gid=0', ''), SHEET.replace('#gid=0', '?usp=sharing'), SHEET.replace('gid=0', 'gid=123')]) {
      const again = await k.rpc('sheet_save', sheetArgs({ p_name: 'Again', p_url: url }));
      expect(again.error?.message, url).toMatch(/already in the workspace/);
    }
    // The table cannot be written directly.
    const direct = await k.from('work_sheets').insert({ name: 'x', url: SHEET2 });
    expect(direct.error).not.toBeNull();
  });

  it('shows "everyone" sheets to all, and "assigned" sheets only to the people on them, their team and admins', async () => {
    const k = await login('Kartik');
    await k.rpc('sheet_save', sheetArgs());
    const team = (await k.rpc('admin_save_team', { p_id: null, p_name: 'Support' })).data as string;
    await k.rpc('admin_set_member_team', { p_member: ids.Sanket, p_team: team, p_from: (await sql<{ d: string }>('select private.today()::text as d'))[0].d });
    await k.rpc('sheet_save', sheetArgs({ p_name: 'Refunds', p_url: SHEET2, p_visibility: 'assigned', p_owner: ids.Dev, p_people: [ids.Zinia], p_team: team }));

    const names = async (n: string) => ((await (await login(n)).from('work_sheets').select('name').order('name')).data ?? []).map((r) => r.name);
    expect(await names('Kartik')).toEqual(['Daily orders', 'Refunds']);
    expect(await names('Dev')).toEqual(['Daily orders', 'Refunds']); // responsible
    expect(await names('Zinia')).toEqual(['Daily orders', 'Refunds']); // working on it
    expect(await names('Sanket')).toEqual(['Daily orders', 'Refunds']); // its team
    expect(await names('Shruti')).toEqual(['Daily orders']);
  });

  it('lets the responsible person edit details and people, but not who is responsible or who can see it', async () => {
    const k = await login('Kartik');
    const id = (await k.rpc('sheet_save', sheetArgs({ p_owner: ids.Dev }))).data as string;
    const d = await login('Dev');
    const ok = await d.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Dev, p_name: 'Daily orders (packing)', p_people: [ids.Sanket] }));
    expect(ok.error).toBeNull();
    const steal = await d.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Zinia }));
    expect(steal.error?.code).toBe('42501');
    const hide = await d.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Dev, p_visibility: 'assigned' }));
    expect(hide.error?.code).toBe('42501');
    const z = await login('Zinia');
    expect((await z.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Dev, p_name: 'Mine now' }))).error?.code).toBe('42501');
    expect((await d.rpc('sheet_set_archived', { p_id: id, p_archived: true })).error?.code).toBe('42501');

    const audit = await sql<{ action: string }>(`select action from public.audit_events where entity = 'work_sheet' and entity_id = $1 order by created_at`, [id]);
    expect(audit.map((a) => a.action)).toEqual(['created', 'updated']);
  });

  it('lets anyone add a sheet, makes them responsible for it, and keeps the admin-only parts for admins', async () => {
    const z = await login('Zinia');
    // Naming someone else as responsible is ignored: whoever adds the sheet is responsible for it.
    const { data: id, error } = await z.rpc('sheet_save', sheetArgs({ p_owner: ids.Dev, p_visibility: 'assigned', p_people: [ids.Sanket] }));
    expect(error).toBeNull();
    const row = (await sql<{ owner_id: string; created_by: string; visibility: string }>(
      'select owner_id, created_by, visibility from public.work_sheets where id = $1', [id]))[0];
    expect(row).toEqual({ owner_id: ids.Zinia, created_by: ids.Zinia, visibility: 'assigned' });

    const names = async (n: string) => ((await (await login(n)).from('work_sheets').select('name')).data ?? []).map((r) => r.name);
    expect(await names('Zinia')).toEqual(['Daily orders']);
    expect(await names('Sanket')).toEqual(['Daily orders']); // working on it
    expect(await names('Kartik')).toEqual(['Daily orders']); // Sheets admin
    expect(await names('Dev')).toEqual([]); // not on it, and the sheet is not for everyone

    // She keeps it up to date, but cannot hand it over, change who sees it, or remove it.
    expect((await z.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Zinia, p_visibility: 'assigned', p_name: 'Daily orders (Zinia)' }))).error).toBeNull();
    expect((await z.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Dev, p_visibility: 'assigned' }))).error?.code).toBe('42501');
    expect((await z.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Zinia, p_visibility: 'everyone' }))).error?.code).toBe('42501');
    expect((await z.rpc('sheet_set_archived', { p_id: id, p_archived: true })).error?.code).toBe('42501');
    // Another employee cannot add the same spreadsheet again.
    expect((await (await login('Dev')).rpc('sheet_save', sheetArgs({ p_url: SHEET.replace('#gid=0', '') }))).error?.message).toMatch(/already in the workspace/);
    // The Super Admin can still hand it over and remove it.
    const k = await login('Kartik');
    expect((await k.rpc('sheet_save', sheetArgs({ p_id: id, p_owner: ids.Dev, p_visibility: 'assigned' }))).error).toBeNull();
    expect((await k.rpc('sheet_set_archived', { p_id: id, p_archived: true })).error).toBeNull();

    const audit = await sql<{ action: string }>(`select action from public.audit_events where entity = 'work_sheet' and entity_id = $1 order by created_at, id`, [id]);
    expect(audit.map((a) => a.action)).toEqual(['created', 'updated', 'updated', 'archived']);
  });

  it('archives instead of deleting, hides archived sheets from employees, and can restore them', async () => {
    const k = await login('Kartik');
    const id = (await k.rpc('sheet_save', sheetArgs())).data as string;
    expect((await k.rpc('sheet_set_archived', { p_id: id, p_archived: true })).error).toBeNull();
    const z = await login('Zinia');
    expect((await z.from('work_sheets').select('id')).data).toEqual([]);
    expect((await k.from('work_sheets').select('id, archived_at')).data![0].archived_at).not.toBeNull();
    // The same link can be added again while the old entry is archived, but then not restored twice.
    const again = (await k.rpc('sheet_save', sheetArgs({ p_name: 'Daily orders v2' }))).data as string;
    expect(again).toBeTruthy();
    expect((await k.rpc('sheet_set_archived', { p_id: id, p_archived: false })).error?.message).toMatch(/already has this link/);
    await k.rpc('sheet_set_archived', { p_id: again, p_archived: true });
    expect((await k.rpc('sheet_set_archived', { p_id: id, p_archived: false })).error).toBeNull();
    expect((await z.from('work_sheets').select('id')).data).toEqual([{ id }]);
    expect((await sql('select count(*)::int as n from public.work_sheets'))[0]).toEqual({ n: 2 });
  });

  it('lets an Admin with the Sheets area manage sheets', async () => {
    await makeAdmin('Shruti');
    const k = await login('Kartik');
    await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['sheets'] });
    const s = await login('Shruti');
    const id = (await s.rpc('sheet_save', sheetArgs({ p_visibility: 'assigned' }))).data as string;
    expect(id).toBeTruthy();
    expect((await s.from('work_sheets').select('id')).data).toEqual([{ id }]);
    expect((await s.rpc('sheet_set_archived', { p_id: id, p_archived: true })).error).toBeNull();
  });
});
