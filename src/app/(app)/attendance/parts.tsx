import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AttendanceRow } from '@/lib/types';
import { fmtClock, fmtDate, fmtMinutes } from '@/lib/format';
import { AttendanceBadge, Avatar } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { EmptyState } from '@/components/ui';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { decideCorrectionAction, explainFlagAction } from './actions';
import { flagAmount, flagState, type CorrectionRow, type FlagRow } from './lib';
import type { AttendanceSettings, Recorded } from './data';

const pill = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

/** What is (and is not) recorded, shown on every Attendance screen. */
export function PrivacyNote({ settings }: { settings: AttendanceSettings | null }) {
  return (
    <section className="card mt-6 p-4 text-sm text-slate-700" aria-labelledby="att-privacy">
      <h2 id="att-privacy" className="font-semibold text-slate-900">How attendance is recorded</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Only these are recorded: the time you sign in with your PIN, the time you sign out, and the start and end of any break you take with the
          Break button. All use the server&apos;s clock, not the device&apos;s, and nobody can edit them directly.
        </li>
        <li>No keystrokes, screenshots, webcam footage, location or other device activity are collected.</li>
        <li>
          If you close the browser without signing out, the session is marked <strong>Incomplete Session</strong>
          {settings ? ` after ${settings.expiryHours} hours or at the end of the day` : ' when the sign-in expires or the day ends'}. No logout time is
          guessed; you can request a correction.
        </li>
        <li>
          Flags (late login, early logout, no login, incomplete session, long break, repeated patterns) are prompts to check, not findings of
          misconduct. You can add an explanation to any flag; an admin approves, rejects or waives it. Corrections are approved by an admin with the
          original times kept on record.
        </li>
      </ul>
    </section>
  );
}

function Minutes({ n }: { n: number | null | undefined }) {
  if (!n) return null;
  return <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">· {n} min</span>;
}

export function LoginStatusCell({ r }: { r: AttendanceRow }) {
  const detail = r.day_type === 'Holiday' ? r.holiday_name : r.day_type === 'On Leave' ? r.leave_type : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <AttendanceBadge status={r.login_status} />
      {(r.login_status === 'Late' || r.login_status === 'Within Grace Period') && <Minutes n={r.minutes_late} />}
      {detail && <span className="text-xs text-slate-600">· {detail}</span>}
    </span>
  );
}

export function LogoutStatusCell({ r }: { r: AttendanceRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <AttendanceBadge status={r.logout_status} />
      {r.logout_status === 'Left Early' && <Minutes n={r.minutes_early} />}
      {r.logout_status === 'Overtime' && <Minutes n={r.minutes_overtime} />}
    </span>
  );
}

export function HoursCell({ r }: { r: AttendanceRow }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {fmtMinutes(r.worked_minutes)}
      {r.open_session && <span className="ml-1 text-xs text-slate-500">so far</span>}
      {r.break_count > 0 && (
        <span className="block text-xs text-slate-500">
          after {fmtMinutes(r.break_taken_minutes)} break{r.break_count === 1 ? '' : 's'}
        </span>
      )}
      {r.incomplete_sessions > 0 && (
        <span className="block text-xs text-orange-700">
          {r.incomplete_sessions} incomplete session{r.incomplete_sessions === 1 ? '' : 's'} not counted
        </span>
      )}
    </span>
  );
}

/** Break time taken against the allowance, with a live marker while on a break. */
export function BreakCell({ r }: { r: AttendanceRow }) {
  if (r.day_type !== 'Working Day' && r.break_count === 0) return <span className="text-slate-400">—</span>;
  const over = r.break_minutes !== null && r.break_taken_minutes > r.break_minutes;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 whitespace-nowrap tabular-nums">
      <span className={over ? 'font-medium text-amber-800' : ''}>{fmtMinutes(r.break_taken_minutes)}</span>
      {r.break_minutes !== null && <span className="text-xs text-slate-500">of {fmtMinutes(r.break_minutes)}</span>}
      {r.on_break && <AttendanceBadge status="On Break" />}
    </span>
  );
}

/** Scheduled times only mean something on a working day. */
function scheduled(r: AttendanceRow, iso: string | null) {
  if (r.day_type !== 'Working Day') return <span className="text-slate-400">—</span>;
  return <span className="tabular-nums">{fmtClock(iso, r.tz)}</span>;
}

function Markers({ r, flagsHref }: { r: AttendanceRow; flagsHref?: string }) {
  if (!r.corrected && !r.open_flags && !r.pending_correction && !r.exempt) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {r.exempt && <span className={`${pill} bg-sky-50 text-sky-800 ring-sky-200`} title="Exempt from late, early and long-break flags on this day. Times are still recorded.">Exempt</span>}
      {r.corrected && <span className={`${pill} bg-blue-50 text-blue-800 ring-blue-200`} title="An admin approved a correction for this day; the original times are kept on record.">Corrected</span>}
      {r.pending_correction && <span className={`${pill} bg-white text-slate-600 ring-slate-200`}>Correction pending</span>}
      {r.open_flags > 0 &&
        (flagsHref ? (
          <Link href={flagsHref} className={`${pill} bg-amber-50 text-amber-900 ring-amber-200 hover:underline`}>
            {r.open_flags} open flag{r.open_flags === 1 ? '' : 's'}
          </Link>
        ) : (
          <span className={`${pill} bg-amber-50 text-amber-900 ring-amber-200`}>
            {r.open_flags} open flag{r.open_flags === 1 ? '' : 's'}
          </span>
        ))}
    </span>
  );
}

/**
 * The attendance sheet: Employee | Scheduled Start | Actual Login | Login Status | Scheduled End |
 * Actual Logout | Logout Status | Hours Worked (plus Date for a range; minus Employee for "my" view).
 * Times are wall-clock times in each row's own office time zone.
 */
export function AttendanceTable({
  rows,
  showEmployee,
  showDate,
  flagsHref,
  correctHref,
  employeeHref,
  empty,
}: {
  rows: AttendanceRow[];
  showEmployee: boolean;
  showDate: boolean;
  flagsHref?: string;
  correctHref?: (r: AttendanceRow) => string | null;
  employeeHref?: (r: AttendanceRow) => string;
  empty: { title: string; body?: string; action?: ReactNode };
}) {
  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} action={empty.action} />;
  const key = (r: AttendanceRow) => `${r.member_id}|${r.work_date}`;
  const correctLink = (r: AttendanceRow) => {
    const href = correctHref?.(r);
    if (!href || r.pending_correction) return null;
    return (
      <Link href={href} className="mt-1 block text-xs text-navy-700 hover:underline">
        Request a correction
      </Link>
    );
  };
  return (
    <>
      {/* Phones: cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={key(r)} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              {showEmployee ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={r.member_name} size="sm" />
                  <span className="truncate font-medium text-slate-900">{r.member_name}</span>
                </div>
              ) : (
                <span className="font-medium text-slate-900">{fmtDate(r.work_date)}</span>
              )}
              <span className="text-right text-xs text-slate-500">
                {showEmployee && showDate && <span className="block">{fmtDate(r.work_date)}</span>}
                <span className="tabular-nums">{fmtMinutes(r.worked_minutes)}{r.open_session ? ' so far' : ''}</span>
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {(r.break_count > 0 || r.on_break) && (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">Breaks</dt>
                  <dd><BreakCell r={r} /></dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-slate-500">Login{r.day_type === 'Working Day' ? ` (scheduled ${fmtClock(r.scheduled_start, r.tz)})` : ''}</dt>
                <dd className="tabular-nums">{fmtClock(r.first_login, r.tz)}</dd>
                <dd className="mt-1"><LoginStatusCell r={r} /></dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Logout{r.day_type === 'Working Day' ? ` (scheduled ${fmtClock(r.scheduled_end, r.tz)})` : ''}</dt>
                <dd className="tabular-nums">{fmtClock(r.last_logout, r.tz)}</dd>
                <dd className="mt-1"><LogoutStatusCell r={r} /></dd>
              </div>
            </dl>
            {r.incomplete_sessions > 0 && (
              <p className="mt-1 text-xs text-orange-700">
                {r.incomplete_sessions} incomplete session{r.incomplete_sessions === 1 ? '' : 's'} not counted in hours
              </p>
            )}
            <Markers r={r} flagsHref={flagsHref} />
            {correctLink(r)}
          </li>
        ))}
      </ul>

      {/* Tablet / desktop: sheet */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="sheet">
          <thead>
            <tr>
              {showDate && <th>Date</th>}
              {showEmployee && <th>Employee</th>}
              <th>Scheduled Start</th>
              <th>Actual Login</th>
              <th>Login Status</th>
              <th>Scheduled End</th>
              <th>Actual Logout</th>
              <th>Logout Status</th>
              <th>Breaks</th>
              <th>Hours Worked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={key(r)}>
                {showDate && (
                  <td className="whitespace-nowrap tabular-nums">
                    {fmtDate(r.work_date)}
                    {!showEmployee && <Markers r={r} flagsHref={flagsHref} />}
                    {!showEmployee && correctLink(r)}
                  </td>
                )}
                {showEmployee && (
                  <td className="min-w-44">
                    <span className="flex items-center gap-2 whitespace-nowrap font-medium text-slate-900">
                      <Avatar name={r.member_name} size="sm" />
                      {employeeHref ? (
                        <Link href={employeeHref(r)} className="hover:underline" title={`Show only ${r.member_name}`}>
                          {r.member_name}
                        </Link>
                      ) : (
                        r.member_name
                      )}
                    </span>
                    <Markers r={r} flagsHref={flagsHref} />
                  </td>
                )}
                <td className="whitespace-nowrap">{scheduled(r, r.scheduled_start)}</td>
                <td className="whitespace-nowrap tabular-nums">{fmtClock(r.first_login, r.tz)}</td>
                <td><LoginStatusCell r={r} /></td>
                <td className="whitespace-nowrap">{scheduled(r, r.scheduled_end)}</td>
                <td className="whitespace-nowrap tabular-nums">{fmtClock(r.last_logout, r.tz)}</td>
                <td><LogoutStatusCell r={r} /></td>
                <td><BreakCell r={r} /></td>
                <td><HoursCell r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** "Times are in Asia/Kolkata" (or each person's zone when they differ). */
export function TimeZoneNote({ zones }: { zones: string[] }) {
  const u = Array.from(new Set(zones));
  if (u.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-slate-500">
      Times are office time ({u.join(', ')}), taken from the server clock at sign-in and sign-out.
      {u.length > 1 && ' Each row uses that person’s own time zone.'}
    </p>
  );
}

function flagActual(f: FlagRow, tz: string) {
  if (f.actual_at) return fmtClock(f.actual_at, tz);
  if (f.flag_type === 'No Login') return 'No sign-in';
  if (f.flag_type === 'Incomplete Session') return 'Not signed out';
  return '—';
}

/** A person's own flags as cards (open first), where they can add an explanation. Admins decide them in the exception queue. */
export function FlagList({
  flags,
  names,
  tzFor,
  empty,
}: {
  flags: FlagRow[];
  names: Map<string, string>;
  tzFor: (memberId: string, date: string) => string;
  empty: { title: string; body?: string; action?: ReactNode };
}) {
  if (flags.length === 0) return <EmptyState title={empty.title} body={empty.body} action={empty.action} />;
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {flags.map((f) => {
        const tz = tzFor(f.member_id, f.work_date);
        const repeated = f.flag_type.startsWith('Repeated');
        const state = flagState(f);
        return (
          <li key={f.id} className={`card border-l-4 p-4 ${f.status === 'Open' ? 'border-l-amber-500' : f.status === 'Reviewed' ? 'border-l-slate-400' : 'border-l-green-600'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{f.flag_type}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{fmtDate(f.work_date)}</span>
                </div>
              </div>
              <AttendanceBadge status={state} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="label">{repeated ? 'Window' : 'Expected'}</dt>
                <dd className="tabular-nums">{repeated ? 'Recent days' : fmtClock(f.expected_at, tz)}</dd>
              </div>
              <div>
                <dt className="label">Actual</dt>
                <dd className="tabular-nums">{repeated ? '—' : flagActual(f, tz)}</dd>
              </div>
              <div>
                <dt className="label">{repeated ? 'Count' : 'Minutes'}</dt>
                <dd className="tabular-nums">{flagAmount(f)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-slate-700">{f.reason}</p>
            <div className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm">
              <div className="text-[13px] font-medium text-slate-500">Your explanation</div>
              <p className={`mt-0.5 whitespace-pre-wrap ${f.employee_explanation ? 'text-slate-800' : 'text-slate-500'}`}>{f.employee_explanation || 'No explanation yet.'}</p>
            </div>
            {f.status !== 'Open' && (
              <p className="mt-2 text-xs text-slate-600">
                {state} by {f.reviewed_by ? names.get(f.reviewed_by) ?? 'an admin' : 'an admin'}
                {f.reviewed_at && <> · <LocalTime iso={f.reviewed_at} /></>}
                {f.review_note && <span className="block text-sm text-slate-700">Note: {f.review_note}</span>}
              </p>
            )}
            {f.status !== 'Resolved' && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-navy-700">{f.employee_explanation ? 'Edit explanation' : 'Add explanation'}</summary>
                <ActionForm action={explainFlagAction} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={f.id} />
                  <label className="label" htmlFor={`ex-${f.id}`}>Explanation</label>
                  <textarea id={`ex-${f.id}`} name="explanation" rows={3} className="input" required minLength={3} maxLength={1000} defaultValue={f.employee_explanation} placeholder="e.g. Metro delay; I informed my lead at 9:50" />
                  <div className="flex justify-end">
                    <SubmitButton className="btn-secondary">Save explanation</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TimePair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Correction requests as cards. Requested and original times are shown in that day's office time. */
export function CorrectionList({
  rows,
  names,
  recorded,
  tzFor,
  mode,
  empty,
}: {
  rows: CorrectionRow[];
  names: Map<string, string>;
  recorded: Map<string, Recorded>;
  tzFor: (memberId: string, date: string) => string;
  mode: 'admin' | 'self';
  empty: { title: string; body?: string };
}) {
  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} />;
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {rows.map((c) => {
        const rec = recorded.get(`${c.member_id}|${c.work_date}`);
        const tz = rec?.tz ?? tzFor(c.member_id, c.work_date);
        // After approval the database stores the times that were replaced; otherwise show what is recorded now.
        const origLogin = c.status === 'Approved' ? c.original_login_at : rec?.login ?? null;
        const origLogout = c.status === 'Approved' ? c.original_logout_at : rec?.logout ?? null;
        const origLogoutText = origLogout ? fmtClock(origLogout, tz) : c.status !== 'Approved' && rec?.incomplete ? 'Not signed out' : '—';
        return (
          <li key={c.id} className={`card border-l-4 p-4 ${c.status === 'Pending' ? 'border-l-blue-500' : c.status === 'Approved' ? 'border-l-green-600' : 'border-l-slate-400'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-slate-900">{mode === 'admin' ? names.get(c.member_id) ?? 'Former member' : fmtDate(c.work_date)}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {mode === 'admin' && <>{fmtDate(c.work_date)} · </>}requested <LocalTime iso={c.created_at} />
                </div>
              </div>
              <AttendanceBadge status={c.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <TimePair label="Requested login" value={c.requested_login_at ? fmtClock(c.requested_login_at, tz) : 'No change'} />
              <TimePair label="Requested logout" value={c.requested_logout_at ? fmtClock(c.requested_logout_at, tz) : 'No change'} />
              <TimePair label={c.status === 'Approved' ? 'Original login' : 'Recorded login'} value={origLogin ? fmtClock(origLogin, tz) : '—'} />
              <TimePair label={c.status === 'Approved' ? 'Original logout' : 'Recorded logout'} value={origLogoutText} />
            </dl>
            <p className="mt-1 text-xs text-slate-500">Office time ({tz})</p>
            <div className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm">
              <div className="text-[13px] font-medium text-slate-500">Reason</div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{c.reason}</p>
            </div>
            {c.status !== 'Pending' && (
              <p className="mt-2 text-xs text-slate-600">
                {c.status} by {c.decided_by ? names.get(c.decided_by) ?? 'an admin' : 'an admin'}
                {c.decided_at && <> · <LocalTime iso={c.decided_at} /></>}
                {c.decision_note && <span className="block text-sm text-slate-700">Note: {c.decision_note}</span>}
              </p>
            )}
            {mode === 'admin' && c.status === 'Pending' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <ConfirmAction
                  action={decideCorrectionAction}
                  label="Approve"
                  title="Approve this correction?"
                  body="The corrected times will be used for that day's statuses and hours. The original sign-in and sign-out times are kept, the decision is written to the audit log, and that day's open flags are resolved."
                  confirmLabel="Approve"
                  className="btn-primary"
                  hidden={{ id: c.id, approve: '1' }}
                  withNote
                />
                <ConfirmAction
                  action={decideCorrectionAction}
                  label="Reject"
                  title="Reject this correction?"
                  body="The recorded times stay as they are. The employee will see that the request was rejected, with your note."
                  confirmLabel="Reject"
                  className="btn-secondary"
                  hidden={{ id: c.id, approve: '0' }}
                  withNote
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
