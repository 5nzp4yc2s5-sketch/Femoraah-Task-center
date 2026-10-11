import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import type { BacklogRow } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { BacklogStatusBadge, PriorityBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { Notice, SectionTitle } from '@/components/ui';
import { approveBacklogAction, refreshSuggestionAction, rejectBacklogAction, updateBacklogAction } from '../actions';
import { BacklogFields } from '../fields';

export const metadata = { title: 'Backlog item' };

export default async function BacklogDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const { data } = await supabase.from('backlog_board').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const b = data as BacklogRow;
  const members = await activeMembers();
  const open = b.status === 'Open';
  const canEdit = open && (me.isManager || me.memberId === b.requested_by);

  return (
    <div className="max-w-5xl">
      {sp.created && <Notice>Added to the backlog. {b.suggested_owner_name ? `Suggested owner: ${b.suggested_owner_name}.` : ''} A manager will review it.</Notice>}
      <Link href="/backlog" className="text-sm text-navy-700 hover:underline">← Pending Backlog</Link>
      <div className="mb-5 mt-2">
        <div className="font-mono text-xs text-slate-500">{b.backlog_code}</div>
        <h1 className="text-xl font-semibold text-navy-900 sm:text-2xl">{b.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <BacklogStatusBadge status={b.status} approval={b.approval} />
          <PriorityBadge priority={b.priority} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <dl className="card grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm sm:grid-cols-3">
            <div><dt className="label">Requested By</dt><dd>{b.requested_by_name}</dd></div>
            <div><dt className="label">Date Added</dt><dd>{fmtDate(b.date_added)}</dd></div>
            <div><dt className="label">Due Date</dt><dd>{fmtDate(b.due_date)}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="label">Skills Needed</dt><dd>{b.skills_needed}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="label">Details</dt><dd className="whitespace-pre-wrap text-slate-700">{b.details || '—'}</dd></div>
          </dl>

          <section className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-navy-900">Suggested Owner: {b.suggested_owner_name ?? 'none'}</h2>
                <p className="mt-1 text-sm text-slate-700">{b.suggestion_reason ?? 'No suggestion yet.'}</p>
                {b.suggested_at && <p className="mt-1 text-xs text-slate-500">Calculated <LocalTime iso={b.suggested_at} /></p>}
              </div>
              {open && (
                <ActionForm action={refreshSuggestionAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <SubmitButton className="btn-secondary whitespace-nowrap" pendingText="…">Recalculate</SubmitButton>
                </ActionForm>
              )}
            </div>
            {b.suggestion_candidates.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th className="text-right">Score</th>
                      <th className="text-right">Skill match</th>
                      <th>Matched skills</th>
                      <th className="text-right">Open / max</th>
                      <th className="text-right">Overdue</th>
                      <th className="text-right">Blocked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.suggestion_candidates.map((c) => (
                      <tr key={c.member_id} className={c.has_capacity ? '' : 'text-slate-400'}>
                        <td className="whitespace-nowrap font-medium">{c.name}{!c.has_capacity && ' (at capacity)'}</td>
                        <td className="text-right tabular-nums">{Number(c.score).toFixed(2)}</td>
                        <td className="text-right tabular-nums">{Math.round(c.skill * 100)}%</td>
                        <td className="text-xs">{c.matched.join(', ') || '—'}</td>
                        <td className="text-right tabular-nums">{c.open}/{c.max}</td>
                        <td className="text-right tabular-nums">{c.overdue}</td>
                        <td className="text-right tabular-nums">{c.blocked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">Score = 70% skill match + 30% spare capacity (open + overdue + half of blocked, against Max Open Tasks). People at capacity are not suggested.</p>
              </div>
            )}
          </section>

          {canEdit && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-navy-900">Edit backlog item</summary>
              <ActionForm action={updateBacklogAction} className="mt-4 space-y-4">
                <input type="hidden" name="id" value={b.id} />
                <BacklogFields item={b} />
                <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </div>

        <aside className="space-y-5">
          {open && me.isManager && (
            <section className="card border-navy-600/40 p-5">
              <h2 className="font-semibold text-navy-900">Manager decision</h2>
              <p className="mb-3 mt-1 text-sm text-slate-600">Approving creates the Task Board entry and marks this row Assigned.</p>
              <ActionForm action={approveBacklogAction} className="space-y-3">
                <input type="hidden" name="id" value={b.id} />
                <div>
                  <label className="label" htmlFor="owner_id">Assign to</label>
                  <select id="owner_id" name="owner_id" className="input" defaultValue={b.suggested_owner_id ?? ''} required>
                    <option value="" disabled>Choose…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{m.id === b.suggested_owner_id ? ' (suggested)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="note">Decision note</label>
                  <input id="note" name="note" className="input" maxLength={1000} placeholder="Optional, e.g. why you overrode the suggestion" />
                </div>
                <SubmitButton className="btn-primary w-full" pendingText="Approving…">Approve and assign</SubmitButton>
              </ActionForm>
              <div className="mt-3">
                <ConfirmAction action={rejectBacklogAction} label="Reject" title="Reject this backlog item?" body="It will be marked Rejected and kept for the record. No task is created." confirmLabel="Reject" className="btn-secondary w-full" hidden={{ id: b.id }} withNote />
              </div>
            </section>
          )}
          {open && !me.isManager && <Notice>Waiting for a manager to approve an owner.</Notice>}
          {!open && (
            <section className="card p-5 text-sm">
              <SectionTitle>Decision</SectionTitle>
              <p>
                <strong>{b.approval === 'Yes' ? 'Approved' : 'Rejected'}</strong> by {b.decided_by_name} · <LocalTime iso={b.decided_at} />
              </p>
              {b.status === 'Assigned' && (
                <p className="mt-1">
                  Assigned to <strong>{b.final_owner_name}</strong>
                  {b.overrode_suggestion ? ` (overrode suggestion: ${b.suggested_owner_name ?? 'none'})` : ' (as suggested)'}.{' '}
                  {b.task_id && <Link href={`/tasks/${b.task_id}`} className="text-navy-700 underline">Open task</Link>}
                </p>
              )}
              {b.decision_note && <p className="mt-1 text-slate-600">Note: {b.decision_note}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
