import Link from 'next/link';
import type { RoutineRow } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { RoutineStatusBadge } from './badges';
import { EmptyState } from './ui';
import { MarkDone } from './mark-done';

export function RoutineTable({ rows, canComplete, today, showOwner = true }: { rows: RoutineRow[]; canComplete: (r: RoutineRow) => boolean; today: string; showOwner?: boolean }) {
  if (rows.length === 0) return <EmptyState title="No routine tasks" body="Recurring work assigned to you will appear here." />;
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/routines/${r.id}`} className="font-medium text-navy-900 hover:underline">{r.title}</Link>
              <RoutineStatusBadge status={r.status} />
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {showOwner && <>{r.owner_name} · </>}
              {r.frequency} (every {r.every_n_days}d) · Last {fmtDate(r.last_done)} · Next {fmtDate(r.next_due)}
            </div>
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
              <th>Routine Task</th>
              {showOwner && <th>Owner</th>}
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
              <tr key={r.id} className={r.status === 'Overdue' ? 'bg-red-50/70' : r.status === 'Due today' ? 'bg-amber-50/70' : r.status === 'OK' ? 'bg-done/40' : ''}>
                <td className="min-w-56 font-medium text-navy-900">
                  <Link href={`/routines/${r.id}`} className="hover:underline">{r.title}</Link>
                </td>
                {showOwner && <td className="whitespace-nowrap">{r.owner_name}</td>}
                <td>{r.frequency}</td>
                <td className="tabular-nums">{r.every_n_days}</td>
                <td className="whitespace-nowrap tabular-nums">{fmtDate(r.last_done)}</td>
                <td className="whitespace-nowrap tabular-nums">{fmtDate(r.next_due)}</td>
                <td><RoutineStatusBadge status={r.status} /></td>
                <td className="max-w-56 text-slate-600"><span className="line-clamp-2">{r.notes || '—'}</span></td>
                <td className="text-right">
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
