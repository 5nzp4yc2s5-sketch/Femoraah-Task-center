import { createClient } from '@/lib/supabase/server';
import { addDays, dayParts, friendlyError } from '@/lib/format';
import { BarChart, Legend, type Bar, type Series } from '@/components/charts';
import { Notice } from '@/components/ui';
import { localDay } from '../sheets/lib';

const DAYS = 14;
const SERIES: Series[] = [
  { key: 'added', label: 'Added', className: 'bg-slate-300' },
  { key: 'done', label: 'Done', className: 'bg-accent' },
];

/** Tasks added and finished each day for two weeks: is the open work growing or shrinking? */
export async function TaskTrend({ today, timezone, member }: { today: string; timezone: string; member: string | null }) {
  const supabase = await createClient();
  const from = addDays(today, -(DAYS - 1));
  // A day of slack on each side of the range; exact days are worked out in the company time zone below.
  const since = `${addDays(from, -1)}T00:00:00Z`;
  let q = supabase.from('task_board').select('created_at, completed_at').or(`created_at.gte.${since},completed_at.gte.${since}`);
  if (member) q = q.eq('owner_id', member);
  const { data, error } = await q.limit(5000);
  if (error) return <Notice tone="error">Could not load the task trend: {friendlyError(error.message)}</Notice>;

  const added = new Map<string, number>();
  const done = new Map<string, number>();
  for (const t of (data ?? []) as { created_at: string; completed_at: string | null }[]) {
    const a = localDay(t.created_at, timezone);
    added.set(a, (added.get(a) ?? 0) + 1);
    if (t.completed_at) {
      const c = localDay(t.completed_at, timezone);
      done.set(c, (done.get(c) ?? 0) + 1);
    }
  }
  const bars: Bar[] = Array.from({ length: DAYS }, (_, i) => {
    const d = addDays(from, i);
    const p = dayParts(d);
    return {
      key: d,
      label: p.day,
      sublabel: p.weekday.slice(0, 2),
      title: p.title,
      values: { added: added.get(d) ?? 0, done: done.get(d) ?? 0 },
      note: d === today ? 'Today, so far' : undefined,
      muted: d === today,
    };
  });
  const totalAdded = bars.reduce((n, b) => n + b.values.added, 0);
  const totalDone = bars.reduce((n, b) => n + b.values.done, 0);
  const diff = totalAdded - totalDone;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
        <span>Added <strong className="tabular-nums text-slate-900">{totalAdded}</strong></span>
        <span>Done <strong className="tabular-nums text-slate-900">{totalDone}</strong></span>
        <span>
          {diff > 0 ? (
            <>Open work grew by <strong className="tabular-nums text-amber-800">{diff}</strong></>
          ) : diff < 0 ? (
            <>Open work shrank by <strong className="tabular-nums text-green-800">{-diff}</strong></>
          ) : (
            'Open work held steady'
          )}
        </span>
      </div>
      <BarChart bars={bars} series={SERIES} grouped label="Tasks added and done per day over the last 14 days" height={120} />
      <Legend series={SERIES} />
    </div>
  );
}
