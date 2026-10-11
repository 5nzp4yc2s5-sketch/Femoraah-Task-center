import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import type { BacklogRow } from '@/lib/types';
import { BacklogStatusBadge, PriorityBadge } from '@/components/badges';
import { EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Pending Backlog' };

export default async function Backlog({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  let q = supabase.from('backlog_board').select('*').order('backlog_no', { ascending: false });
  if (sp.show !== 'all') q = q.eq('status', 'Open');
  const { data } = await q.limit(500);
  const rows = (data ?? []) as BacklogRow[];
  return (
    <>
      <PageHeader
        title="Pending Backlog"
        subtitle={me.isManager ? 'Review the suggested owner, then approve to move the task to the Task Board.' : 'Unassigned work. A manager approves who takes it.'}
        actions={<Link href="/backlog/new" className="btn-primary">Add to backlog</Link>}
      />
      <div className="mb-3 flex gap-1">
        <Link href="/backlog" className={`rounded-lg px-3 py-1.5 text-sm font-medium ${sp.show !== 'all' ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>Awaiting decision</Link>
        <Link href="/backlog?show=all" className={`rounded-lg px-3 py-1.5 text-sm font-medium ${sp.show === 'all' ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-100'}`}>All, including assigned</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="The backlog is clear" body="New work nobody owns yet goes here, not on the Task Board." action={<Link href="/backlog/new" className="btn-primary">Add to backlog</Link>} />
      ) : (
        <div className="card overflow-x-auto">
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
                <th>Suggested Owner</th>
                <th>Why (match + workload)</th>
                <th>Approved?</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className={b.status === 'Assigned' ? 'bg-done/40' : ''}>
                  <td className="whitespace-nowrap font-mono text-xs"><Link href={`/backlog/${b.id}`} className="hover:underline">{b.backlog_code}</Link></td>
                  <td className="min-w-48 font-medium text-navy-900"><Link href={`/backlog/${b.id}`} className="hover:underline">{b.title}</Link></td>
                  <td className="max-w-56 text-slate-600"><span className="line-clamp-2">{b.details || '—'}</span></td>
                  <td className="max-w-48 text-slate-700">{b.skills_needed}</td>
                  <td><PriorityBadge priority={b.priority} /></td>
                  <td className="whitespace-nowrap tabular-nums">{fmtDate(b.due_date)}</td>
                  <td className="whitespace-nowrap">{b.requested_by_name}</td>
                  <td className="whitespace-nowrap tabular-nums">{fmtDate(b.date_added)}</td>
                  <td className="whitespace-nowrap font-medium">{b.status === 'Assigned' ? b.final_owner_name : (b.suggested_owner_name ?? '—')}</td>
                  <td className="min-w-72 max-w-96 text-xs text-slate-600"><span className="line-clamp-3">{b.suggestion_reason ?? '—'}</span></td>
                  <td className="whitespace-nowrap">{b.approval}</td>
                  <td><BacklogStatusBadge status={b.status} approval={b.approval} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
