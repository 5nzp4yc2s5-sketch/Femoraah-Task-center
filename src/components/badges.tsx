import type { CapacityStatus, Flag, Priority, TaskStatus } from '@/lib/types';

const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';

const statusStyles: Record<TaskStatus, string> = {
  'To Do': 'bg-slate-100 text-slate-700',
  Active: 'bg-blue-50 text-blue-700',
  Blocked: 'bg-orange-50 text-orange-700',
  Done: 'bg-green-50 text-green-700',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`${base} ${statusStyles[status]}`}>{status}</span>;
}

// Priority reads as a small three-step meter beside the word, so a column of them scans by shape.
const priorityLevel: Record<Priority, { bars: number; bar: string; text: string }> = {
  Critical: { bars: 3, bar: 'bg-red-600', text: 'font-semibold text-red-700' },
  High: { bars: 3, bar: 'bg-orange-500', text: 'text-slate-800' },
  Medium: { bars: 2, bar: 'bg-amber-400', text: 'text-slate-700' },
  Low: { bars: 1, bar: 'bg-slate-400', text: 'text-slate-500' },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const p = priorityLevel[priority] ?? priorityLevel.Low;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${p.text}`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`w-[3px] rounded-[1px] ${i < p.bars ? p.bar : 'bg-slate-200'}`} style={{ height: 5 + i * 3 }} />
        ))}
      </span>
      {priority}
    </span>
  );
}

// Spreadsheet colours: red = overdue, orange = blocked, amber = due within 3 days or no update
// for 3+ days, yellow = due within 7 days, green = done. In tables the colour marks the row's edge.
export const flagStyles: Record<Flag, { badge: string; row: string; dot: string }> = {
  Overdue: { badge: 'bg-red-50 text-red-700', row: 'edge-red', dot: 'bg-red-500' },
  'Due soon': { badge: 'bg-amber-50 text-amber-800', row: 'edge-amber', dot: 'bg-amber-500' },
  Stale: { badge: 'bg-amber-50 text-amber-800', row: 'edge-amber', dot: 'bg-amber-500' },
  Blocked: { badge: 'bg-orange-50 text-orange-700', row: 'edge-orange', dot: 'bg-orange-500' },
  'Due in 7 days': { badge: 'bg-yellow-50 text-yellow-800', row: 'edge-yellow', dot: 'bg-yellow-400' },
  Done: { badge: 'bg-green-50 text-green-700', row: 'edge-green row-done', dot: 'bg-green-600' },
  'On track': { badge: 'bg-slate-100 text-slate-600', row: '', dot: 'bg-slate-400' },
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
  OK: 'bg-green-50 text-green-700',
  'Due Today': 'bg-amber-50 text-amber-800',
  Overdue: 'bg-red-50 text-red-700',
  'Not Logged': 'bg-slate-100 text-slate-700',
  Paused: 'bg-slate-100 text-slate-500',
};

export function RoutineStatusBadge({ status }: { status: string }) {
  return <span className={`${base} ${routineStyles[status] ?? routineStyles.Paused}`}>{status}</span>;
}

/** Row edge colour for a routine's status, matching its badge. */
export const routineEdge: Record<string, string> = {
  Overdue: 'edge-red',
  'Due Today': 'edge-amber',
  OK: 'edge-green',
};

const backlogStyles: Record<string, string> = {
  Pending: 'bg-blue-50 text-blue-700',
  Approved: 'bg-amber-50 text-amber-800',
  'Converted to Task': 'bg-green-50 text-green-700',
  Dismissed: 'bg-slate-100 text-slate-600',
};

export function BacklogStatusBadge({ status }: { status: string }) {
  return <span className={`${base} ${backlogStyles[status] ?? backlogStyles.Pending}`}>{status}</span>;
}

const capacityStyles: Record<CapacityStatus, string> = {
  Available: 'bg-green-50 text-green-700',
  'At Capacity': 'bg-amber-50 text-amber-800',
  Overloaded: 'bg-red-50 text-red-700',
  'On Leave': 'bg-violet-50 text-violet-700',
};

export function CapacityBadge({ status }: { status: CapacityStatus }) {
  return <span className={`${base} ${capacityStyles[status] ?? capacityStyles.Available}`}>{status}</span>;
}

// Attendance: green = on time / normal, amber = within grace / overtime, red = late / left early /
// not logged in, orange = incomplete, violet = leave, slate = holiday or day off.
const attendanceStyles: Record<string, string> = {
  'On Time': 'bg-green-50 text-green-700',
  'Within Grace Period': 'bg-amber-50 text-amber-800',
  Late: 'bg-red-50 text-red-700',
  'Not Logged In': 'bg-red-50 text-red-700',
  'Currently Working': 'bg-blue-50 text-blue-700',
  'Logged Out': 'bg-green-50 text-green-700',
  'Left Early': 'bg-red-50 text-red-700',
  Overtime: 'bg-amber-50 text-amber-800',
  'Incomplete Session': 'bg-orange-50 text-orange-700',
  'On Leave': 'bg-violet-50 text-violet-700',
  Holiday: 'bg-slate-100 text-slate-700',
  'Weekly Off': 'bg-slate-100 text-slate-500',
  'No Schedule': 'bg-slate-100 text-slate-500',
  Open: 'bg-red-50 text-red-700',
  Reviewed: 'bg-amber-50 text-amber-800',
  Resolved: 'bg-green-50 text-green-700',
  Pending: 'bg-blue-50 text-blue-700',
  Approved: 'bg-green-50 text-green-700',
  Rejected: 'bg-slate-100 text-slate-600',
  Waived: 'bg-slate-100 text-slate-600',
  Exempt: 'bg-sky-50 text-sky-700',
  'On Break': 'bg-amber-50 text-amber-800',
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
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className={`h-full rounded-full ${v === 100 ? 'bg-green-600' : 'bg-navy-700'}`} style={{ width: `${v}%` }} />
      </div>
      <span className="tabular-nums text-xs text-slate-600">{v}%</span>
    </div>
  );
}
