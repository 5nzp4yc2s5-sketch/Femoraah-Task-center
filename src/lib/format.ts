const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar dates (no time zone) in the spreadsheet's dd-MMM-yy style, e.g. 11-Oct-26. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return '—';
  return `${String(day).padStart(2, '0')}-${MONTHS[m - 1]}-${String(y).slice(2)}`;
}

export function daysLeftLabel(n: number | null): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return 'Today';
  if (n < 0) return `${Math.abs(n)}d late`;
  return `${n}d`;
}

/** Map a database error to a message a person can act on. */
export function friendlyError(message: string | undefined | null): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (/row-level security|permission denied|42501/i.test(message)) return 'You do not have permission to do that.';
  if (/violates check constraint.*percent/i.test(message)) return '% Complete must be between 0 and 100.';
  if (/due_date.*start_date|tasks_check/i.test(message)) return 'Due date cannot be before the start date.';
  if (/routines_check/i.test(message)) return 'Every N Days must match the frequency (Daily 1, Weekly 7, Monthly 30).';
  if (/routines_backup_not_owner/i.test(message)) return 'The backup must be someone other than the person it is assigned to.';
  if (/tasks_blocker_required/i.test(message)) return 'A blocked task needs a blocker reason.';
  if (/attendance_one_pending_correction/i.test(message)) return 'You already have a pending correction request for that day.';
  if (/holidays_holiday_date_key|duplicate key.*holiday_date/i.test(message)) return 'There is already a holiday on that date.';
  if (/leaves_check|end_date.*start_date/i.test(message)) return 'The end date cannot be before the start date.';
  if (/duplicate key.*username/i.test(message)) return 'That username is already taken.';
  if (/members_active_name_uq/i.test(message)) return 'An active member already has that name.';
  if (/invalid input value for enum/i.test(message)) return 'That value is not one of the allowed options.';
  return message.replace(/^.*?ERROR:\s*/, '');
}

export function pct(n: number): string {
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`;
}

/** Minutes as "7h 05m" (or "45m"). */
export function fmtMinutes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** An instant shown as wall-clock time in the given IANA zone, e.g. "10:07". */
export function fmtClock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(iso));
}

/** Add days to a yyyy-mm-dd date string. */
export function addDays(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + n));
  return dt.toISOString().slice(0, 10);
}

export const isIsoDate = (v: string | undefined | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
