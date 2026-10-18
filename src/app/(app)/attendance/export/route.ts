import { createClient } from '@/lib/supabase/server';
import { fmtClock } from '@/lib/format';
import type { AttendanceRow } from '@/lib/types';
import { MAX_RANGE_DAYS, UUID_RE, applyFilters, csvField, daysBetween, parseFilters, validDate } from '../lib';

const HEADER = [
  'Employee',
  'Date',
  'Scheduled Start',
  'Actual Login',
  'Login Status',
  'Minutes Late',
  'Scheduled End',
  'Actual Logout',
  'Logout Status',
  'Minutes Early',
  'Overtime Minutes',
  'Hours Worked',
  'Sessions',
  'Incomplete Sessions',
  'Corrected',
  'Open Flags',
  'Break Minutes',
  'Exempt',
  'Team',
];

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** HH:MM in the row's own office time zone, or empty. */
function clock(iso: string | null, tz: string): string {
  return iso ? fmtClock(iso, tz) : '';
}

function csvRow(r: AttendanceRow): string {
  const working = r.day_type === 'Working Day';
  return [
    r.member_name,
    r.work_date,
    working ? clock(r.scheduled_start, r.tz) : '',
    clock(r.first_login, r.tz),
    r.login_status,
    r.minutes_late,
    working ? clock(r.scheduled_end, r.tz) : '',
    clock(r.last_logout, r.tz),
    r.logout_status,
    r.minutes_early,
    r.minutes_overtime,
    (r.worked_minutes / 60).toFixed(2),
    r.session_count,
    r.incomplete_sessions,
    r.corrected ? 'Yes' : 'No',
    r.open_flags,
    r.break_taken_minutes,
    r.exempt ? 'Yes' : 'No',
    r.team_name ?? '',
  ]
    .map(csvField)
    .join(',');
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return plain(401, 'Sign in to export attendance.');

  // "Today" comes from the database; this also fails when the PIN step has not been completed.
  const { data: summary, error: summaryError } = await supabase.rpc('my_summary');
  const today: string | null = typeof summary?.today === 'string' ? summary.today : null;
  if (summaryError || !today) {
    return summaryError?.code === '42501' || /not signed in/i.test(summaryError?.message ?? '')
      ? plain(401, 'Sign in and enter your PIN to export attendance.')
      : plain(500, 'Could not read today’s date from the database. Please try again.');
  }

  const params = new URL(request.url).searchParams;
  const sp = Object.fromEntries(params.entries()) as Record<string, string>;
  const from = sp.from || sp.date || today;
  const to = sp.to || from;
  if (!validDate(from) || !validDate(to)) return plain(400, 'Dates must be real calendar dates in YYYY-MM-DD form.');
  if (to < from) return plain(400, 'The end date is before the start date.');
  if (daysBetween(from, to) > MAX_RANGE_DAYS - 1) return plain(400, `Choose a date range of up to ${MAX_RANGE_DAYS} days.`);
  if (sp.member && !UUID_RE.test(sp.member)) return plain(400, 'Unknown employee.');
  if (sp.team && !UUID_RE.test(sp.team)) return plain(400, 'Unknown team.');

  // Expire stale sessions and create flags first, so the export matches the page. Idempotent.
  await supabase.rpc('attendance_refresh', { p_from: from, p_to: to });
  const { data, error } = await supabase.rpc('attendance_days_report', { p_from: from, p_to: to, p_member: sp.member || null, p_team: sp.team || null });
  if (error) {
    if (error.code === '42501') {
      return /not signed in/i.test(error.message) ? plain(401, 'Sign in and enter your PIN to export attendance.') : plain(403, 'You can only export your own attendance.');
    }
    if (error.code === '22023') return plain(400, `Choose a date range of up to ${MAX_RANGE_DAYS} days.`);
    return plain(500, 'Could not export attendance. Please try again.');
  }

  const { filters } = parseFilters({ ...sp, date: undefined, from, to }, today);
  const rows = applyFilters((data ?? []) as AttendanceRow[], filters);
  const body = [HEADER.join(','), ...rows.map(csvRow)].join('\r\n') + '\r\n';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
