import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { routinesFor } from '@/lib/data';
import { PageHeader } from '@/components/ui';
import { RoutineTable } from '@/components/routine-table';

export const metadata = { title: 'Routine Tasks' };

export default async function Routines({ searchParams }: { searchParams: Promise<{ status?: string; owner?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const supabase = await createClient();
  const [{ data: summary }, all] = await Promise.all([supabase.rpc('my_summary'), routinesFor()]);
  const owners = Array.from(new Map(all.map((r) => [r.owner_id, r.owner_name])).entries());
  const rows = all
    .filter((r) => !sp.status || r.status === sp.status)
    .filter((r) => !sp.owner || r.owner_id === sp.owner)
    .sort((a, b) => (a.owner_id === me.memberId ? -1 : 0) - (b.owner_id === me.memberId ? -1 : 0) || (a.owner_name ?? '').localeCompare(b.owner_name ?? ''));

  return (
    <>
      <PageHeader
        title="Routine Tasks"
        subtitle="Recurring work. Tick it off each cycle; Next Due is calculated from Last Done + Every N Days."
        actions={me.isManager ? <Link href="/routines/new" className="btn-primary">New routine</Link> : undefined}
      />
      <form className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <select name="status" defaultValue={sp.status ?? ''} className="input w-auto" aria-label="Status">
          <option value="">All statuses</option>
          {['Overdue', 'Due today', 'Not logged yet', 'OK', 'Paused'].map((s) => <option key={s}>{s}</option>)}
        </select>
        {owners.length > 1 && (
          <select name="owner" defaultValue={sp.owner ?? ''} className="input w-auto" aria-label="Owner">
            <option value="">All owners</option>
            {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <button className="btn-secondary">Apply</button>
        {(sp.status || sp.owner) && <Link href="/routines" className="btn-ghost">Clear</Link>}
      </form>
      <RoutineTable rows={rows} canComplete={(r) => r.owner_id === me.memberId || me.isManager} today={summary?.today} />
    </>
  );
}
