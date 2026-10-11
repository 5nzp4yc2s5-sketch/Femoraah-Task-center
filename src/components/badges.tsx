import type { Flag, Priority, TaskStatus } from '@/lib/types';

const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset';

const statusStyles: Record<TaskStatus, string> = {
  'Not Started': 'bg-slate-50 text-slate-700 ring-slate-300',
  'In Progress': 'bg-blue-50 text-blue-800 ring-blue-200',
  Blocked: 'bg-slate-200 text-slate-800 ring-slate-400',
  Done: 'bg-green-100 text-green-800 ring-green-300',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`${base} ${statusStyles[status]}`}>{status}</span>;
}

const priorityStyles: Record<Priority, string> = {
  High: 'bg-red-50 text-red-700 ring-red-200',
  Medium: 'bg-amber-50 text-amber-800 ring-amber-200',
  Low: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`${base} ${priorityStyles[priority]}`}>{priority}</span>;
}

// Spreadsheet colours: red = overdue, amber = due within 3 days or no update for 3+ days,
// grey = blocked, green = done.
export const flagStyles: Record<Flag, { badge: string; row: string; dot: string }> = {
  Overdue: { badge: 'bg-red-100 text-red-800 ring-red-300', row: 'bg-red-50/70', dot: 'bg-red-500' },
  'Due soon': { badge: 'bg-amber-100 text-amber-900 ring-amber-300', row: 'bg-amber-50/70', dot: 'bg-amber-500' },
  Stale: { badge: 'bg-amber-100 text-amber-900 ring-amber-300', row: 'bg-amber-50/70', dot: 'bg-amber-500' },
  Blocked: { badge: 'bg-slate-200 text-slate-800 ring-slate-400', row: 'bg-slate-100', dot: 'bg-slate-500' },
  Done: { badge: 'bg-green-100 text-green-800 ring-green-300', row: 'bg-done/60', dot: 'bg-green-600' },
  'On track': { badge: 'bg-white text-slate-600 ring-slate-200', row: '', dot: 'bg-slate-300' },
};

export function FlagBadge({ flag }: { flag: Flag }) {
  const s = flagStyles[flag] ?? flagStyles['On track'];
  return (
    <span className={`${base} ${s.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {flag}
    </span>
  );
}

const routineStyles: Record<string, string> = {
  OK: 'bg-green-100 text-green-800 ring-green-300',
  'Due today': 'bg-amber-100 text-amber-900 ring-amber-300',
  Overdue: 'bg-red-100 text-red-800 ring-red-300',
  'Not logged yet': 'bg-slate-100 text-slate-700 ring-slate-300',
  Paused: 'bg-white text-slate-500 ring-slate-200',
};

export function RoutineStatusBadge({ status }: { status: string }) {
  return <span className={`${base} ${routineStyles[status] ?? routineStyles.Paused}`}>{status}</span>;
}

export function BacklogStatusBadge({ status, approval }: { status: string; approval: string }) {
  const style =
    status === 'Assigned'
      ? 'bg-green-100 text-green-800 ring-green-300'
      : status === 'Rejected'
        ? 'bg-slate-200 text-slate-700 ring-slate-300'
        : 'bg-blue-50 text-blue-800 ring-blue-200';
  return (
    <span className={`${base} ${style}`}>
      {status}
      {status === 'Open' && approval === 'Pending' ? ' · awaiting approval' : ''}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div className={`h-full rounded-full ${v === 100 ? 'bg-green-600' : 'bg-navy-700'}`} style={{ width: `${v}%` }} />
      </div>
      <span className="tabular-nums text-xs text-slate-700">{v}%</span>
    </div>
  );
}
