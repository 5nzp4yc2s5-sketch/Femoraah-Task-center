import Link from 'next/link';
import { requireArea } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate, friendlyError } from '@/lib/format';
import { Avatar } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { followDefaultAction, setScheduleAction } from '../actions';
import { dbToday, loadSchedules, memberNames, scheduleOverview, type ScheduleOverview } from '../data';
import { DAY_LABELS, DEFAULT_TZ, UUID_RE, daysLabel, hhmm, scheduleOn, timeZoneOptions, type ScheduleRow } from '../lib';

export const metadata = { title: 'Work schedules' };

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ member?: string | string[] }> }) {
  await requireArea('attendance');
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ today, error: todayError }, members, schedules, names, overview] = await Promise.all([
    dbToday(supabase),
    activeMembers(),
    loadSchedules(supabase),
    memberNames(supabase),
    scheduleOverview(supabase),
  ]);

  const header = (
    <PageHeader
      title="Work schedules"
      subtitle="Each person's shift, working days, break and grace period: their own schedule, or their team or company default. Attendance is judged against the hours that applied on each date."
      actions={
        <>
          <Link href="/settings#hours" className="btn-secondary">Default hours</Link>
          <Link href="/attendance" className="btn-secondary">Back to Attendance</Link>
        </>
      }
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
  const ov = new Map(overview.rows.map((o) => [o.member_id, o]));
  const current = members.map((m) => ({
    member: m,
    now: ov.get(m.id) ?? null,
    next: (byMember.get(m.id) ?? []).filter((s) => s.effective_from > today),
  }));
  const sourceLabel = (o: ScheduleOverview) =>
    o.source === 'Personal' ? 'Own schedule' : o.source === 'Team' ? `${o.team_name ?? 'Team'} default` : o.source === 'Company' ? 'Company default' : '—';
  const upcomingText = (s: ScheduleRow) =>
    s.follows_default ? `From ${fmtDate(s.effective_from)}: follows the defaults` : `From ${fmtDate(s.effective_from)}: ${hhmm(s.start_time)}–${hhmm(s.end_time)} · ${daysLabel(s.working_days)}`;

  const memberParam = Array.isArray(sp.member) ? sp.member[0] : sp.member;
  const selected = memberParam && UUID_RE.test(memberParam) && members.some((m) => m.id === memberParam) ? memberParam : '';
  const base = selected ? ov.get(selected) ?? null : null;
  const zones = timeZoneOptions(Array.from(new Set(rows.map((s) => s.timezone))));
  const formDays = base?.working_days ?? [1, 2, 3, 4, 5, 6];

  return (
    <>
      {header}
      {schedules.error && <Notice tone="error">Could not load schedules: {friendlyError(schedules.error)}</Notice>}
      {overview.error && <Notice tone="error">Could not load current hours: {friendlyError(overview.error)}</Notice>}
      <Notice>
        A change applies from the date you choose (today or later). Days before that keep the schedule they had, so past statuses and hours never
        change. Saving another change for the same person and start date replaces that one. People who follow the defaults get their hours from
        their team or the company, set in <Link href="/settings#hours" className="font-medium underline">Settings</Link>.
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
                {now?.start_time ? (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <div><dt className="text-xs text-slate-500">Hours</dt><dd className="tabular-nums">{hhmm(now.start_time)}–{hhmm(now.end_time)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Working days</dt><dd>{daysLabel(now.working_days)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Break / grace</dt><dd>{now.break_minutes} / {now.grace_minutes} min</dd></div>
                    <div><dt className="text-xs text-slate-500">Time zone</dt><dd>{now.timezone}</dd></div>
                    <div><dt className="text-xs text-slate-500">Hours from</dt><dd>{sourceLabel(now)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Team</dt><dd>{now.team_name ?? '—'}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">No schedule yet{next.length ? '' : ': attendance shows "No Schedule" for this person'}.</p>
                )}
                {next.map((s) => (
                  <p key={s.id} className="mt-2 text-xs text-blue-800">{upcomingText(s)}</p>
                ))}
              </li>
            ))}
          </ul>

          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Team</th>
                  <th>Hours From</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Working Days</th>
                  <th className="text-right">Break</th>
                  <th className="text-right">Grace</th>
                  <th>Time Zone</th>
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
                        <span key={s.id} className="mt-1 block text-xs text-blue-800">{upcomingText(s)}</span>
                      ))}
                    </td>
                    {now?.start_time ? (
                      <>
                        <td className="whitespace-nowrap">{now.team_name ?? <span className="text-slate-400">—</span>}</td>
                        <td className="whitespace-nowrap">
                          {sourceLabel(now)}
                          {now.exempt && <span className="ml-1 text-xs text-sky-800">· exempt</span>}
                        </td>
                        <td className="tabular-nums">{hhmm(now.start_time)}</td>
                        <td className="tabular-nums">{hhmm(now.end_time)}</td>
                        <td className="whitespace-nowrap" title={(now.working_days ?? []).map((d) => DAY_LABELS[d - 1]).join(', ')}>{daysLabel(now.working_days)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{now.break_minutes} min</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{now.grace_minutes} min</td>
                        <td className="whitespace-nowrap">{now.timezone}</td>
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
        <SectionTitle>Set a personal schedule</SectionTitle>
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
            Shifts start and end on the same day. Arriving within the grace period counts as &ldquo;Within Grace Period&rdquo;, not late. Hours worked
            are measured from sign-in to sign-out, minus breaks recorded with the Break button. A personal schedule replaces the team or company
            default for this person from its start date.
          </p>
          <div className="flex justify-end">
            <SubmitButton>Save schedule</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section id="follow" className="scroll-mt-4">
        <SectionTitle>Follow the default hours</SectionTitle>
        <ActionForm key={`follow-${selected || 'new'}`} action={followDefaultAction} className="card grid gap-3 p-4 sm:grid-cols-3 sm:items-end">
          <div>
            <label className="label" htmlFor="f-member">Person</label>
            <select id="f-member" name="member_id" className="input" defaultValue={selected} required>
              <option value="" disabled>Choose…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-from">From</label>
            <input id="f-from" type="date" name="effective_from" className="input" required min={today} defaultValue={today} />
          </div>
          <SubmitButton>Follow defaults</SubmitButton>
          <p className="text-xs text-slate-500 sm:col-span-3">
            From that date the person&apos;s hours and weekly offs come from their team&apos;s default, or the company default when the team has none.
            Their own schedule stays in the history below.
          </p>
        </ActionForm>
      </section>

      <SectionTitle>Schedule history</SectionTitle>
      {rows.length === 0 ? (
        <EmptyState title="No schedules yet" body="Every new member follows the company default hours until you set a personal schedule." />
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
                            {s.follows_default ? (
                              <td colSpan={6} className="text-slate-600">Follows the team or company default hours</td>
                            ) : (
                              <>
                                <td className="tabular-nums">{hhmm(s.start_time)}</td>
                                <td className="tabular-nums">{hhmm(s.end_time)}</td>
                                <td className="whitespace-nowrap">{daysLabel(s.working_days)}</td>
                                <td className="whitespace-nowrap text-right tabular-nums">{s.break_minutes} min</td>
                                <td className="whitespace-nowrap text-right tabular-nums">{s.grace_minutes} min</td>
                                <td className="whitespace-nowrap">{s.timezone}</td>
                              </>
                            )}
                            <td className="max-w-64 text-slate-600"><span className="line-clamp-2">{s.note || '—'}</span></td>
                            <td className="whitespace-nowrap">{s.created_by ? names.get(s.created_by) ?? '—' : 'System'}</td>
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
