import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate, friendlyError } from '@/lib/format';
import { Avatar } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { setScheduleAction } from '../actions';
import { dbToday, loadSchedules, memberNames } from '../data';
import { DAY_LABELS, DEFAULT_TZ, UUID_RE, daysLabel, hhmm, scheduleOn, timeZoneOptions, type ScheduleRow } from '../lib';

export const metadata = { title: 'Work schedules' };

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ member?: string | string[] }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ today, error: todayError }, members, schedules, names] = await Promise.all([
    dbToday(supabase),
    activeMembers(),
    loadSchedules(supabase),
    memberNames(supabase),
  ]);

  const header = (
    <PageHeader
      title="Work schedules"
      subtitle="Each person's shift, working days, break and grace period. Attendance statuses are judged against the schedule that applied on each date."
      actions={<Link href="/attendance" className="btn-secondary">Back to Attendance</Link>}
    />
  );
  if (!today) {
    return (
      <>
        {header}
        <Notice tone="error">Could not load today&apos;s date from the database ({friendlyError(todayError)}). Please refresh the page.</Notice>
      </>
    );
  }

  const rows = schedules.rows;
  const byMember = new Map<string, ScheduleRow[]>();
  for (const s of rows) byMember.set(s.member_id, [...(byMember.get(s.member_id) ?? []), s]);
  const current = members.map((m) => ({
    member: m,
    now: scheduleOn(rows, m.id, today),
    next: (byMember.get(m.id) ?? []).filter((s) => s.effective_from > today),
  }));

  const memberParam = Array.isArray(sp.member) ? sp.member[0] : sp.member;
  const selected = memberParam && UUID_RE.test(memberParam) && members.some((m) => m.id === memberParam) ? memberParam : '';
  const base = selected ? scheduleOn(rows, selected, today) : null;
  const zones = timeZoneOptions(Array.from(new Set(rows.map((s) => s.timezone))));
  const formDays = base?.working_days ?? [1, 2, 3, 4, 5, 6];

  return (
    <>
      {header}
      {schedules.error && <Notice tone="error">Could not load schedules: {friendlyError(schedules.error)}</Notice>}
      <Notice>
        A change applies from the date you choose (today or later). Days before that keep the schedule they had, so past statuses and hours never
        change. Saving another change for the same person and start date replaces that one.
      </Notice>

      <SectionTitle>Current schedules · {fmtDate(today)}</SectionTitle>
      {current.length === 0 ? (
        <EmptyState title="No active members" body="Add people on the Team page first." />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {current.map(({ member, now, next }) => (
              <li key={member.id} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-navy-900">
                    <Avatar name={member.name} size="sm" />
                    <span className="truncate">{member.name}</span>
                  </span>
                  <Link href={`/attendance/schedules?member=${member.id}#set`} className="text-sm text-navy-700 hover:underline">Change</Link>
                </div>
                {now ? (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <div><dt className="text-xs text-slate-500">Hours</dt><dd className="tabular-nums">{hhmm(now.start_time)}–{hhmm(now.end_time)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Working days</dt><dd>{daysLabel(now.working_days)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Break / grace</dt><dd>{now.break_minutes} / {now.grace_minutes} min</dd></div>
                    <div><dt className="text-xs text-slate-500">Time zone</dt><dd>{now.timezone}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-slate-500">Effective from</dt><dd>{fmtDate(now.effective_from)}</dd></div>
                    {now.note && <div className="col-span-2 text-xs text-slate-600">{now.note}</div>}
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">No schedule yet{next.length ? '' : ': attendance shows "No Schedule" for this person'}.</p>
                )}
                {next.map((s) => (
                  <p key={s.id} className="mt-2 text-xs text-blue-800">
                    From {fmtDate(s.effective_from)}: {hhmm(s.start_time)}–{hhmm(s.end_time)} · {daysLabel(s.working_days)}
                  </p>
                ))}
              </li>
            ))}
          </ul>

          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Working Days</th>
                  <th className="text-right">Break</th>
                  <th className="text-right">Grace</th>
                  <th>Time Zone</th>
                  <th>Effective From</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {current.map(({ member, now, next }) => (
                  <tr key={member.id} className={member.id === selected ? 'bg-navy-100' : ''}>
                    <td className="whitespace-nowrap">
                      <span className="flex items-center gap-2 font-medium text-navy-900">
                        <Avatar name={member.name} size="sm" />
                        {member.name}
                      </span>
                      {next.map((s) => (
                        <span key={s.id} className="mt-1 block text-xs text-blue-800">
                          From {fmtDate(s.effective_from)}: {hhmm(s.start_time)}–{hhmm(s.end_time)} · {daysLabel(s.working_days)}
                        </span>
                      ))}
                    </td>
                    {now ? (
                      <>
                        <td className="tabular-nums">{hhmm(now.start_time)}</td>
                        <td className="tabular-nums">{hhmm(now.end_time)}</td>
                        <td className="whitespace-nowrap" title={now.working_days.map((d) => DAY_LABELS[d - 1]).join(', ')}>{daysLabel(now.working_days)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{now.break_minutes} min</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{now.grace_minutes} min</td>
                        <td className="whitespace-nowrap">{now.timezone}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtDate(now.effective_from)}</td>
                        <td className="max-w-64 text-slate-600"><span className="line-clamp-2">{now.note || '—'}</span></td>
                      </>
                    ) : (
                      <td colSpan={8} className="text-slate-500">No schedule yet. Attendance shows &ldquo;No Schedule&rdquo; until one starts.</td>
                    )}
                    <td className="whitespace-nowrap">
                      <Link href={`/attendance/schedules?member=${member.id}#set`} className="text-sm text-navy-700 hover:underline">Change</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <section id="set" className="scroll-mt-4">
        <SectionTitle>Set a new schedule</SectionTitle>
        <ActionForm key={selected || 'new'} action={setScheduleAction} className="card space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="s-member">Employee</label>
              <select id="s-member" name="member_id" className="input" defaultValue={selected} required>
                <option value="" disabled>Choose…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="s-from">Effective from</label>
              <input id="s-from" type="date" name="effective_from" className="input" required min={today} defaultValue={today} />
            </div>
            <div>
              <label className="label" htmlFor="s-start">Start time</label>
              <input id="s-start" type="time" name="start_time" className="input" required defaultValue={base ? hhmm(base.start_time) : '10:00'} />
            </div>
            <div>
              <label className="label" htmlFor="s-end">End time</label>
              <input id="s-end" type="time" name="end_time" className="input" required defaultValue={base ? hhmm(base.end_time) : '19:00'} />
            </div>
            <div>
              <label className="label" htmlFor="s-break">Break (minutes)</label>
              <input id="s-break" type="number" name="break_minutes" className="input" required min={0} max={240} step={1} defaultValue={base?.break_minutes ?? 60} />
            </div>
            <div>
              <label className="label" htmlFor="s-grace">Grace period (minutes)</label>
              <input id="s-grace" type="number" name="grace_minutes" className="input" required min={0} max={120} step={1} defaultValue={base?.grace_minutes ?? 10} />
            </div>
          </div>
          <fieldset>
            <legend className="label">Working days</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {DAY_LABELS.map((label, i) => (
                <label key={label} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="days" value={i + 1} defaultChecked={formDays.includes(i + 1)} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="s-tz">Time zone</label>
              <select id="s-tz" name="timezone" className="input" required defaultValue={base?.timezone ?? DEFAULT_TZ}>
                <optgroup label="Common">
                  {zones.common.map((z) => <option key={z}>{z}</option>)}
                </optgroup>
                <optgroup label="All time zones">
                  {zones.all.map((z) => <option key={z}>{z}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="s-note">Note</label>
              <input id="s-note" name="note" className="input" maxLength={500} placeholder="e.g. Early shift from November" />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Shifts start and end on the same day. Arriving within the grace period counts as &ldquo;Within Grace Period&rdquo;, not late. The break is
            shown for reference; hours worked are measured from sign-in to sign-out.
          </p>
          <div className="flex justify-end">
            <SubmitButton>Save schedule</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <SectionTitle>Schedule history</SectionTitle>
      {rows.length === 0 ? (
        <EmptyState title="No schedules yet" body="Every new member gets a default 10:00–19:00, Monday to Saturday schedule until you change it." />
      ) : (
        <div className="space-y-2">
          {Array.from(byMember.entries())
            .sort((a, b) => (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''))
            .map(([memberId, list]) => (
              <details key={memberId} className="card p-3" open={memberId === selected}>
                <summary className="cursor-pointer font-medium text-navy-900">
                  {names.get(memberId) ?? 'Former member'} <span className="text-xs font-normal text-slate-500">· {list.length} schedule{list.length === 1 ? '' : 's'}</span>
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="sheet">
                    <thead>
                      <tr>
                        <th>Effective From</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Working Days</th>
                        <th className="text-right">Break</th>
                        <th className="text-right">Grace</th>
                        <th>Time Zone</th>
                        <th>Note</th>
                        <th>Set By</th>
                        <th>Saved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((s) => {
                        const inForce = scheduleOn(rows, memberId, today)?.id === s.id;
                        return (
                          <tr key={s.id} className={inForce ? 'bg-navy-50' : ''}>
                            <td className="whitespace-nowrap tabular-nums">
                              {fmtDate(s.effective_from)}
                              {inForce && <span className="ml-1 text-xs text-green-700">(current)</span>}
                              {s.effective_from > today && <span className="ml-1 text-xs text-blue-800">(upcoming)</span>}
                            </td>
                            <td className="tabular-nums">{hhmm(s.start_time)}</td>
                            <td className="tabular-nums">{hhmm(s.end_time)}</td>
                            <td className="whitespace-nowrap">{daysLabel(s.working_days)}</td>
                            <td className="whitespace-nowrap text-right tabular-nums">{s.break_minutes} min</td>
                            <td className="whitespace-nowrap text-right tabular-nums">{s.grace_minutes} min</td>
                            <td className="whitespace-nowrap">{s.timezone}</td>
                            <td className="max-w-64 text-slate-600"><span className="line-clamp-2">{s.note || '—'}</span></td>
                            <td className="whitespace-nowrap">{s.created_by ? names.get(s.created_by) ?? '—' : 'System default'}</td>
                            <td className="whitespace-nowrap text-xs text-slate-600"><LocalTime iso={s.updated_at ?? s.created_at} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
        </div>
      )}
    </>
  );
}
