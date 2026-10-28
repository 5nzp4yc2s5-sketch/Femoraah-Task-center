import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { FREQUENCIES, ROUTINE_STATUSES, type RoutineRow } from '@/lib/types';
import { Notice, PageHeader } from '@/components/ui';
import { RoutineTable } from '@/components/routine-table';

export const metadata = { title: 'Routine Tasks' };

type SP = { status?: string; owner?: string; frequency?: string };

const UUID = /^[0-9a-f-]{36}$/i;

/** Accepts the status names in any case, plus the old "Due today" / "Not logged yet" links. */
function pickStatus(v: string | undefined) {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('not logged')) return 'Not Logged';
  return ROUTINE_STATUSES.find((x) => x.toLowerCase() === s) ?? '';
}

export default async function Routines({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const [{ data: summary }, { data, error }] = await Promise.all([
    supabase.rpc('my_summary'),
    supabase.from('routine_board').select('*').order('routine_no'),
  ]);
  const all = (data ?? []) as RoutineRow[];

  const owner = sp.owner && UUID.test(sp.owner) ? sp.owner : '';
  const frequency = FREQUENCIES.find((f) => f === sp.frequency) ?? '';
  const status = pickStatus(sp.status);
  const hasFilters = Boolean(owner || frequency || status);

  const owners = Array.from(new Map(all.map((r) => [r.owner_id, r.owner_name ?? '—'])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  // Counts cover the chosen employee and frequency; the status filter then narrows the list.
  const scoped = all.filter((r) => (!owner || r.owner_id === owner) && (!frequency || r.frequency === frequency));
  const count = (s: string) => scoped.filter((r) => r.status === s).length;
  const doneToday = scoped.filter((r) => r.done_today).length;

  const rank = (r: RoutineRow) => (r.owner_id === me.memberId ? 0 : r.covered_by_id === me.memberId ? 1 : r.backup_member_id === me.memberId ? 2 : 3);
  const rows = scoped
    .filter((r) => !status || r.status === status)
    .sort((a, b) => rank(a) - rank(b) || (a.owner_name ?? '').localeCompare(b.owner_name ?? '') || a.routine_no - b.routine_no);

  const href = (s: string) => {
    const p = new URLSearchParams();
    if (owner) p.set('owner', owner);
    if (frequency) p.set('frequency', frequency);
    if (s) p.set('status', s);
    const q = p.toString();
    return q ? `/routines?${q}` : '/routines';
  };
  const figure = (label: string, s: string, n: number, tone: string) => (
    <Link
      href={href(status === s ? '' : s)}
      className={`rounded px-1 hover:underline ${status === s ? 'bg-navy-100 font-semibold text-slate-900' : ''}`}
      aria-current={status === s ? 'true' : undefined}
    >
      {label} <span className={`font-semibold tabular-nums ${n ? tone : 'text-slate-700'}`}>{n}</span>
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Routine Tasks"
        subtitle={
          me.isManager
            ? 'Recurring work. Tick it off each cycle; Next Due is calculated from Last Done + Every N Days.'
            : 'Recurring work. Tick it off each cycle; Next Due is calculated from Last Done + Every N Days. You see your own routines and the ones you back up or cover.'
        }
        actions={me.isManager ? <Link href="/routines/new" className="btn-primary">New routine</Link> : undefined}
      />
      {error && <Notice tone="error">Could not load routines: {friendlyError(error.message)}</Notice>}
      {Number(summary?.covering) > 0 && (
        <Notice>
          You are covering {summary.covering} routine{summary.covering === 1 ? '' : 's'} today while a teammate is on leave. They are marked below.
        </Notice>
      )}
      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3" role="search">
        {owners.length > 1 && (
          <select name="owner" defaultValue={owner} className="input w-auto" aria-label="Assigned to">
            <option value="">Everyone</option>
            {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <select name="frequency" defaultValue={frequency} className="input w-auto" aria-label="Frequency">
          <option value="">Any frequency</option>
          {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input w-auto" aria-label="Status">
          <option value="">All statuses</option>
          {ROUTINE_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
        {hasFilters && <Link href="/routines" className="btn-ghost">Clear</Link>}
      </form>
      {scoped.length > 0 && (
        <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          <span>
            {scoped.length} routine{scoped.length === 1 ? '' : 's'} ·
          </span>
          <span>
            Done today <span className="font-semibold tabular-nums text-green-700">{doneToday}</span>
          </span>
          <span aria-hidden>·</span>
          {figure('OK', 'OK', count('OK'), 'text-green-700')}
          <span aria-hidden>·</span>
          {figure('Due today', 'Due Today', count('Due Today'), 'text-amber-700')}
          <span aria-hidden>·</span>
          {figure('Overdue', 'Overdue', count('Overdue'), 'text-red-700')}
          <span aria-hidden>·</span>
          {figure('Not logged', 'Not Logged', count('Not Logged'), 'text-slate-700')}
          <span aria-hidden>·</span>
          {figure('Paused', 'Paused', count('Paused'), 'text-slate-500')}
        </p>
      )}
      <RoutineTable
        rows={rows}
        canComplete={(r) => r.owner_id === me.memberId || me.isManager || r.covered_by_id === me.memberId}
        today={summary?.today}
        viewerId={me.memberId}
        empty={
          error
            ? { title: 'Routines could not be loaded', body: 'Please refresh the page to try again.' }
            : hasFilters
              ? { title: 'No routines match these filters', action: <Link href="/routines" className="btn-secondary">Clear filters</Link> }
              : me.isManager
                ? { title: 'No routine tasks yet', body: 'Create recurring work such as daily packing or weekly stock counts.', action: <Link href="/routines/new" className="btn-primary">New routine</Link> }
                : { title: 'No routine tasks', body: 'Recurring work assigned to you, or that you back up, will appear here.' }
        }
      />
    </>
  );
}
