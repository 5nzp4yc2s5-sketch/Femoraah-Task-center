import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

export const API_URL = process.env.TEST_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY ?? '';
export const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY ?? '';
export const DB_URL = process.env.TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const db = new pg.Pool({ connectionString: DB_URL, max: 3 });
export const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const PASSWORD = 'Local-test-pass-2026';
export const PINS: Record<string, string> = { Kartik: '111', Shruti: '222', Sanket: '333', Dev: '444', Zinia: '555' };

export function anonClient(): SupabaseClient {
  return createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function memberId(name: string): Promise<string> {
  const r = await db.query('select id from public.members where name = $1', [name]);
  return r.rows[0].id;
}

/** Create (or recreate) a login for a seeded member, linked directly in the DB. */
export async function provision(name: string): Promise<void> {
  const username = name.toLowerCase();
  const email = `${username}@test.opspulse.local`;
  const existing = await db.query('select id from auth.users where email = $1', [email]);
  for (const row of existing.rows) await admin.auth.admin.deleteUser(row.id);
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  await db.query('update public.members set user_id = $1, username = $2, is_active = true where name = $3', [data.user!.id, username, name]);
  await db.query(
    `insert into public.member_pins (member_id, pin_hash) select id, private.hash_pin($2) from public.members where name = $1
     on conflict (member_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null`,
    [name, PINS[name]],
  );
}

/** Password sign-in only (no PIN yet). */
export async function signIn(name: string): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email: `${name.toLowerCase()}@test.opspulse.local`, password: PASSWORD });
  if (error) throw error;
  return c;
}

/** Password + PIN: a fully verified session. */
export async function login(name: string): Promise<SupabaseClient> {
  const c = await signIn(name);
  const { data, error } = await c.rpc('verify_pin', { p_pin: PINS[name] });
  if (error) throw error;
  if (!data.ok) throw new Error(`PIN failed for ${name}: ${JSON.stringify(data)}`);
  return c;
}

export async function resetData(): Promise<void> {
  await db.query(`
    delete from public.task_collaborators; delete from public.task_updates; delete from public.task_assignments;
    update public.backlog_items set task_id = null, status = 'Pending', approval = 'Pending';
    delete from public.tasks; delete from public.backlog_items;
    delete from public.leaves; delete from public.holidays;
    delete from public.attendance_breaks; delete from public.attendance_exemptions;
    delete from public.attendance_flags; delete from public.attendance_corrections;
    delete from public.attendance_sessions; delete from public.attendance_records;
    delete from public.member_teams; delete from public.schedule_defaults; delete from public.teams;
    delete from public.quote_days; delete from public.company_profile;
    update public.app_settings set late_logout_flag_minutes = null, long_break_grace_minutes = 10, repeat_flag_count = 3;
    delete from public.routine_completions where note <> 'Imported from spreadsheet';
    delete from public.login_attempts; delete from public.verified_sessions;
    update public.member_pins set failed_attempts = 0, locked_until = null;
    update public.members set is_active = true, access_role = case when name = 'Kartik' then 'admin'::access_role else 'member'::access_role end;
    delete from public.members where name not in ('Zinia','Shruti','Sanket','Dev','Kartik');
    update public.routines set backup_member_id = null where backup_member_id is not null;
  `);
}
