// Pure helpers shared by the Attendance pages and the CSV export. No server or client APIs here.
import type { AttendanceRow } from '@/lib/types';
import { addDays, isIsoDate } from '@/lib/format';

/** attendance_report accepts at most 93 days (p_to - p_from <= 92). */
export const MAX_RANGE_DAYS = 93;
export const DEFAULT_TZ = 'Asia/Kolkata';

export const LOGIN_STATUSES = ['On Time', 'Within Grace Period', 'Late', 'Exempt', 'Not Logged In', 'On Leave', 'Holiday', 'Weekly Off', 'No Schedule'] as const;
export const LOGOUT_STATUSES = ['Currently Working', 'Logged Out', 'Left Early', 'Overtime', 'Incomplete Session'] as const;
const ALL_STATUSES: readonly string[] = [...LOGIN_STATUSES, ...LOGOUT_STATUSES];

export const FLAG_STATUSES = ['Open', 'Reviewed', 'Resolved'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

/** Decisions on an exception. Approved and Waived ones do not count towards repeated flags. */
export const DECISIONS = ['Approved', 'Rejected', 'Waived'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Exception queue status filter: open (incl. reviewed), a decision, or resolved before decisions existed. */
export const EXCEPTION_STATUSES = ['Open', 'Approved', 'Rejected', 'Waived', 'Resolved'] as const;

export const FLAG_TYPES = [
  'Late Login',
  'Early Logout',
  'Late Logout',
  'Long Break',
  'No Login',
  'Incomplete Session',
  'Repeated Late Login',
  'Repeated Early Logout',
] as const;

/** ISO weekday 1 = Mon … 7 = Sun. */
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FlagRow {
  id: string;
  member_id: string;
  work_date: string;
  flag_type: string;
  expected_at: string | null;
  actual_at: string | null;
  minutes: number | null;
  reason: string;
  employee_explanation: string;
  status: FlagStatus;
  decision: Decision | null;
  review_note: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface CorrectionRow {
  id: string;
  member_id: string;
  work_date: string;
  requested_login_at: string | null;
  requested_logout_at: string | null;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  original_login_at: string | null;
  original_logout_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
}

export interface ScheduleRow {
  id: string;
  member_id: string;
  effective_from: string;
  start_time: string;
  end_time: string;
  working_days: number[];
  break_minutes: number;
  grace_minutes: number;
  timezone: string;
  note: string;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
  follows_default?: boolean;
}

/** A real calendar date in yyyy-mm-dd form (rejects 2026-02-31 and the like). */
export function validDate(v: string | undefined | null): v is string {
  return isIsoDate(v) && addDays(v, 0) === v;
}

export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** Query-string values the Attendance page and the export understand. */
export type AttendanceSearch = {
  date?: string;
  from?: string;
  to?: string;
  member?: string;
  team?: string;
  status?: string;
  late?: string;
  early?: string;
  incomplete?: string;
  leave?: string;
};

export interface Filters {
  from: string;
  to: string;
  isRange: boolean;
  member: string | null;
  team: string | null;
  status: string | null;
  late: boolean;
  early: boolean;
  incomplete: boolean;
  leave: boolean;
}

/**
 * Reads the period and filters. `from` (or `date`) alone is one day; `from` + `to` is a range of up
 * to 93 days. With no dates, the period is `today`, which always comes from the database.
 */
export function parseFilters(sp: AttendanceSearch, today: string): { filters: Filters; error?: string } {
  let error: string | undefined;
  const first = sp.from || sp.date || '';
  const last = sp.to || '';
  let from = today;
  let to = today;
  if ((first && !validDate(first)) || (last && !validDate(last))) {
    error = 'Dates must be real calendar dates (YYYY-MM-DD). Showing today instead.';
  } else if (first || last) {
    const a = first || last;
    const b = last || first;
    if (b < a) error = 'The end date is before the start date. Showing today instead.';
    else if (daysBetween(a, b) > MAX_RANGE_DAYS - 1) error = `Choose a range of up to ${MAX_RANGE_DAYS} days. Showing today instead.`;
    else {
      from = a;
      to = b;
    }
  }
  const status = sp.status && ALL_STATUSES.includes(sp.status) ? sp.status : null;
  return {
    error,
    filters: {
      from,
      to,
      isRange: from !== to,
      member: sp.member && UUID_RE.test(sp.member) ? sp.member : null,
      team: sp.team && UUID_RE.test(sp.team) ? sp.team : null,
      status,
      late: sp.late === '1',
      early: sp.early === '1',
      incomplete: sp.incomplete === '1',
      leave: sp.leave === '1',
    },
  };
}

/** Employee filter only; used for the summary figures, which ignore the status filters. */
export function scopeRows(rows: AttendanceRow[], f: Filters): AttendanceRow[] {
  return f.member ? rows.filter((r) => r.member_id === f.member) : rows;
}

/**
 * Employee and status filters. The "only show" checkboxes combine with OR (late OR left early …),
 * and together with the status filter and employee with AND.
 */
export function applyFilters(rows: AttendanceRow[], f: Filters): AttendanceRow[] {
  const checks: ((r: AttendanceRow) => boolean)[] = [];
  if (f.late) checks.push((r) => r.login_status === 'Late');
  if (f.early) checks.push((r) => r.logout_status === 'Left Early');
  if (f.incomplete) checks.push((r) => r.incomplete_sessions > 0);
  if (f.leave) checks.push((r) => r.day_type === 'On Leave');
  return scopeRows(rows, f).filter(
    (r) => (!f.status || r.login_status === f.status || r.logout_status === f.status) && (checks.length === 0 || checks.some((c) => c(r))),
  );
}

export function hasStatusFilters(f: Filters): boolean {
  return Boolean(f.status || f.late || f.early || f.incomplete || f.leave);
}

/** Builds a query string from the filters, with optional overrides (undefined/false/'' drop a key). */
export function filterQuery(f: Filters, overrides: Partial<Record<keyof AttendanceSearch, string | boolean | null>> = {}): string {
  const base: Record<string, string | boolean | null> = {
    from: f.from,
    to: f.isRange ? f.to : null,
    member: f.member,
    team: f.team,
    status: f.status,
    late: f.late,
    early: f.early,
    incomplete: f.incomplete,
    leave: f.leave,
    ...overrides,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v === true) p.set(k, '1');
    else if (typeof v === 'string' && v) p.set(k, v);
  }
  return p.toString();
}

/** Working days as labels, e.g. [1..6] -> "Mon–Sat", [1,3,5] -> "Mon, Wed, Fri". */
export function daysLabel(days: number[] | null | undefined): string {
  const d = Array.from(new Set(days ?? [])).filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (d.length === 0) return '—';
  if (d.length === 7) return 'Every day';
  const contiguous = d.length >= 3 && d[d.length - 1] - d[0] === d.length - 1;
  if (contiguous) return `${DAY_LABELS[d[0] - 1]}–${DAY_LABELS[d[d.length - 1] - 1]}`;
  return d.map((n) => DAY_LABELS[n - 1]).join(', ');
}

/** "10:00:00" -> "10:00". */
export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '—';
}

/** The schedule in force for a person on a date (latest effective_from on or before it). */
export function scheduleOn(schedules: ScheduleRow[], memberId: string, date: string): ScheduleRow | null {
  let best: ScheduleRow | null = null;
  for (const s of schedules) {
    if (s.member_id !== memberId || s.effective_from > date) continue;
    if (!best || s.effective_from > best.effective_from) best = s;
  }
  return best;
}

/** What to show for a flag's state: its decision when it has one, otherwise its status. */
export function flagState(f: Pick<FlagRow, 'status' | 'decision'>): string {
  return f.decision ?? f.status;
}

/** Repeated-flag rows store a count in `minutes`; the others store minutes. */
export function flagAmount(f: Pick<FlagRow, 'flag_type' | 'minutes'>): string {
  if (f.minutes === null || f.minutes === undefined) return '—';
  return f.flag_type.startsWith('Repeated') ? `${f.minutes} times` : `${f.minutes} min`;
}

const FLAG_ORDER: Record<string, number> = { Open: 0, Reviewed: 1, Resolved: 2 };
export function sortFlags(flags: FlagRow[]): FlagRow[] {
  return [...flags].sort((a, b) => FLAG_ORDER[a.status] - FLAG_ORDER[b.status] || b.work_date.localeCompare(a.work_date) || b.created_at.localeCompare(a.created_at));
}

/** Common zones first; the rest come from the runtime's IANA list. */
export function timeZoneOptions(inUse: string[]): { common: string[]; all: string[] } {
  const common = Array.from(new Set([DEFAULT_TZ, ...inUse, 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York']));
  // The runtime lists canonical ICU names; PostgreSQL also knows the current IANA spellings.
  const rename: Record<string, string> = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Europe/Kiev': 'Europe/Kyiv',
  };
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone').map((z) => rename[z] ?? z);
  } catch {
    zones = [];
  }
  const all = Array.from(new Set(zones)).filter((z) => !common.includes(z)).sort();
  return { common, all };
}

/** True when the runtime recognises the zone (the database checks again against pg_timezone_names). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * One CSV field. Text that a spreadsheet would treat as a formula (starting with = + - @, tab or CR)
 * is prefixed with a single quote; fields with quotes, commas or line breaks are quoted.
 */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
