import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, friendlyError } from '@/lib/format';
import { ROLE_LABELS, type TeamRow } from '@/lib/types';
import { PageHeader, Notice, EmptyState } from '@/components/ui';
import { Avatar, CapacityBadge } from '@/components/badges';

export const metadata = { title: 'Team' };

const VIEWS = ['all', 'active', 'leave', 'overdue', 'inactive'] as const;
type View = (typeof VIEWS)[number];

const EMPTY: Record<View, { title: string; body?: string }> = {
  all: { title: 'No team members yet' },
  active: { title: 'Nobody is working today', body: 'Everyone active is on leave.' },
  leave: { title: 'Nobody is on leave today' },
  overdue: { title: 'No overdue work', body: 'Nobody has overdue tasks or overdue routines.' },
  inactive: { title: 'No deactivated members' },
};

export default async function Team({ searchParams }: { searchParams: Promise<{ show?: string; person?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('team_overview');
  // One row per member, whatever the source returns.
  const everyone = Array.from(new Map(((data ?? []) as TeamRow[]).map((r) => [r.member_id, r])).values());
  const active = everyone.filter((m) => m.is_active);
  const inactive = everyone.filter((m) => !m.is_active); // only managers receive these

  const lists: Record<View, TeamRow[]> = {
    all: active,
    active: active.filter((m) => !m.on_leave),
    leave: active.filter((m) => m.on_leave),
    overdue: active.filter((m) => m.overdue > 0 || m.routine_overdue > 0),
    inactive,
  };
  const person = everyone.find((m) => m.member_id === sp.person);
  const view: View = (VIEWS as readonly string[]).includes(sp.show ?? '') ? (sp.show as View) : 'all';
  const rows = person ? [person] : lists[view];
  const filtered = Boolean(person) || view !== 'all';

  const tab = (key: View, label: string) => (
    <Link
      key={key}
      href={key === 'all' ? '/team' : `/team?show=${key}`}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${!person && view === key ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}
    >
      {label} <span className="tabular-nums opacity-75">({lists[key].length})</span>
    </Link>
  );

  // Managers can open the matching lists; other members only see the counts.
  const count = (n: number, tone: string, href: string) => (
    <span className={`tabular-nums ${n > 0 ? tone : ''}`}>
      {me.isManager && n > 0 ? <Link href={href} className="hover:underline">{n}</Link> : n}
    </span>
  );
  const tasksHref = (m: TeamRow, extra = '') => `/tasks?scope=all&owner=${m.member_id}${extra}`;
  const routinesHref = (m: TeamRow) => `/routines?owner=${m.member_id}&status=Overdue`;

  const name = (m: TeamRow) =>
    me.isAdmin ? (
      <Link href={`/team/${m.member_id}`} className="text-navy-800 hover:underline">{m.name}</Link>
    ) : (
      m.name
    );
  const roleTag = (m: TeamRow) =>
    m.access_role !== 'member' && <span className="ml-2 rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-800">{ROLE_LABELS[m.access_role]}</span>;
  const status = (m: TeamRow) =>
    !m.is_active ? (
      <span className="text-slate-500">Deactivated</span>
    ) : m.on_leave ? (
      <span>
        <span className="font-medium text-violet-800">On Leave</span>
        {m.leave_until && <span className="block text-xs text-slate-500">until {fmtDate(m.leave_until)}</span>}
      </span>
    ) : (
      <span>Active</span>
    );

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Open, Overdue, Blocked and Capacity are calculated live from the Task Board and the Team Calendar. Open = any task not Done."
        actions={me.isAdmin ? <Link href="/team/new" className="btn-primary">Add member</Link> : undefined}
      />
      {error && <Notice tone="error">Could not load the team: {friendlyError(error.message)}</Notice>}

      <div className="mb-3 flex flex-wrap gap-1">
        {tab('all', 'All')}
        {tab('active', 'Active')}
        {tab('leave', 'On leave')}
        {tab('overdue', 'With overdue work')}
        {inactive.length > 0 && tab('inactive', 'Deactivated')}
      </div>
      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        <select name="person" defaultValue={person?.member_id ?? ''} className="input w-auto" aria-label="Person">
          <option value="">Everyone</option>
          {everyone.map((m) => (
            <option key={m.member_id} value={m.member_id}>
              {m.is_active ? m.name : `${m.name} (deactivated)`}
            </option>
          ))}
        </select>
        <button className="btn-secondary" type="submit">Show</button>
        {filtered && <Link href="/team" className="btn-ghost">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        !error && <EmptyState title={EMPTY[view].title} body={EMPTY[view].body} action={filtered ? <Link href="/team" className="btn-secondary">Show everyone</Link> : undefined} />
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((m) => (
              <li key={m.member_id} className={`card p-3 ${m.is_active ? '' : 'text-slate-400'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={m.name} />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{name(m)}{roleTag(m)}</div>
                      <div className="text-xs text-slate-500">{m.role_title || '—'}</div>
                    </div>
                  </div>
                  <CapacityBadge status={m.capacity_status} />
                </div>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <div>
                    <dt className="text-[11px] text-slate-500">Open</dt>
                    <dd className="text-sm font-semibold">
                      {count(m.open_tasks, '', tasksHref(m))}
                      <span className="text-xs font-normal text-slate-400">/{m.max_open_tasks}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Overdue</dt>
                    <dd className="text-sm font-semibold">{count(m.overdue, 'text-red-700', tasksHref(m, '&due=overdue'))}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Blocked</dt>
                    <dd className="text-sm font-semibold">{count(m.blocked, 'text-orange-700', tasksHref(m, '&status=Blocked'))}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Routines overdue</dt>
                    <dd className="text-sm font-semibold">{count(m.routine_overdue, 'text-red-700', routinesHref(m))}</dd>
                  </div>
                </dl>
                <div className="mt-2 text-xs text-slate-600">{status(m)}</div>
                {m.expertise && <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">{m.expertise}</p>}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {m.email && <span className="break-all">{m.email}</span>}
                  {me.isAdmin && <span>{m.has_login ? `Login: ${m.username}` : <span className="text-amber-700">No login</span>}</span>}
                </div>
              </li>
            ))}
          </ul>

          {/* Tablet / desktop: sheet */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Capacity</th>
                  <th className="text-center">Open / Max</th>
                  <th className="text-center">Overdue</th>
                  <th className="text-center">Blocked</th>
                  <th className="text-center">Overdue Routines</th>
                  <th>Expertise / Skills</th>
                  <th>Email</th>
                  {me.isAdmin && <th>Login</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.member_id} className={m.is_active ? '' : 'text-slate-400'}>
                    <td className="whitespace-nowrap font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={m.name} size="sm" />
                        {name(m)}
                      </span>
                      {roleTag(m)}
                    </td>
                    <td className="whitespace-nowrap">{m.role_title}</td>
                    <td className="whitespace-nowrap">{status(m)}</td>
                    <td><CapacityBadge status={m.capacity_status} /></td>
                    <td className="whitespace-nowrap text-center tabular-nums">
                      {count(m.open_tasks, '', tasksHref(m))}
                      <span className="text-xs text-slate-400">/{m.max_open_tasks}</span>
                    </td>
                    <td className="text-center">{count(m.overdue, 'font-semibold text-red-700', tasksHref(m, '&due=overdue'))}</td>
                    <td className="text-center">{count(m.blocked, 'font-semibold text-orange-700', tasksHref(m, '&status=Blocked'))}</td>
                    <td className="text-center">{count(m.routine_overdue, 'font-semibold text-red-700', routinesHref(m))}</td>
                    <td className="min-w-56 max-w-sm text-slate-600">{m.expertise}</td>
                    <td className="whitespace-nowrap">{m.email ?? <span className="text-slate-400">—</span>}</td>
                    {me.isAdmin && <td className="whitespace-nowrap text-xs">{m.has_login ? m.username : <span className="text-amber-700">No login</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
