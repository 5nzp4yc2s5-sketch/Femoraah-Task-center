import Link from 'next/link';
import type { TaskRow } from '@/lib/types';
import { daysLeftLabel, fmtDate } from '@/lib/format';
import { FlagBadge, FlaggedStar, PriorityBadge, ProgressBar, StatusBadge, flagStyles } from './badges';
import { LocalTime } from './local-time';
import { StatusSelect } from './status-select';
import { EmptyState } from './ui';

function DaysLeft({ row }: { row: TaskRow }) {
  const n = row.days_left;
  const tone = n === null ? 'text-slate-400' : n < 0 ? 'font-semibold text-red-700' : n <= 3 ? 'font-semibold text-amber-700' : 'text-slate-700';
  return <span className={`tabular-nums ${tone}`}>{daysLeftLabel(n)}</span>;
}

function NoteOrBlocker({ row, clamp = true }: { row: TaskRow; clamp?: boolean }) {
  if (row.status === 'Blocked' && row.blocker_reason) {
    return (
      <span className={`${clamp ? 'line-clamp-2' : ''} font-medium text-orange-800`}>
        Blocked: {row.blocker_reason}
        {row.blocked_at && <span className="font-normal text-orange-700/80"> · since <LocalTime iso={row.blocked_at} mode="date" /></span>}
      </span>
    );
  }
  return <span className={clamp ? 'line-clamp-2' : ''}>{row.progress_note || '—'}</span>;
}

type Viewer = { memberId: string; isManager: boolean };

/** Who may change status from the board: managers, the assignee, the creator and the delegator. */
function canChangeStatus(row: TaskRow, me?: Viewer) {
  if (!me || row.archived_at) return false;
  return me.isManager || [row.owner_id, row.created_by, row.assigned_by].includes(me.memberId);
}

/** The Task Board's source columns, with spreadsheet-style row colouring by flag. */
export function TaskTable({
  rows,
  compact = false,
  empty,
  me,
}: {
  rows: TaskRow[];
  compact?: boolean;
  empty?: { title: string; body?: string; action?: React.ReactNode };
  me?: Viewer;
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
            <Link href={`/tasks/${r.id}`} className={`card block border-l-[3px] p-3.5 ${flagBorder(r.flag)} ${r.status === 'Done' ? 'opacity-75' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs tabular-nums text-slate-500">{r.task_code}</div>
                  <div className="mt-0.5 font-medium text-slate-900">{r.title} <FlaggedStar on={r.is_flagged} /></div>
                </div>
                <FlagBadge flag={r.flag} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
                <StatusBadge status={r.status} />
                <PriorityBadge priority={r.priority} />
                <span>
                  {r.owner_name}
                  {r.assigned_by_name && r.assigned_by !== r.owner_id && <span className="text-slate-500">, from {r.assigned_by_name}</span>}
                </span>
                <span>Due {fmtDate(r.due_date)} (<DaysLeft row={r} />)</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={r.percent_complete} />
              </div>
              {(r.progress_note || (r.status === 'Blocked' && r.blocker_reason)) && (
                <p className="mt-1.5 text-xs text-slate-600"><NoteOrBlocker row={r} /></p>
              )}
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
              {!compact && <th>Description</th>}
              <th>Assigned To</th>
              {!compact && <th>Delegated By</th>}
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
                <td className="whitespace-nowrap text-xs text-slate-500">
                  <Link href={`/tasks/${r.id}`} className="hover:underline">{r.task_code}</Link>
                </td>
                <td className="min-w-48 font-medium text-slate-900">
                  <Link href={`/tasks/${r.id}`} className="hover:underline">{r.title}</Link> <FlaggedStar on={r.is_flagged} />
                </td>
                {!compact && <td className="max-w-64 text-slate-500"><span className="line-clamp-2">{r.details || '—'}</span></td>}
                <td className="whitespace-nowrap">{r.owner_name}</td>
                {!compact && <td className="whitespace-nowrap text-slate-600">{r.assigned_by_name}</td>}
                <td><PriorityBadge priority={r.priority} /></td>
                <td>{canChangeStatus(r, me) ? <StatusSelect id={r.id} status={r.status} blocker={r.blocker_reason} /> : <StatusBadge status={r.status} />}</td>
                {!compact && <td className="whitespace-nowrap tabular-nums">{fmtDate(r.start_date)}</td>}
                <td className="whitespace-nowrap tabular-nums">{fmtDate(r.due_date)}</td>
                <td><ProgressBar value={r.percent_complete} /></td>
                <td className="whitespace-nowrap text-xs text-slate-600"><LocalTime iso={r.last_update_at} mode="date" /></td>
                {!compact && <td className="max-w-64 text-slate-600"><NoteOrBlocker row={r} /></td>}
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
    case 'Due in 7 days':
      return 'border-l-yellow-400';
    case 'Blocked':
      return 'border-l-orange-500';
    case 'Done':
      return 'border-l-green-600';
    default:
      return 'border-l-line-strong';
  }
}
