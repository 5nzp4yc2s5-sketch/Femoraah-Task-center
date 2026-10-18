import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AttendanceRow } from '@/lib/types';
import { DEFAULT_TZ, scheduleOn, type ScheduleRow } from './lib';

type Supa = Awaited<ReturnType<typeof createClient>>;

/** "Today" as the database sees it (never the web server's clock). */
export async function dbToday(supabase: Supa): Promise<{ today: string | null; error?: string }> {
  const { data, error } = await supabase.rpc('my_summary');
  if (error) return { today: null, error: error.message };
  const today = typeof data?.today === 'string' ? data.today : null;
  return today ? { today } : { today: null, error: 'The database did not return today’s date.' };
}

export interface AttendanceSettings {
  expiryHours: number;
  overtimeAfter: number;
}

export async function attendanceSettings(supabase: Supa): Promise<AttendanceSettings | null> {
  const { data } = await supabase.from('app_settings').select('session_expiry_hours, overtime_after_minutes').limit(1).maybeSingle();
  if (!data) return null;
  return { expiryHours: data.session_expiry_hours, overtimeAfter: data.overtime_after_minutes };
}

/** Names for everyone the viewer may see (admins also see inactive members). */
export async function memberNames(supabase: Supa): Promise<Map<string, string>> {
  const { data } = await supabase.from('members').select('id, name');
  return new Map((data ?? []).map((m: { id: string; name: string }) => [m.id, m.name]));
}

export async function loadSchedules(supabase: Supa, memberId?: string): Promise<{ rows: ScheduleRow[]; error?: string }> {
  let q = supabase.from('work_schedules').select('*').order('effective_from', { ascending: true });
  if (memberId) q = q.eq('member_id', memberId);
  const { data, error } = await q;
  return { rows: (data ?? []) as ScheduleRow[], error: error?.message };
}

export interface Recorded {
  login: string | null;
  logout: string | null;
  incomplete: number;
  tz: string;
}

/**
 * What is currently recorded for each person-day (first login and last logout, with any approved
 * correction applied) and the office time zone of that day. Used to show "original" times next to
 * correction requests.
 */
export async function recordedTimes(
  supabase: Supa,
  keys: { member_id: string; work_date: string }[],
  schedules: ScheduleRow[],
): Promise<Map<string, Recorded>> {
  const out = new Map<string, Recorded>();
  if (keys.length === 0) return out;
  const members = Array.from(new Set(keys.map((k) => k.member_id)));
  const dates = Array.from(new Set(keys.map((k) => k.work_date)));
  const [{ data: sessions }, { data: records }] = await Promise.all([
    supabase
      .from('attendance_sessions')
      .select('member_id, work_date, login_at, logout_at, corrected_login_at, corrected_logout_at, incomplete_at')
      .in('member_id', members)
      .in('work_date', dates),
    supabase.from('attendance_records').select('member_id, work_date, timezone').in('member_id', members).in('work_date', dates),
  ]);
  const tzByKey = new Map<string, string>(
    (records ?? []).map((r: { member_id: string; work_date: string; timezone: string }) => [`${r.member_id}|${r.work_date}`, r.timezone]),
  );
  for (const k of keys) {
    const key = `${k.member_id}|${k.work_date}`;
    out.set(key, {
      login: null,
      logout: null,
      incomplete: 0,
      tz: tzByKey.get(key) ?? scheduleOn(schedules, k.member_id, k.work_date)?.timezone ?? DEFAULT_TZ,
    });
  }
  type S = {
    member_id: string;
    work_date: string;
    login_at: string;
    logout_at: string | null;
    corrected_login_at: string | null;
    corrected_logout_at: string | null;
    incomplete_at: string | null;
  };
  for (const s of (sessions ?? []) as S[]) {
    const cur = out.get(`${s.member_id}|${s.work_date}`);
    if (!cur) continue;
    const login = s.corrected_login_at ?? s.login_at;
    const logout = s.corrected_logout_at ?? s.logout_at;
    if (!cur.login || new Date(login) < new Date(cur.login)) cur.login = login;
    if (logout && (!cur.logout || new Date(logout) > new Date(cur.logout))) cur.logout = logout;
    if (!logout && s.incomplete_at) cur.incomplete += 1;
  }
  return out;
}

/** Computed attendance days with teams, exemptions and breaks (admins: everyone; others: themselves). */
export async function loadDays(
  supabase: Supa,
  from: string,
  to: string,
  opts: { member?: string | null; team?: string | null } = {},
): Promise<{ rows: AttendanceRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('attendance_days_report', { p_from: from, p_to: to, p_member: opts.member ?? null, p_team: opts.team ?? null });
  return { rows: (data ?? []) as AttendanceRow[], error: error?.message };
}

export interface Team {
  id: string;
  name: string;
  note: string;
  is_active: boolean;
}

export async function loadTeams(supabase: Supa): Promise<Team[]> {
  const { data } = await supabase.from('teams').select('id, name, note, is_active').order('name');
  return (data ?? []) as Team[];
}

/** Each person's hours on a date and where they come from (personal, team or company default). */
export interface ScheduleOverview {
  member_id: string;
  member_name: string;
  is_active: boolean;
  team_id: string | null;
  team_name: string | null;
  source: 'Personal' | 'Team' | 'Company' | null;
  follows_default: boolean;
  personal_from: string | null;
  start_time: string | null;
  end_time: string | null;
  working_days: number[] | null;
  break_minutes: number | null;
  grace_minutes: number | null;
  timezone: string | null;
  exempt: boolean;
}

export async function scheduleOverview(supabase: Supa, date?: string): Promise<{ rows: ScheduleOverview[]; error?: string }> {
  const { data, error } = await supabase.rpc('schedule_overview', { p_date: date ?? null });
  return { rows: (data ?? []) as ScheduleOverview[], error: error?.message };
}
