import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RoutineRow } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { RoutineStatusBadge, routineEdge } from './badges';
import { EmptyState } from './ui';
import { LocalTime } from './local-time';
import { MarkDone } from './mark-done';

/** "Zinia covering while Dev is on leave", or a note that nobody is covering. Ownership never changes. */
export function CoverNote({ r, viewerId }: { r: RoutineRow; viewerId?: string }) {
  if (!r.owner_on_leave || !r.is_active) return null;
  if (r.covered_by_name) {
    return (
      <div className="mt-0.5 text-xs font-medium text-violet-800">
        {r.covered_by_name}
        {viewerId && r.covered_by_id === viewerId ? ' (you)' : ''} covering while {r.owner_name} is on leave
      </div>
    );
  }
  return <div className="mt-0.5 text-xs font-medium text-violet-800">{r.owner_name} is on leave today · no backup set</div>;
}

/** Tells a non-owner why they can see this routine. */
function ViewerTag({ r, viewerId }: { r: RoutineRow; viewerId?: string }) {
  if (!viewerId || r.owner_id === viewerId || r.covered_by_id === viewerId) return null;
  if (r.backup_member_id === viewerId) return <div className="mt-0.5 text-xs text-slate-500">You are the backup</div>;
  return null;
}

export function RoutineTable({
  rows,
  canComplete,
  today,
  showOwner = true,
  viewerId,
  empty,
}: {
  rows: RoutineRow[];
  canComplete: (r: RoutineRow) => boolean;
  today: string;
  showOwner?: boolean;
  /** The signed-in member, to label routines they back up or cover. */
  viewerId?: string;
  empty?: { title: string; body?: string; action?: ReactNode };
}) {
  if (rows.length === 0) {
    return <EmptyState title={empty?.title ?? 'No routine tasks'} body={empty ? empty.body : 'Recurring work assigned to you will appear here.'} action={empty?.action} />;
  }
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="card p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">{r.routine_code}</div>
                <Link href={`/routines/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.title}</Link>
              </div>
              <RoutineStatusBadge status={r.status} />
            </div>
            <CoverNote r={r} viewerId={viewerId} />
            <ViewerTag r={r} viewerId={viewerId} />
            <div className="mt-1 text-xs text-slate-600">
              {showOwner && <>Assigned to {r.owner_name}. </>}
              {r.backup_name && <>Backup {r.backup_name}. </>}
              {r.frequency} (every {r.every_n_days}d), last {fmtDate(r.last_done)}, next {fmtDate(r.next_due)}
            </div>
            {r.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.notes}</p>}
            {canComplete(r) && r.is_active && (
              <div className="mt-2">
                <MarkDone routineId={r.id} today={today} doneThisCycle={r.status === 'OK'} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="card hidden overflow-x-auto md:block">
        <table className="sheet">
          <thead>
            <tr>
              <th>Routine ID</th>
              <th>Routine Task</th>
              {showOwner && <th>Assigned to</th>}
              <th>Backup</th>
              <th>Frequency</th>
              <th>Every N Days</th>
              <th>Last Done</th>
              <th>Next Due</th>
              <th>Status</th>
              <th>Notes</th>
              <th className="text-right">Tick off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={routineEdge[r.status] ?? ''}>
                <td className="whitespace-nowrap text-xs text-slate-500">
                  <Link href={`/routines/${r.id}`} className="hover:underline">{r.routine_code}</Link>
                </td>
                <td className="min-w-56 font-medium text-slate-900">
                  <Link href={`/routines/${r.id}`} className="hover:underline">{r.title}</Link>
                  <CoverNote r={r} viewerId={viewerId} />
                  <ViewerTag r={r} viewerId={viewerId} />
                </td>
                {showOwner && <td className="whitespace-nowrap">{r.owner_name}</td>}
                <td className="whitespace-nowrap">{r.backup_name ?? <span className="text-slate-400">—</span>}</td>
                <td>{r.frequency}</td>
                <td className="tabular-nums">{r.every_n_days}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {fmtDate(r.last_done)}
                  {r.last_completed_at && (
                    <div className="text-[11px] text-slate-500" title="When it was ticked off">
                      <LocalTime iso={r.last_completed_at} />
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap tabular-nums">{fmtDate(r.next_due)}</td>
                <td><RoutineStatusBadge status={r.status} /></td>
                <td className="max-w-56 text-slate-600"><span className="line-clamp-2">{r.notes || '—'}</span></td>
                <td className="min-w-44 text-right">
                  {canComplete(r) && r.is_active ? <MarkDone routineId={r.id} today={today} doneThisCycle={r.status === 'OK'} /> : <span className="text-xs text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
