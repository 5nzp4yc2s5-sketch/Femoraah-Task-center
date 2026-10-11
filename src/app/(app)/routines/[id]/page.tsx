import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import type { RoutineRow } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { RoutineStatusBadge } from '@/components/badges';
import { MarkDone } from '@/components/mark-done';
import { LocalTime } from '@/components/local-time';
import { EmptyState, SectionTitle } from '@/components/ui';
import { deleteCompletionAction, updateRoutineAction } from '../actions';
import { RoutineFields } from '../fields';

export const metadata = { title: 'Routine' };

export default async function RoutineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const { data } = await supabase.from('routine_board').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const r = data as RoutineRow;
  const [{ data: history }, { data: summary }, members, { data: names }] = await Promise.all([
    supabase.from('routine_completions').select('id, cycle_due, completed_on, completed_by, note, created_at').eq('routine_id', id).order('completed_on', { ascending: false }).limit(200),
    supabase.rpc('my_summary'),
    me.isManager ? activeMembers() : Promise.resolve([]),
    supabase.from('members').select('id, name'),
  ]);
  const nameOf = (mid: string) => names?.find((m) => m.id === mid)?.name ?? '—';

  return (
    <div className="max-w-4xl">
      <Link href="/routines" className="text-sm text-navy-700 hover:underline">← Routine Tasks</Link>
      <div className="mb-5 mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy-900 sm:text-2xl">{r.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {r.owner_name} · {r.frequency}, every {r.every_n_days} day{r.every_n_days === 1 ? '' : 's'} · Last done {fmtDate(r.last_done)} · Next due {fmtDate(r.next_due)}
          </p>
          <div className="mt-2"><RoutineStatusBadge status={r.status} /></div>
        </div>
        {(r.owner_id === me.memberId || me.isManager) && r.is_active && <MarkDone routineId={r.id} today={summary?.today} doneThisCycle={r.status === 'OK'} />}
      </div>

      <SectionTitle>Completion history</SectionTitle>
      {!history?.length ? (
        <EmptyState title="Not logged yet" body="Each time this is ticked off, a dated entry is added here. Entries are never overwritten." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr><th>Done on</th><th>For cycle due</th><th>By</th><th>Note</th><th>Logged</th>{me.isManager && <th />}</tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="tabular-nums">{fmtDate(h.completed_on)}</td>
                  <td className="tabular-nums">{fmtDate(h.cycle_due)}{h.completed_on > h.cycle_due ? <span className="ml-1 text-xs text-red-700">late</span> : null}</td>
                  <td>{nameOf(h.completed_by)}</td>
                  <td className="text-slate-600">{h.note || '—'}</td>
                  <td className="text-xs text-slate-500"><LocalTime iso={h.created_at} /></td>
                  {me.isManager && (
                    <td className="text-right">
                      <ConfirmAction action={deleteCompletionAction} label="Remove" title="Remove this entry?" body="Use this only to correct a mistaken tick-off. The removal is recorded in the audit log." confirmLabel="Remove entry" className="btn-ghost px-2 py-1 text-xs text-red-700" hidden={{ completion_id: h.id }} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {me.isManager && (
        <details className="card mt-6 p-5">
          <summary className="cursor-pointer font-semibold text-navy-900">Edit routine</summary>
          <ActionForm action={updateRoutineAction} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={r.id} />
            <RoutineFields routine={r} members={members} />
            <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
