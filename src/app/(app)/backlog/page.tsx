import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, friendlyError } from '@/lib/format';
import { PRIORITIES, type BacklogRow, type CapacityStatus, type TeamRow } from '@/lib/types';
import { BacklogStatusBadge, CapacityBadge, PriorityBadge } from '@/components/badges';
import { EmptyState, Notice, PageHeader } from '@/components/ui';

export const metadata = { title: 'Pending Backlog' };

type SP = { status?: string; q?: string; priority?: string; show?: string };

const TABS = [
  { key: 'pending', label: 'Pending', status: 'Pending' },
  { key: 'approved', label: 'Approved', status: 'Approved' },
  { key: 'converted', label: 'Converted to Task', status: 'Converted to Task' },
  { key: 'dismissed', label: 'Dismissed', status: 'Dismissed' },
  { key: 'all', label: 'All', status: null },
] as const;

type Availability = { status: CapacityStatus; until: string | null };

/** Who the row is about: the approved person once decided, otherwise the suggestion. */
function personOf(b: BacklogRow) {
  return b.status === 'Approved' || b.status === 'Converted to Task'
    ? { id: b.final_owner_id, name: b.final_owner_name, label: 'Assigned to' }
    : { id: b.suggested_owner_id, name: b.suggested_owner_name, label: 'Suggested' };
}

function AvailabilityCell({ a }: { a: Availability | undefined }) {
  if (!a) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <CapacityBadge status={a.status} />
      {a.status === 'On Leave' && a.until && <span className="text-[11px] text-slate-500">until {fmtDate(a.until)}</span>}
    </span>
  );
}

export default async function Backlog({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();

  const tab = TABS.find((t) => t.key === sp.status) ?? (sp.show === 'all' ? TABS[4] : TABS[0]);
  const priority = PRIORITIES.find((p) => p === sp.priority) ?? '';
  const term = (sp.q ?? '').replace(/[%_\\]/g, ' ').trim().slice(0, 80);
  const code = /^bck-?(\d+)$/i.exec(term);
  const hasFilters = Boolean(term || priority);

  // The same search and priority filters apply to the list and to each tab's count.
  const filtered = (cols: string, head = false) => {
    let q = supabase.from('backlog_board').select(cols, head ? { count: 'exact', head: true } : undefined);
    if (priority) q = q.eq('priority', priority);
    if (code) q = q.eq('backlog_no', Number(code[1]) - 100);
    else if (term) q = q.ilike('title', `%${term}%`);
    return q;
  };
  let list = filtered('*').order('backlog_no', { ascending: false });
  if (tab.status) list = list.eq('status', tab.status);

  const [{ data, error }, { data: team }, ...counts] = await Promise.all([
    list.limit(500),
    supabase.rpc('team_overview'),
    ...TABS.filter((t) => t.status).map((t) => filtered('id', true).eq('status', t.status!)),
  ]);
  const rows = (data ?? []) as unknown as BacklogRow[];
  const countOf: Record<string, number | null> = {};
  TABS.filter((t) => t.status).forEach((t, i) => (countOf[t.key] = counts[i]?.count ?? null));
  countOf.all = Object.values(countOf).every((n) => n !== null) ? Object.values(countOf).reduce<number>((s, n) => s + (n ?? 0), 0) : null;

  const availability = new Map<string, Availability>(
    ((team ?? []) as TeamRow[]).map((m) => [m.member_id, { status: m.capacity_status, until: m.leave_until }]),
  );
  const availOf = (b: BacklogRow) => {
    if (b.status !== 'Pending' && b.status !== 'Approved') return undefined;
    const p = personOf(b);
    return p.id ? availability.get(p.id) : undefined;
  };

  const href = (key: string) => {
    const p = new URLSearchParams();
    if (key !== 'pending') p.set('status', key);
    if (term) p.set('q', term);
    if (priority) p.set('priority', priority);
    const s = p.toString();
    return s ? `/backlog?${s}` : '/backlog';
  };
  const clearHref = tab.key === 'pending' ? '/backlog' : `/backlog?status=${tab.key}`;

  return (
    <>
      <PageHeader
        title="Pending Backlog"
        subtitle={
          me.isManager
            ? 'Review the suggested assignee, then approve to move the task to the Task Board. Suggestions are made by rules: skills, workload, overdue, blocked and availability.'
            : 'Unassigned work. A manager approves who takes it. Suggestions are made by rules: skills, workload, overdue, blocked and availability.'
        }
        actions={<Link href="/backlog/new" className="btn-primary whitespace-nowrap">Add to backlog</Link>}
      />
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={tab.key === t.key ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab.key === t.key ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}
          >
            {t.label}
            {countOf[t.key] !== null && countOf[t.key] !== undefined && <span className="ml-1 tabular-nums opacity-75">({countOf[t.key]})</span>}
          </Link>
        ))}
      </div>
      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        {tab.key !== 'pending' && <input type="hidden" name="status" value={tab.key} />}
        <input name="q" defaultValue={term} placeholder="Search title or BCK ID…" className="input w-full sm:w-64" aria-label="Search title or BCK ID" />
        <select name="priority" defaultValue={priority} className="input w-auto" aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
        {hasFilters && <Link href={clearHref} className="btn-ghost">Clear</Link>}
      </form>
      {error && <Notice tone="error">Could not load the backlog: {friendlyError(error.message)}</Notice>}
      {rows.length === 0 ? (
        error ? null : hasFilters ? (
          <EmptyState title="No backlog items match" body="Try another title, BCK ID or priority." action={<Link href={clearHref} className="btn-secondary">Clear filters</Link>} />
        ) : tab.key === 'pending' ? (
          <EmptyState title="The backlog is clear" body="New work nobody owns yet goes here, not on the Task Board." action={<Link href="/backlog/new" className="btn-primary whitespace-nowrap">Add to backlog</Link>} />
        ) : (
          <EmptyState title={tab.key === 'all' ? 'No backlog items yet' : `No ${tab.label.toLowerCase()} items`} />
        )
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((b) => {
              const p = personOf(b);
              return (
                <li key={b.id}>
                  <Link href={`/backlog/${b.id}`} className="card block p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-500">{b.backlog_code}</div>
                        <div className="font-medium text-navy-900">{b.title}</div>
                      </div>
                      <BacklogStatusBadge status={b.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <PriorityBadge priority={b.priority} />
                      <span>Due {fmtDate(b.due_date)}</span>
                      <span>· By {b.requested_by_name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-700">
                      <span>
                        {p.label}: <strong>{p.name ?? 'none'}</strong>
                      </span>
                      {availOf(b) && <CapacityBadge status={availOf(b)!.status} />}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Tablet / desktop: sheet */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Backlog ID</th>
                  <th>Task</th>
                  <th>Details</th>
                  <th>Skills Needed</th>
                  <th>Priority</th>
                  <th>Due Date</th>
                  <th>Requested By</th>
                  <th>Date Added</th>
                  <th>Suggested Assignee</th>
                  <th>Availability</th>
                  <th>Why (suggested by rules)</th>
                  <th>Approved?</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className={b.status === 'Converted to Task' ? 'bg-done/40' : b.status === 'Dismissed' ? 'text-slate-500' : ''}>
                    <td className="whitespace-nowrap font-mono text-xs"><Link href={`/backlog/${b.id}`} className="hover:underline">{b.backlog_code}</Link></td>
                    <td className="min-w-48 font-medium text-navy-900"><Link href={`/backlog/${b.id}`} className="hover:underline">{b.title}</Link></td>
                    <td className="max-w-56 text-slate-600"><span className="line-clamp-2">{b.details || '—'}</span></td>
                    <td className="max-w-48 text-slate-700">{b.skills_needed}</td>
                    <td><PriorityBadge priority={b.priority} /></td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDate(b.due_date)}</td>
                    <td className="whitespace-nowrap">{b.requested_by_name}</td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDate(b.date_added)}</td>
                    <td className="whitespace-nowrap">
                      <span className="font-medium">{b.suggested_owner_name ?? '—'}</span>
                      {b.final_owner_name && (b.status === 'Approved' || b.status === 'Converted to Task') && (
                        <div className="text-xs text-slate-600">Assigned to {b.final_owner_name}</div>
                      )}
                    </td>
                    <td><AvailabilityCell a={availOf(b)} /></td>
                    <td className="min-w-72 max-w-96 text-xs text-slate-600"><span className="line-clamp-3">{b.suggestion_reason ?? '—'}</span></td>
                    <td className="whitespace-nowrap">{b.approval}</td>
                    <td><BacklogStatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Availability is live: the suggested person for Pending items, the assigned person for Approved items.
            {rows.length === 500 ? ' Showing the latest 500 items.' : ''}
          </p>
        </>
      )}
    </>
  );
}
