import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, db, login, memberId, PINS, provision, resetData } from './helpers';

// Phase 4b: the credential manager. The database only ever sees encrypted values; these tests use
// well-formed placeholders because encryption happens in the app server.
const TEAM = ['Kartik', 'Shruti', 'Sanket', 'Dev', 'Zinia'];
const ids: Record<string, string> = {};
const KEY = '0123456789abcdef';
const ct = (tag: string) => `v1.AAAAAAAAAAAAAAAA.${tag}.BBBBBBBBBBBBBBBBBBBBBB`;

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[];
}

async function create(c: SupabaseClient, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  const r = await c.rpc('cred_create', {
    p_id: id, p_name: 'Amazon Seller Central', p_url: 'https://sellercentral.amazon.in', p_username: 'ops@example.com',
    p_category: 'Marketplaces', p_password_ct: ct('pw1'), p_notes_ct: ct('notes1'), p_key_id: KEY, ...over,
  });
  if (r.error) throw r.error;
  return id;
}

async function events(id: string) {
  return sql<{ action: string; actor: string | null; member: string | null; details: Record<string, unknown> }>(
    `select e.action, a.name as actor, m.name as member, e.details from public.credential_events e
       left join public.members a on a.id = e.actor_member_id left join public.members m on m.id = e.member_id
      where e.credential_id = $1 order by e.created_at`, [id]);
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

describe('credential manager', () => {
  it('lets only the Super Admin or a Credentials admin add logins, and stores only well-formed encrypted values', async () => {
    const k = await login('Kartik');
    const z = await login('Zinia');
    const refused = await z.rpc('cred_create', { p_id: randomUUID(), p_name: 'X', p_url: '', p_username: '', p_category: '', p_password_ct: ct('a'), p_notes_ct: null, p_key_id: KEY });
    expect(refused.error?.code).toBe('42501');
    const id = await create(k);
    // Plain text never fits the encrypted column.
    const plain = await k.rpc('cred_create', { p_id: randomUUID(), p_name: 'Plain', p_url: '', p_username: '', p_category: '', p_password_ct: 'hunter2', p_notes_ct: null, p_key_id: KEY });
    expect(plain.error).not.toBeNull();
    const badUrl = await k.rpc('cred_create', { p_id: randomUUID(), p_name: 'Bad', p_url: 'javascript:alert(1)', p_username: '', p_category: '', p_password_ct: ct('a'), p_notes_ct: null, p_key_id: KEY });
    expect(badUrl.error?.message).toMatch(/full link/);
    expect((await events(id)).map((e) => e.action)).toEqual(['created']);

    // An Admin with the credentials area can add; without it they cannot.
    await db.query(`update public.members set access_role = 'manager' where name = 'Shruti'`);
    const s = await login('Shruti');
    expect((await s.rpc('cred_create', { p_id: randomUUID(), p_name: 'Y', p_url: '', p_username: '', p_category: '', p_password_ct: ct('a'), p_notes_ct: null, p_key_id: KEY })).error?.code).toBe('42501');
    expect((await k.rpc('admin_set_areas', { p_member: ids.Shruti, p_areas: ['credentials'] })).error).toBeNull();
    await create(s, { p_name: 'Flipkart' });
  });

  it('keeps encrypted values out of reach: no table access, nothing for people without access', async () => {
    const k = await login('Kartik');
    const id = await create(k);
    for (const who of ['Kartik', 'Zinia']) {
      const c = await login(who);
      const secrets = await c.from('credential_secrets').select('*');
      expect(secrets.error?.code, who).toBe('42501');
      expect((await c.from('credentials').insert({ name: 'x' })).error, who).not.toBeNull();
    }
    const z = await login('Zinia');
    expect((await z.from('credentials').select('id')).data).toEqual([]);
    expect((await z.rpc('cred_reveal', { p_id: id, p_pin: PINS.Zinia, p_purpose: 'view' })).data).toEqual({ ok: false, error: 'not_found' });
    // Signed out: nothing at all.
    const anon = anonClient();
    expect((await anon.rpc('cred_reveal', { p_id: id, p_pin: '111', p_purpose: 'view' })).error).not.toBeNull();
    expect((await anon.from('credentials').select('id')).data ?? []).toEqual([]);
  });

  it('shares with a person or a team; "use" can show and copy with the PIN, but not change or share', async () => {
    const k = await login('Kartik');
    const id = await create(k);
    const team = (await sql<{ id: string }>(`insert into public.teams (name) values ('Listings') returning id`))[0].id;
    await db.query(`insert into public.member_teams (member_id, team_id, effective_from) values ($1, $2, '2020-01-01')`, [ids.Dev, team]);
    expect((await k.rpc('cred_share', { p_id: id, p_member: ids.Zinia, p_team: null, p_level: 'use' })).error).toBeNull();
    expect((await k.rpc('cred_share', { p_id: id, p_member: null, p_team: team, p_level: 'use' })).error).toBeNull();
    // A team can't be an access manager.
    expect((await k.rpc('cred_share', { p_id: id, p_member: null, p_team: team, p_level: 'manage' })).error?.message).toMatch(/Only a person/);

    for (const who of ['Zinia', 'Dev']) {
      const c = await login(who);
      expect((await c.from('credentials').select('id, name, username')).data, who).toEqual([{ id, name: 'Amazon Seller Central', username: 'ops@example.com' }]);
      const shown = await c.rpc('cred_reveal', { p_id: id, p_pin: PINS[who], p_purpose: 'view' });
      expect(shown.data, who).toEqual({ ok: true, password_ct: ct('pw1'), notes_ct: ct('notes1'), key_id: KEY });
      const copied = await c.rpc('cred_reveal', { p_id: id, p_pin: PINS[who], p_purpose: 'copy' });
      expect(copied.data, who).toEqual({ ok: true, password_ct: ct('pw1'), notes_ct: null, key_id: KEY });
      expect((await c.rpc('cred_update', { p_id: id, p_name: 'X', p_url: '', p_username: '', p_category: '' })).error?.code, who).toBe('42501');
      expect((await c.rpc('cred_set_secret', { p_id: id, p_pin: PINS[who], p_field: 'password', p_ct: ct('pw2'), p_key_id: KEY })).error?.code, who).toBe('42501');
      expect((await c.rpc('cred_share', { p_id: id, p_member: ids.Sanket, p_team: null, p_level: 'use' })).error?.code, who).toBe('42501');
      // "use" access sees neither the access list of others nor the history.
      expect((await c.from('credential_events').select('id')).data, who).toEqual([]);
    }
    const s = await login('Sanket');
    expect((await s.from('credentials').select('id')).data).toEqual([]);
    const ev = await events(id);
    expect(ev.filter((e) => e.action === 'shown').map((e) => e.actor)).toEqual(['Zinia', 'Dev']);
    expect(ev.filter((e) => e.action === 'copied').map((e) => e.actor)).toEqual(['Zinia', 'Dev']);
  });

  it('counts a wrong PIN against the same lockout as sign-in and records the refusal', async () => {
    const k = await login('Kartik');
    const id = await create(k);
    await k.rpc('cred_share', { p_id: id, p_member: ids.Zinia, p_team: null, p_level: 'use' });
    const z = await login('Zinia');
    const wrong = await z.rpc('cred_reveal', { p_id: id, p_pin: '000', p_purpose: 'view' });
    expect(wrong.data).toEqual({ ok: false, error: 'wrong', remaining: 4 });
    // A right PIN resets the counter.
    expect((await z.rpc('cred_reveal', { p_id: id, p_pin: PINS.Zinia, p_purpose: 'copy' })).data.ok).toBe(true);
    expect((await sql<{ n: number }>('select failed_attempts as n from public.member_pins where member_id = $1', [ids.Zinia]))[0].n).toBe(0);
    for (let i = 0; i < 4; i++) await z.rpc('cred_reveal', { p_id: id, p_pin: '000', p_purpose: 'view' });
    const fifth = await z.rpc('cred_reveal', { p_id: id, p_pin: '000', p_purpose: 'view' });
    expect(fifth.data).toEqual({ ok: false, error: 'locked', remaining: null });
    // Locked: even the right PIN is refused, here and at sign-in, until the Super Admin resets it.
    expect((await z.rpc('cred_reveal', { p_id: id, p_pin: PINS.Zinia, p_purpose: 'view' })).data.error).toBe('locked');
    expect((await k.rpc('admin_pin_locked', { p_member: ids.Zinia })).data).toBe(true);
    const ev = await events(id);
    expect(ev.filter((e) => e.action === 'refused').length).toBe(7);
    expect(ev.find((e) => e.action === 'refused')?.details).toEqual({ purpose: 'view', reason: 'wrong' });
  });

  it('lets an access manager change the password with their PIN, recording who and when, and share "use" only', async () => {
    const k = await login('Kartik');
    const id = await create(k);
    expect((await k.rpc('cred_share', { p_id: id, p_member: ids.Shruti, p_team: null, p_level: 'manage' })).error).toBeNull();
    const s = await login('Shruti');
    // Wrong PIN: nothing changes.
    expect((await s.rpc('cred_set_secret', { p_id: id, p_pin: '000', p_field: 'password', p_ct: ct('pw2'), p_key_id: KEY })).data).toEqual({ ok: false, error: 'wrong', remaining: 4 });
    expect((await sql<{ p: string }>('select password_ct as p from public.credential_secrets where credential_id = $1', [id]))[0].p).toBe(ct('pw1'));
    // A different key is refused, so nothing becomes unreadable.
    expect((await s.rpc('cred_set_secret', { p_id: id, p_pin: PINS.Shruti, p_field: 'password', p_ct: ct('pw2'), p_key_id: 'ffffffffffffffff' })).error?.message).toMatch(/different encryption key/);
    expect((await s.rpc('cred_set_secret', { p_id: id, p_pin: PINS.Shruti, p_field: 'password', p_ct: ct('pw2'), p_key_id: KEY })).data).toEqual({ ok: true });
    expect((await s.rpc('cred_set_secret', { p_id: id, p_pin: PINS.Shruti, p_field: 'notes', p_ct: null, p_key_id: KEY })).data).toEqual({ ok: true });
    const row = (await sql<{ by: string; at: Date; p: string; n: string | null }>(
      `select m.name as by, c.password_changed_at as at, s.password_ct as p, s.notes_ct as n from public.credentials c
         join public.members m on m.id = c.password_changed_by join public.credential_secrets s on s.credential_id = c.id where c.id = $1`, [id]))[0];
    expect(row.by).toBe('Shruti');
    expect(row.p).toBe(ct('pw2'));
    expect(row.n).toBeNull();
    expect((await s.rpc('cred_update', { p_id: id, p_name: 'Amazon SC', p_url: 'https://sellercentral.amazon.in/home', p_username: 'ops2@example.com', p_category: 'Marketplaces' })).error).toBeNull();

    expect((await s.rpc('cred_share', { p_id: id, p_member: ids.Dev, p_team: null, p_level: 'use' })).error).toBeNull();
    expect((await s.rpc('cred_share', { p_id: id, p_member: ids.Sanket, p_team: null, p_level: 'manage' })).error?.message).toMatch(/Only a Credentials admin can make/);
    // The manager sees who has access and the history; the access list of others stays hidden from Dev.
    expect((await s.from('credential_access').select('member_id').is('revoked_at', null)).data?.length).toBe(2);
    expect((await s.from('credential_events').select('action')).data?.map((e) => e.action)).toEqual(
      expect.arrayContaining(['created', 'shared', 'refused', 'password_changed', 'notes_changed', 'updated']));
    const d = await login('Dev');
    expect((await d.from('credential_access').select('member_id')).data).toEqual([{ member_id: ids.Dev }]);

    // A manager removes "use" access, but not another manager's.
    const devRow = (await sql<{ id: string }>('select id from public.credential_access where member_id = $1 and revoked_at is null', [ids.Dev]))[0].id;
    expect((await s.rpc('cred_unshare', { p_access: devRow })).error).toBeNull();
    expect((await d.from('credentials').select('id')).data).toEqual([]);
    await k.rpc('cred_share', { p_id: id, p_member: ids.Sanket, p_team: null, p_level: 'manage' });
    const sanketRow = (await sql<{ id: string }>('select id from public.credential_access where member_id = $1 and revoked_at is null', [ids.Sanket]))[0].id;
    expect((await s.rpc('cred_unshare', { p_access: sanketRow })).error?.message).toMatch(/Only a Credentials admin can remove/);
    const ev = await events(id);
    expect(ev.find((e) => e.action === 'password_changed')?.actor).toBe('Shruti');
    expect(ev.find((e) => e.action === 'unshared')?.member).toBe('Dev');
  });

  it('removes direct access when someone is deactivated or their role changes, keeping the history', async () => {
    const k = await login('Kartik');
    const id = await create(k);
    await k.rpc('cred_share', { p_id: id, p_member: ids.Zinia, p_team: null, p_level: 'use' });
    await k.rpc('cred_share', { p_id: id, p_member: ids.Dev, p_team: null, p_level: 'manage' });
    // Saving a profile without changing the role keeps access.
    await db.query(`update public.members set access_role = access_role, max_open_tasks = max_open_tasks where name = 'Zinia'`);
    expect((await sql('select 1 from public.credential_access where member_id = $1 and revoked_at is null', [ids.Zinia])).length).toBe(1);
    await db.query(`update public.members set access_role = 'manager' where name = 'Zinia'`);
    await db.query(`update public.members set is_active = false where name = 'Dev'`);
    const rows = await sql<{ name: string; reason: string; revoked: boolean }>(
      `select m.name, a.revoke_reason as reason, a.revoked_at is not null as revoked from public.credential_access a
         join public.members m on m.id = a.member_id order by m.name`);
    expect(rows).toEqual([{ name: 'Dev', reason: 'deactivated', revoked: true }, { name: 'Zinia', reason: 'role changed', revoked: true }]);
    expect((await events(id)).filter((e) => e.action === 'access_removed').map((e) => [e.member, e.details.reason]).sort()).toEqual([
      ['Dev', 'deactivated'], ['Zinia', 'role changed']]);
  });

  it('takes a login out of use without deleting it; only Credentials admins see or restore it', async () => {
    const k = await login('Kartik');
    const id = await create(k);
    await k.rpc('cred_share', { p_id: id, p_member: ids.Zinia, p_team: null, p_level: 'manage' });
    const z = await login('Zinia');
    expect((await z.rpc('cred_set_archived', { p_id: id, p_archived: true })).error?.code).toBe('42501');
    expect((await k.rpc('cred_set_archived', { p_id: id, p_archived: true })).error).toBeNull();
    expect((await z.from('credentials').select('id')).data).toEqual([]);
    expect((await z.rpc('cred_reveal', { p_id: id, p_pin: PINS.Zinia, p_purpose: 'view' })).data.error).toBe('not_found');
    expect((await k.from('credentials').select('id, archived_at')).data?.[0].archived_at).not.toBeNull();
    expect((await k.rpc('cred_set_archived', { p_id: id, p_archived: false })).error).toBeNull();
    expect((await z.from('credentials').select('id')).data).toEqual([{ id }]);
    expect((await sql('select 1 from public.credential_secrets where credential_id = $1', [id])).length).toBe(1);
  });

  it('adds only new objects: no existing function or policy changed', async () => {
    const t = await sql<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'members_credential_cleanup'`);
    expect(t[0].n).toBe(1);
    const leaked = await sql<{ p: string }>(`select table_name as p from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'credential_secrets' and grantee in ('anon', 'authenticated')`);
    expect(leaked).toEqual([]);
  });
});
