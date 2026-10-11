import Link from 'next/link';
import type { TaskRow } from '@/lib/types';
import { daysLeftLabel, fmtDate } from '@/lib/format';
import { FlagBadge, PriorityBadge, ProgressBar, StatusBadge, flagStyles } from './badges';
import { LocalTime } from './local-time';
import { EmptyState } from './ui';

function DaysLeft({ row }: { row: TaskRow }) {
  const n = row.days_left;
  const tone = n === null ? 'text-slate-400' : n < 0 ? 'font-semibold text-red-700' : n <= 3 ? 'font-semibold text-amber-700' : 'text-slate-700';
  return <span className={`tabular-nums ${tone}`}>{daysLeftLabel(n)}</span>;
}

/** The Task Board's 14 source columns, with spreadsheet-style row colouring by flag. */
export function TaskTable({
  rows,
  compact = false,
  empty,
}: {
  rows: TaskRow[];
  compact?: boolean;
  empty?: { title: string; body?: string; action?: React.ReactNode };
}) {
  if (rows.length === 0) {
    return <EmptyState title={empty?.title ?? 'No tasks here'} body={empty?.body} action={empty?.action} />;
  }
  return (
    <>
      {/* Phones: cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/tasks/${r.id}`} className={`card block border-l-4 p-3 ${flagBorder(r.flag)}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">{r.task_code}</div>
                  <div className="font-medium text-navy-900">{r.title}</div>
                </div>
                <FlagBadge flag={r.flag} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <StatusBadge status={r.status} />
                <PriorityBadge priority={r.priority} />
                <span>{r.owner_name}</span>
                <span>· Due {fmtDate(r.due_date)}</span>
                <span>· <DaysLeft row={r} /></span>
              </div>
              <div className="mt-2">
                <ProgressBar value={r.percent_complete} />
              </div>
              {r.progress_note && <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">{r.progress_note}</p>}
            </Link>
          </li>
        ))}
      </ul>

      {/* Tablet / desktop: sheet */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="sheet">
          <thead>
            <tr>
              <th>Task ID</th>
              <th>Task</th>
              {!compact && <th>Details</th>}
              <th>Owner</th>
              {!compact && <th>Assigned By</th>}
              <th>Priority</th>
              <th>Status</th>
              {!compact && <th>Start Date</th>}
              <th>Due Date</th>
              <th>% Complete</th>
              <th>Last Update</th>
              {!compact && <th>Progress Note / Blocker</th>}
              <th>Days Left</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={flagStyles[r.flag]?.row}>
                <td className="whitespace-nowrap font-mono text-xs text-slate-500">
                  <Link href={`/tasks/${r.id}`} className="hover:underline">{r.task_code}</Link>
                </td>
                <td className="min-w-48 font-medium text-navy-900">
                  <Link href={`/tasks/${r.id}`} className="hover:underline">{r.title}</Link>
                </td>
                {!compact && <td className="max-w-64 text-slate-600"><span className="line-clamp-2">{r.details || '—'}</span></td>}
                <td className="whitespace-nowrap">{r.owner_name}</td>
                {!compact && <td className="whitespace-nowrap text-slate-600">{r.assigned_by_name}</td>}
                <td><PriorityBadge priority={r.priority} /></td>
                <td><StatusBadge status={r.status} /></td>
                {!compact && <td className="whitespace-nowrap tabular-nums">{fmtDate(r.start_date)}</td>}
                <td className="whitespace-nowrap tabular-nums">{fmtDate(r.due_date)}</td>
                <td><ProgressBar value={r.percent_complete} /></td>
                <td className="whitespace-nowrap text-xs text-slate-600"><LocalTime iso={r.last_update_at} mode="date" /></td>
                {!compact && <td className="max-w-64 text-slate-600"><span className="line-clamp-2">{r.progress_note || '—'}</span></td>}
                <td className="whitespace-nowrap"><DaysLeft row={r} /></td>
                <td><FlagBadge flag={r.flag} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function flagBorder(flag: string) {
  switch (flag) {
    case 'Overdue':
      return 'border-l-red-500';
    case 'Due soon':
    case 'Stale':
      return 'border-l-amber-500';
    case 'Blocked':
      return 'border-l-slate-500';
    case 'Done':
      return 'border-l-green-600';
    default:
      return 'border-l-line';
  }
}
