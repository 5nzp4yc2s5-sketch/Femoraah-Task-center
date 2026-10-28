import Link from 'next/link';
import type { CapacityStatus } from '@/lib/types';
import { CapacityBadge } from './badges';

export interface FocusSummary {
  open: number;
  max_open_tasks: number;
  overdue: number;
  due_today: number;
  blocked: number;
  due_next_7: number;
  stale: number;
  routine_due_today: number;
  routine_overdue: number;
  routine_not_logged: number;
  routine_ok: number;
  routines_active: number;
  capacity_status: CapacityStatus;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One segment per task slot, so the meter reads as "7 of 15" at a glance. Falls back to a bar for big limits. */
function WorkloadMeter({ open, max, status }: { open: number; max: number; status: CapacityStatus }) {
  const fill = status === 'Overloaded' ? 'bg-red-500' : status === 'At Capacity' ? 'bg-amber-500' : 'bg-navy-700';
  const label = `${open} of ${max} open tasks`;
  if (max <= 0) return null;
  if (max > 24) {
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={label}>
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, (open / max) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div className="flex gap-[3px]" role="img" aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-5 flex-1 rounded-[3px] ${i < open ? fill : 'bg-slate-100'}`} />
      ))}
    </div>
  );
}

/**
 * The top of My Dashboard: the few numbers that need action today, large, then what is coming up.
 * A number only takes its colour when it is above zero, so a calm day looks calm.
 */
export function FocusPanel({ summary: s, memberId }: { summary: FocusSummary; memberId: string }) {
  const routinesHref = (status: string) => `/routines?owner=${memberId}&status=${encodeURIComponent(status)}`;
  const urgent = [
    { n: s.overdue, label: 'Overdue', href: '/tasks?scope=mine&flag=Overdue', tone: 'text-red-700' },
    { n: s.due_today, label: 'Due today', href: '/tasks?scope=mine&due=today', tone: 'text-amber-700' },
    { n: s.blocked, label: 'Blocked', href: '/tasks?scope=mine&status=Blocked', tone: 'text-orange-700' },
    { n: s.routine_overdue, label: s.routine_overdue === 1 ? 'Routine overdue' : 'Routines overdue', href: routinesHref('Overdue'), tone: 'text-red-700' },
  ];
  const clear = urgent.every((u) => u.n === 0);
  const soon = [
    s.due_next_7 > 0 && { text: `${plural(s.due_next_7, 'task')} due in the next 7 days`, href: '/tasks?scope=mine&due=week' },
    s.stale > 0 && { text: `${plural(s.stale, 'task')} with no update for 3+ days`, href: '/tasks?scope=mine&stale=1' },
    s.routine_due_today > 0 && { text: `${plural(s.routine_due_today, 'routine')} due today`, href: routinesHref('Due Today') },
    s.routine_not_logged > 0 && { text: `${plural(s.routine_not_logged, 'routine')} not logged yet`, href: routinesHref('Not Logged') },
  ].filter(Boolean) as { text: string; href: string }[];

  return (
    <section aria-labelledby="focus-title" className="card overflow-hidden">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_minmax(15rem,20rem)] lg:gap-10">
        <div>
          <h2 id="focus-title" className="text-[15px] font-semibold text-slate-900">
            Needs you now
          </h2>
          {clear ? (
            <p className="mt-4 text-lg text-slate-700">Nothing overdue, due today or blocked. A good day to get ahead.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              {urgent.map((u) => (
                <li key={u.label}>
                  <Link href={u.href} className="group block rounded-lg">
                    <span className={`block text-[40px] font-semibold leading-none tracking-tight tabular-nums ${u.n > 0 ? u.tone : 'text-slate-300'}`}>{u.n}</span>
                    <span className={`mt-2 block text-[13px] group-hover:underline ${u.n > 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{u.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div className="flex items-baseline justify-between gap-3">
            <Link href="/tasks?scope=mine" className="text-[15px] font-semibold text-slate-900 hover:underline">
              Workload
            </Link>
            <span className="text-sm tabular-nums text-slate-600">
              <strong className="font-semibold text-slate-900">{s.open}</strong> of {s.max_open_tasks} open
            </span>
          </div>
          <div className="mt-3">
            <WorkloadMeter open={s.open} max={s.max_open_tasks} status={s.capacity_status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-500">
            <CapacityBadge status={s.capacity_status} />
            <Link href="/routines" className="hover:underline">
              Routines {s.routine_ok} of {s.routines_active} up to date
            </Link>
          </div>
        </div>
      </div>
      {soon.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line bg-subtle px-5 py-3 text-[13px] sm:px-6">
          <span className="basis-full font-medium text-slate-500 sm:basis-auto">Coming up</span>
          {soon.map((c) => (
            <Link key={c.href} href={c.href} className="text-slate-700 hover:text-slate-900 hover:underline">
              {c.text}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
