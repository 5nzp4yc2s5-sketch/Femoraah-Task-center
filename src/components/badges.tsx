import type { CapacityStatus, Flag, Priority, TaskStatus } from '@/lib/types';

const base = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset';

const statusStyles: Record<TaskStatus, string> = {
  'To Do': 'bg-slate-50 text-slate-700 ring-slate-300',
  Active: 'bg-blue-50 text-blue-800 ring-blue-200',
  Blocked: 'bg-orange-100 text-orange-800 ring-orange-300',
  Done: 'bg-green-100 text-green-800 ring-green-300',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`${base} ${statusStyles[status]}`}>{status}</span>;
}

const priorityStyles: Record<Priority, string> = {
  Critical: 'bg-red-600 text-white ring-red-700',
  High: 'bg-red-50 text-red-700 ring-red-200',
  Medium: 'bg-amber-50 text-amber-800 ring-amber-200',
  Low: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`${base} ${priorityStyles[priority]}`}>{priority}</span>;
}

// Spreadsheet colours: red = overdue, orange = blocked, amber = due within 3 days or no update
// for 3+ days, yellow = due within 7 days, green = done.
export const flagStyles: Record<Flag, { badge: string; row: string; dot: string }> = {
  Overdue: { badge: 'bg-red-100 text-red-800 ring-red-300', row: 'bg-red-50/70', dot: 'bg-red-500' },
  'Due soon': { badge: 'bg-amber-100 text-amber-900 ring-amber-300', row: 'bg-amber-50/70', dot: 'bg-amber-500' },
  Stale: { badge: 'bg-amber-100 text-amber-900 ring-amber-300', row: 'bg-amber-50/70', dot: 'bg-amber-500' },
  Blocked: { badge: 'bg-orange-100 text-orange-800 ring-orange-300', row: 'bg-orange-50/80', dot: 'bg-orange-500' },
  'Due in 7 days': { badge: 'bg-yellow-50 text-yellow-800 ring-yellow-200', row: '', dot: 'bg-yellow-400' },
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
  'Due Today': 'bg-amber-100 text-amber-900 ring-amber-300',
  Overdue: 'bg-red-100 text-red-800 ring-red-300',
  'Not Logged': 'bg-slate-100 text-slate-700 ring-slate-300',
  Paused: 'bg-white text-slate-500 ring-slate-200',
};

export function RoutineStatusBadge({ status }: { status: string }) {
  return <span className={`${base} ${routineStyles[status] ?? routineStyles.Paused}`}>{status}</span>;
}

const backlogStyles: Record<string, string> = {
  Pending: 'bg-blue-50 text-blue-800 ring-blue-200',
  Approved: 'bg-amber-50 text-amber-900 ring-amber-200',
  'Converted to Task': 'bg-green-100 text-green-800 ring-green-300',
  Dismissed: 'bg-slate-200 text-slate-700 ring-slate-300',
};

export function BacklogStatusBadge({ status }: { status: string }) {
  return <span className={`${base} ${backlogStyles[status] ?? backlogStyles.Pending}`}>{status}</span>;
}

const capacityStyles: Record<CapacityStatus, string> = {
  Available: 'bg-green-100 text-green-800 ring-green-300',
  'At Capacity': 'bg-amber-100 text-amber-900 ring-amber-300',
  Overloaded: 'bg-red-100 text-red-800 ring-red-300',
  'On Leave': 'bg-violet-50 text-violet-800 ring-violet-200',
};

export function CapacityBadge({ status }: { status: CapacityStatus }) {
  return <span className={`${base} ${capacityStyles[status] ?? capacityStyles.Available}`}>{status}</span>;
}

// Attendance: green = on time / normal, amber = within grace / overtime, red = late / left early /
// not logged in, orange = incomplete, violet = leave, slate = holiday or day off.
const attendanceStyles: Record<string, string> = {
  'On Time': 'bg-green-100 text-green-800 ring-green-300',
  'Within Grace Period': 'bg-amber-50 text-amber-900 ring-amber-200',
  Late: 'bg-red-100 text-red-800 ring-red-300',
  'Not Logged In': 'bg-red-50 text-red-700 ring-red-200',
  'Currently Working': 'bg-blue-50 text-blue-800 ring-blue-200',
  'Logged Out': 'bg-green-100 text-green-800 ring-green-300',
  'Left Early': 'bg-red-100 text-red-800 ring-red-300',
  Overtime: 'bg-amber-100 text-amber-900 ring-amber-300',
  'Incomplete Session': 'bg-orange-100 text-orange-800 ring-orange-300',
  'On Leave': 'bg-violet-50 text-violet-800 ring-violet-200',
  Holiday: 'bg-slate-100 text-slate-700 ring-slate-300',
  'Weekly Off': 'bg-white text-slate-500 ring-slate-200',
  'No Schedule': 'bg-white text-slate-500 ring-slate-200',
  Open: 'bg-red-50 text-red-700 ring-red-200',
  Reviewed: 'bg-amber-50 text-amber-900 ring-amber-200',
  Resolved: 'bg-green-100 text-green-800 ring-green-300',
  Pending: 'bg-blue-50 text-blue-800 ring-blue-200',
  Approved: 'bg-green-100 text-green-800 ring-green-300',
  Rejected: 'bg-slate-200 text-slate-700 ring-slate-300',
  Waived: 'bg-slate-100 text-slate-700 ring-slate-300',
  Exempt: 'bg-sky-50 text-sky-800 ring-sky-200',
  'On Break': 'bg-amber-50 text-amber-900 ring-amber-200',
};

export function AttendanceBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return <span className={`${base} ${attendanceStyles[status] ?? attendanceStyles['No Schedule']}`}>{status}</span>;
}

/** Round initials avatar, e.g. "SK" for Sanket Kumar or "Z" for Zinia. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-sm';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-semibold text-navy-800 ${dim}`} aria-hidden>
      {initials}
    </span>
  );
}

/** A small star shown on tasks someone flagged as important. */
export function FlaggedStar({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span title="Flagged as important" className="text-amber-500" aria-label="Flagged as important">
      ★
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
