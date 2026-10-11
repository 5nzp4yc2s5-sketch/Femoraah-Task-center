// Pure calendar-date helpers for yyyy-mm-dd strings. No time zones and no clock: "today" always
// comes from the database (my_summary), these only do arithmetic on the dates they are given.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function utc(d: string): number {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

/** A yyyy-mm month key, e.g. 2026-10. */
export const isMonth = (v: string | undefined | null): v is string => !!v && /^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(v);

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(d: string): number {
  return (new Date(utc(d)).getUTCDay() + 6) % 7;
}

export function weekdayShort(d: string): string {
  return WEEKDAYS[weekdayIndex(d)];
}

/** "October 2026" for 2026-10. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "Oct" for 2026-10. */
export function monthShort(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Number of calendar days a leave covers, both ends included. */
export function leaveDays(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}
