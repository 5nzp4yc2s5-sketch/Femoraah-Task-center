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
  if (/routines_check/i.test(message)) return 'Every N Days must match the frequency (Daily 1, Weekly 7, Monthly 28-31).';
  if (/duplicate key.*username/i.test(message)) return 'That username is already taken.';
  if (/members_active_name_uq/i.test(message)) return 'An active member already has that name.';
  return message.replace(/^.*?ERROR:\s*/, '');
}

export function pct(n: number): string {
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`;
}
