import Link from 'next/link';
import { requireArea } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { addDays, fmtDate, friendlyError } from '@/lib/format';
import { Notice, PageHeader, StatCard } from '@/components/ui';
import { dbToday, loadTeams } from '../data';
import { EXCEPTION_STATUSES, FLAG_TYPES, UUID_RE, daysBetween, validDate } from '../lib';
import { ExceptionQueue, type ExceptionRow } from './queue';

export const metadata = { title: 'Attendance exceptions' };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_DAYS = 366;
/** Days before today that are refreshed on every visit, so recent exceptions exist. */
const RECENT_DAYS = 14;

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireArea('attendance');
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)])) as Record<string, string | undefined>;
  const supabase = await createClient();
  const { today, error: todayError } = await dbToday(supabase);
  const header = (
    <PageHeader
      title="Attendance exceptions"
      subtitle="Late logins, early or late logouts, long breaks, missed sign-ins and incomplete sessions. Approve, reject or waive them one by one or in bulk."
      actions={
        <>
          <Link href="/attendance/exemptions" className="btn-secondary">Exemptions</Link>
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

  let warning: string | null = null;
  let from = sp.from && validDate(sp.from) ? sp.from : addDays(today, -29);
  let to = sp.to && validDate(sp.to) ? sp.to : today;
  if (to < from || daysBetween(from, to) > MAX_DAYS - 1) {
    warning = 'Choose a range of up to a year, with the end after the start. Showing the last 30 days instead.';
    from = addDays(today, -29);
    to = today;
  }
  const member = sp.member && UUID_RE.test(sp.member) ? sp.member : null;
  const team = sp.team && UUID_RE.test(sp.team) ? sp.team : null;
  const status = sp.status === 'all' ? null : sp.status && (EXCEPTION_STATUSES as readonly string[]).includes(sp.status) ? sp.status : 'Open';
  const type = sp.type && (FLAG_TYPES as readonly string[]).includes(sp.type) ? sp.type : null;

  // Bring recent flags up to date first (idempotent).
  const refresh = await supabase.rpc('attendance_refresh', { p_from: addDays(today, -(RECENT_DAYS - 1)), p_to: today });
  const [res, openRes, members, teams] = await Promise.all([
    supabase.rpc('attendance_exceptions', { p_from: from, p_to: to, p_member: member, p_team: team, p_status: status, p_type: type }),
    supabase.rpc('attendance_exceptions', { p_from: addDays(today, -(MAX_DAYS - 1)), p_to: today, p_status: 'Open' }),
    activeMembers(),
    loadTeams(supabase),
  ]);
  const rows = (res.data ?? []) as ExceptionRow[];
  const allOpen = (openRes.data ?? []) as ExceptionRow[];
  const count = (t: string[]) => allOpen.filter((r) => t.includes(r.flag_type)).length;
  const href = (o: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = { from, to, member, team, status: status ?? 'all', type, ...o };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/attendance/exceptions?${p.toString()}`;
  };
  const quickType = (t: string) => href({ type: t, status: 'Open', from: addDays(today, -(MAX_DAYS - 1)), to: today });

  return (
    <>
      {header}
      {warning && <Notice tone="warn">{warning}</Notice>}
      {refresh.error && <Notice tone="warn">Recent exceptions could not be brought up to date ({friendlyError(refresh.error.message)}).</Notice>}
      {res.error && <Notice tone="error">Could not load exceptions: {friendlyError(res.error.message)}</Notice>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Open" value={allOpen.length} tone={allOpen.length ? 'amber' : 'default'} href={href({ status: 'Open', type: null, from: addDays(today, -(MAX_DAYS - 1)), to: today })} hint="Waiting for a decision" />
        <StatCard label="Late login" value={count(['Late Login', 'Repeated Late Login'])} href={quickType('Late Login')} />
        <StatCard label="Early logout" value={count(['Early Logout', 'Repeated Early Logout'])} href={quickType('Early Logout')} />
        <StatCard label="Late logout" value={count(['Late Logout'])} href={quickType('Late Logout')} />
        <StatCard label="Long break" value={count(['Long Break'])} href={quickType('Long Break')} />
        <StatCard label="No login" value={count(['No Login'])} href={quickType('No Login')} />
        <StatCard label="Incomplete session" value={count(['Incomplete Session'])} href={quickType('Incomplete Session')} />
      </div>

      <form action="/attendance/exceptions" className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
        <div>
          <label className="label" htmlFor="x-from">From</label>
          <input id="x-from" type="date" name="from" defaultValue={from} max={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="x-to">To</label>
          <input id="x-to" type="date" name="to" defaultValue={to} max={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="x-member">Employee</label>
          <select id="x-member" name="member" defaultValue={member ?? ''} className="input">
            <option value="">Everyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="x-team">Team</label>
          <select id="x-team" name="team" defaultValue={team ?? ''} className="input">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (archived)'}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="x-status">Status</label>
          <select id="x-status" name="status" defaultValue={status ?? 'all'} className="input">
            <option value="Open">Open</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Waived">Waived</option>
            <option value="Resolved">Resolved (before decisions)</option>
            <option value="all">Any status</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="x-type">Type</label>
          <select id="x-type" name="type" defaultValue={type ?? ''} className="input">
            <option value="">Any type</option>
            {FLAG_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-3 lg:col-span-6">
          <p className="text-xs text-slate-500">
            Showing {rows.length}
            {rows.length === 1000 ? ' (the first 1000)' : ''} from {fmtDate(from)} to {fmtDate(to)}. Approved and waived exceptions do not count towards
            repeated-lateness flags.
          </p>
          <div className="flex gap-2">
            <Link href="/attendance/exceptions" className="btn-ghost">Clear</Link>
            <button className="btn-secondary" type="submit">Apply</button>
          </div>
        </div>
      </form>

      <ExceptionQueue rows={res.error ? [] : rows} />
    </>
  );
}
