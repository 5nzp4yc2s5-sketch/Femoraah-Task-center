import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, friendlyError } from '@/lib/format';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EmptyState, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { dbToday, loadTeams, scheduleOverview } from '../attendance/data';
import { DAY_LABELS, DEFAULT_TZ, daysLabel, hhmm, timeZoneOptions } from '../attendance/lib';
import { attendanceRulesAction, saveTeamAction, setDefaultHoursAction, setMemberTeamAction } from './actions';

export const metadata = { title: 'Settings' };

interface DefaultRow {
  id: string;
  team_id: string | null;
  effective_from: string;
  start_time: string;
  end_time: string;
  working_days: number[];
  break_minutes: number;
  grace_minutes: number;
  timezone: string;
  note: string;
}

interface MemberTeamRow {
  member_id: string;
  team_id: string | null;
  effective_from: string;
}

/** The default in force on a date for a team (null = company). */
function inForce(rows: DefaultRow[], team: string | null, date: string): DefaultRow | null {
  let best: DefaultRow | null = null;
  for (const r of rows) {
    if (r.team_id !== team || r.effective_from > date) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best;
}

function offDays(days: number[]): string {
  const off = [1, 2, 3, 4, 5, 6, 7].filter((d) => !days.includes(d));
  return off.length ? off.map((d) => DAY_LABELS[d - 1]).join(', ') : 'None';
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ team?: string | string[] }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ today, error: todayError }, teams, overview, defaultsRes, memberTeamsRes, settingsRes] = await Promise.all([
    dbToday(supabase),
    loadTeams(supabase),
    scheduleOverview(supabase),
    supabase.from('schedule_defaults').select('*').order('effective_from', { ascending: false }),
    supabase.from('member_teams').select('member_id, team_id, effective_from').order('effective_from'),
    supabase.from('app_settings').select('late_logout_flag_minutes, long_break_grace_minutes, timezone').limit(1).maybeSingle(),
  ]);
  const header = <PageHeader title="Settings" subtitle="Teams, default working hours and weekly offs, and attendance rules." />;
  if (!today) {
    return (
      <>
        {header}
        <Notice tone="error">Could not load today&apos;s date from the database ({friendlyError(todayError)}). Please refresh the page.</Notice>
      </>
    );
  }
  const defaults = (defaultsRes.data ?? []) as DefaultRow[];
  const memberTeams = (memberTeamsRes.data ?? []) as MemberTeamRow[];
  const settings = settingsRes.data as { late_logout_flag_minutes: number | null; long_break_grace_minutes: number; timezone: string } | null;
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const people = overview.rows.filter((r) => r.is_active);
  const zones = timeZoneOptions(Array.from(new Set(defaults.map((d) => d.timezone))));
  const teamParam = Array.isArray(sp.team) ? sp.team[0] : sp.team;
  const formTeam = teamParam && teams.some((t) => t.id === teamParam) ? teamParam : '';
  const base = inForce(defaults, formTeam || null, today) ?? inForce(defaults, null, today);
  const formDays = base?.working_days ?? [1, 2, 3, 4, 5, 6];

  const scopes: { id: string | null; label: string }[] = [{ id: null, label: 'Company default' }, ...teams.filter((t) => t.is_active).map((t) => ({ id: t.id, label: t.name }))];
  const followers = (team: string | null) => people.filter((p) => p.follows_default && (team === null ? p.source === 'Company' : p.team_id === team && p.source === 'Team')).length;

  return (
    <>
      {header}
      {(defaultsRes.error || overview.error) && <Notice tone="error">Could not load settings: {friendlyError(defaultsRes.error?.message ?? overview.error)}</Notice>}

      <section id="hours" className="scroll-mt-4">
        <SectionTitle>Default working hours and weekly offs</SectionTitle>
        <p className="mb-2 text-sm text-slate-600">
          Each person&apos;s hours come from their own schedule if they have one, otherwise from their team&apos;s default, otherwise from the company
          default. Days that are not working days are weekly offs: no sign-in is expected and nothing is flagged. Personal schedules are on{' '}
          <Link href="/attendance/schedules" className="text-navy-700 underline">Attendance &rsaquo; Schedules</Link>.
        </p>
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr>
                <th>Applies to</th>
                <th>Hours</th>
                <th>Working days</th>
                <th>Weekly off</th>
                <th className="text-right">Break</th>
                <th className="text-right">Grace</th>
                <th>Time zone</th>
                <th>Since</th>
                <th className="text-right">People following</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {scopes.map((sc) => {
                const now = inForce(defaults, sc.id, today);
                const next = defaults.filter((d) => d.team_id === sc.id && d.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
                return (
                  <tr key={sc.id ?? 'company'}>
                    <td className="whitespace-nowrap font-medium text-navy-900">
                      {sc.label}
                      {next.map((n) => (
                        <span key={n.id} className="mt-1 block text-xs font-normal text-blue-800">
                          From {fmtDate(n.effective_from)}: {hhmm(n.start_time)}–{hhmm(n.end_time)} · {daysLabel(n.working_days)}
                        </span>
                      ))}
                    </td>
                    {now ? (
                      <>
                        <td className="whitespace-nowrap tabular-nums">{hhmm(now.start_time)}–{hhmm(now.end_time)}</td>
                        <td className="whitespace-nowrap">{daysLabel(now.working_days)}</td>
                        <td className="whitespace-nowrap">{offDays(now.working_days)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{now.break_minutes} min</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{now.grace_minutes} min</td>
                        <td className="whitespace-nowrap">{now.timezone}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtDate(now.effective_from)}</td>
                      </>
                    ) : (
                      <td colSpan={7} className="text-slate-500">
                        {sc.id ? 'No team default: people in this team use the company default.' : 'No company default yet.'}
                      </td>
                    )}
                    <td className="text-right tabular-nums">{followers(sc.id)}</td>
                    <td className="whitespace-nowrap">
                      <Link href={`/settings?team=${sc.id ?? ''}#set-hours`} className="text-sm text-navy-700 hover:underline">Change</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <ActionForm key={formTeam || 'company'} action={setDefaultHoursAction} className="card mt-3 space-y-4 p-4 sm:p-5">
          <h3 id="set-hours" className="scroll-mt-4 font-semibold text-navy-900">Set default hours</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="d-team">Applies to</label>
              <select id="d-team" name="team_id" className="input" defaultValue={formTeam}>
                <option value="">Company default (everyone without a team default)</option>
                {teams.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>Team: {t.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="d-from">Effective from</label>
              <input id="d-from" type="date" name="effective_from" className="input" required min={today} defaultValue={today} />
            </div>
            <div>
              <label className="label" htmlFor="d-start">Start time</label>
              <input id="d-start" type="time" name="start_time" className="input" required defaultValue={base ? hhmm(base.start_time) : '10:00'} />
            </div>
            <div>
              <label className="label" htmlFor="d-end">End time</label>
              <input id="d-end" type="time" name="end_time" className="input" required defaultValue={base ? hhmm(base.end_time) : '19:00'} />
            </div>
            <div>
              <label className="label" htmlFor="d-break">Break allowance (minutes)</label>
              <input id="d-break" type="number" name="break_minutes" className="input" required min={0} max={240} step={1} defaultValue={base?.break_minutes ?? 60} />
            </div>
            <div>
              <label className="label" htmlFor="d-grace">Grace period (minutes)</label>
              <input id="d-grace" type="number" name="grace_minutes" className="input" required min={0} max={120} step={1} defaultValue={base?.grace_minutes ?? 10} />
            </div>
          </div>
          <fieldset>
            <legend className="label">Working days (unticked days are weekly offs)</legend>
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
              <label className="label" htmlFor="d-tz">Time zone</label>
              <select id="d-tz" name="timezone" className="input" required defaultValue={base?.timezone ?? settings?.timezone ?? DEFAULT_TZ}>
                <optgroup label="Common">
                  {zones.common.map((z) => <option key={z}>{z}</option>)}
                </optgroup>
                <optgroup label="All time zones">
                  {zones.all.map((z) => <option key={z}>{z}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="d-note">Note</label>
              <input id="d-note" name="note" className="input" maxLength={500} placeholder="e.g. Saturdays off from November" />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            A change applies from the date you choose (today or later), only to people who follow the defaults. Earlier days keep the hours they had.
            Saving again for the same team and date replaces that change.
          </p>
          <div className="flex justify-end">
            <SubmitButton>Save default hours</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section id="teams" className="scroll-mt-4">
        <SectionTitle>Teams</SectionTitle>
        {teams.length === 0 ? (
          <EmptyState title="No teams yet" body="Add a team to give a group of people their own default hours and to filter attendance and exceptions by team." />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {teams.map((t) => {
              const now = people.filter((p) => p.team_id === t.id);
              return (
                <li key={t.id} className="card p-4">
                  <ActionForm action={saveTeamAction} className="space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <label className="label" htmlFor={`t-name-${t.id}`}>Team name</label>
                        <input id={`t-name-${t.id}`} name="name" className="input" required maxLength={60} defaultValue={t.name} />
                      </div>
                      <div>
                        <label className="label" htmlFor={`t-act-${t.id}`}>Status</label>
                        <select id={`t-act-${t.id}`} name="is_active" className="input" defaultValue={t.is_active ? '1' : '0'}>
                          <option value="1">Active</option>
                          <option value="0">Archived</option>
                        </select>
                      </div>
                    </div>
                    <input name="note" className="input" maxLength={500} defaultValue={t.note} placeholder="Note (optional)" aria-label={`Note for ${t.name}`} />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        {now.length ? `${now.length} ${now.length === 1 ? 'person' : 'people'}: ${now.map((p) => p.member_name).join(', ')}` : 'Nobody in this team today'}
                      </p>
                      <SubmitButton className="btn-secondary">Save</SubmitButton>
                    </div>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={saveTeamAction} resetOnSuccess className="card mt-3 flex flex-col gap-2 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="t-new">New team</label>
            <input id="t-new" name="name" className="input" required maxLength={60} placeholder="e.g. Warehouse" />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="t-new-note">Note</label>
            <input id="t-new-note" name="note" className="input" maxLength={500} placeholder="Optional" />
          </div>
          <SubmitButton>Add team</SubmitButton>
        </ActionForm>
      </section>

      <section id="people" className="scroll-mt-4">
        <SectionTitle>Who is in which team</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Team today</th>
                <th>Hours from</th>
                <th>Hours today</th>
                <th>Upcoming change</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const next = memberTeams.filter((m) => m.member_id === p.member_id && m.effective_from > today);
                return (
                  <tr key={p.member_id}>
                    <td className="whitespace-nowrap font-medium text-navy-900">{p.member_name}</td>
                    <td className="whitespace-nowrap">{p.team_name ?? <span className="text-slate-500">No team</span>}</td>
                    <td className="whitespace-nowrap">{p.source === 'Personal' ? 'Own schedule' : p.source === 'Team' ? 'Team default' : p.source === 'Company' ? 'Company default' : '—'}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {p.start_time ? `${hhmm(p.start_time)}–${hhmm(p.end_time)} · ${daysLabel(p.working_days)}` : 'No schedule'}
                    </td>
                    <td className="text-xs text-blue-800">
                      {next.map((n) => (
                        <span key={n.effective_from} className="block whitespace-nowrap">
                          From {fmtDate(n.effective_from)}: {n.team_id ? teamName.get(n.team_id) ?? 'a team' : 'no team'}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ActionForm action={setMemberTeamAction} className="card mt-3 grid gap-3 p-4 sm:grid-cols-4 sm:items-end">
          <div>
            <label className="label" htmlFor="mt-member">Employee</label>
            <select id="mt-member" name="member_id" className="input" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {people.map((p) => <option key={p.member_id} value={p.member_id}>{p.member_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="mt-team">Team</label>
            <select id="mt-team" name="team_id" className="input" defaultValue="">
              <option value="">No team</option>
              {teams.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="mt-from">From</label>
            <input id="mt-from" type="date" name="effective_from" className="input" required min={today} defaultValue={today} />
          </div>
          <SubmitButton>Save team</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500">
          Moving someone to a team changes their hours only if they follow the defaults. To make someone follow the defaults, use &ldquo;Follow
          defaults&rdquo; on <Link href="/attendance/schedules" className="text-navy-700 underline">Attendance &rsaquo; Schedules</Link>.
        </p>
      </section>

      <section id="rules" className="scroll-mt-4">
        <SectionTitle>Attendance rules</SectionTitle>
        <ActionForm action={attendanceRulesAction} className="card space-y-4 p-4 sm:p-5">
          <fieldset className="space-y-2">
            <legend className="label">Late logout exceptions</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="late_logout" value="off" defaultChecked={settings?.late_logout_flag_minutes == null} /> Off: overtime is recorded but never raised as an exception
            </label>
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="late_logout" value="on" defaultChecked={settings?.late_logout_flag_minutes != null} /> Raise an exception when someone signs out
              <input
                type="number"
                name="late_logout_minutes"
                className="input w-24"
                min={15}
                max={600}
                step={1}
                defaultValue={settings?.late_logout_flag_minutes ?? 60}
                aria-label="Minutes after the scheduled end"
              />
              minutes or more after their scheduled end
            </label>
          </fieldset>
          <div className="max-w-xs">
            <label className="label" htmlFor="r-grace">Long break grace (minutes)</label>
            <input id="r-grace" type="number" name="long_break_grace" className="input" required min={0} max={120} step={1} defaultValue={settings?.long_break_grace_minutes ?? 10} />
            <p className="mt-1 text-xs text-slate-500">A Long Break exception is raised when a day&apos;s recorded breaks exceed the break allowance by more than this.</p>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Save rules</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
