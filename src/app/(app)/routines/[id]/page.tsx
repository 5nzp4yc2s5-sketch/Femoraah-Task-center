import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate, friendlyError } from '@/lib/format';
import type { RoutineRow } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { RoutineStatusBadge } from '@/components/badges';
import { MarkDone } from '@/components/mark-done';
import { LocalTime } from '@/components/local-time';
import { CoverNote } from '@/components/routine-table';
import { EmptyState, Notice, SectionTitle } from '@/components/ui';
import { deleteCompletionAction, setRoutineActiveAction, updateRoutineAction } from '../actions';
import { RoutineFields } from '../fields';

export const metadata = { title: 'Routine' };

interface Completion {
  id: string;
  cycle_due: string;
  completed_on: string;
  completed_by: string;
  note: string;
  created_at: string;
  covering_for: string | null;
}

export default async function RoutineDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const { data, error } = await supabase.from('routine_board').select('*').eq('id', id).maybeSingle();
  if (error) {
    return (
      <div className="max-w-4xl">
        <Link href="/routines" className="link text-sm">← Routine Tasks</Link>
        <div className="mt-3"><Notice tone="error">Could not load this routine: {friendlyError(error.message)}</Notice></div>
      </div>
    );
  }
  if (!data) notFound();
  const r = data as RoutineRow;
  const [{ data: historyData, error: historyError }, { data: summary }, members, { data: names }] = await Promise.all([
    supabase
      .from('routine_completions')
      .select('id, cycle_due, completed_on, completed_by, note, created_at, covering_for')
      .eq('routine_id', id)
      .order('completed_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('my_summary'),
    me.isManager ? activeMembers() : Promise.resolve([]),
    supabase.from('members').select('id, name'),
  ]);
  const history = (historyData ?? []) as Completion[];
  const nameOf = (mid: string | null) => (mid ? (names?.find((m: { id: string; name: string }) => m.id === mid)?.name ?? 'a former member') : '—');
  const canComplete = r.owner_id === me.memberId || me.isManager || r.covered_by_id === me.memberId;
  const isBackupOnly = !canComplete && r.backup_member_id === me.memberId;

  const byCell = (h: Completion) => (
    <>
      {nameOf(h.completed_by)}
      {h.covering_for && <span className="text-xs text-violet-800"> (covering for {nameOf(h.covering_for)})</span>}
    </>
  );

  return (
    <div className="max-w-4xl">
      <Link href="/routines" className="link text-sm">← Routine Tasks</Link>
      <div className="mb-5 mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs tabular-nums text-slate-500">{r.routine_code}</div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{r.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Assigned to {r.owner_name} · {r.backup_name ? `Backup ${r.backup_name}` : 'No backup'} · {r.frequency}, every {r.every_n_days} day{r.every_n_days === 1 ? '' : 's'}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            Last done {fmtDate(r.last_done)}
            {r.last_completed_at && (
              <span className="text-slate-500"> (ticked off <LocalTime iso={r.last_completed_at} />)</span>
            )}{' '}
            · Next due {fmtDate(r.next_due)} · Done {r.times_done} time{r.times_done === 1 ? '' : 's'}
          </p>
          {r.notes && <p className="mt-1 text-sm text-slate-700">Notes: {r.notes}</p>}
          <CoverNote r={r} viewerId={me.memberId} />
          <div className="mt-2"><RoutineStatusBadge status={r.status} /></div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {canComplete && r.is_active && <MarkDone routineId={r.id} today={summary?.today} doneThisCycle={r.status === 'OK'} />}
          {me.isManager && (
            <ActionForm action={setRoutineActiveAction}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="is_active" value={r.is_active ? 'off' : 'on'} />
              <SubmitButton className="btn-secondary px-2.5 py-1 text-xs" pendingText="…">{r.is_active ? 'Pause routine' : 'Resume routine'}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {!r.is_active && <Notice tone="warn">This routine is paused. Nobody can tick it off until a manager resumes it.</Notice>}
      {isBackupOnly && r.is_active && (
        <Notice>You are the backup. You can tick this off only while {r.owner_name} is on leave.</Notice>
      )}

      <SectionTitle>Completion history</SectionTitle>
      {historyError ? (
        <Notice tone="error">Could not load the history: {friendlyError(historyError.message)}</Notice>
      ) : !history.length ? (
        <EmptyState title="Not logged yet" body="Each time this is ticked off, a dated entry is added here. Entries are never overwritten." />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {history.map((h) => (
              <li key={h.id} className="card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium tabular-nums text-slate-900">
                      {fmtDate(h.completed_on)}
                      {h.completed_on > h.cycle_due ? <span className="ml-1 text-xs text-red-700">late</span> : null}
                    </div>
                    <div className="text-xs text-slate-600">By {byCell(h)}</div>
                  </div>
                  <span className="text-xs text-slate-500"><LocalTime iso={h.created_at} /></span>
                </div>
                <div className="mt-1 text-xs text-slate-500">For cycle due {fmtDate(h.cycle_due)}</div>
                {h.note && <p className="mt-1 text-xs text-slate-600">{h.note}</p>}
                {me.isManager && (
                  <div className="mt-2">
                    <ConfirmAction action={deleteCompletionAction} label="Remove" title="Remove this entry?" body="Use this only to correct a mistaken tick-off. The removal is recorded in the audit log." confirmLabel="Remove entry" className="btn-ghost px-2 py-1 text-xs text-red-700" hidden={{ completion_id: h.id }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-x-auto md:block">
            <table className="sheet">
              <thead>
                <tr><th>Done on</th><th>For cycle due</th><th>By</th><th>Note</th><th>Logged</th>{me.isManager && <th />}</tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="tabular-nums">{fmtDate(h.completed_on)}</td>
                    <td className="tabular-nums">{fmtDate(h.cycle_due)}{h.completed_on > h.cycle_due ? <span className="ml-1 text-xs text-red-700">late</span> : null}</td>
                    <td>{byCell(h)}</td>
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
          {history.length === 200 && <p className="mt-2 text-xs text-slate-500">Showing the latest 200 entries.</p>}
        </>
      )}

      {me.isManager && (
        <details className="card mt-6 p-5">
          <summary className="cursor-pointer font-semibold text-slate-900">Edit routine</summary>
          <p className="mt-1 text-sm text-slate-600">Change the title, who it is assigned to, the backup, the frequency or the notes. History is kept.</p>
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
