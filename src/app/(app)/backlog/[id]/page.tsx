import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { fmtDate, friendlyError } from '@/lib/format';
import type { BacklogRow, TeamRow } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { BacklogStatusBadge, CapacityBadge, PriorityBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { Notice, SectionTitle } from '@/components/ui';
import { convertBacklogAction, refreshSuggestionAction, rejectBacklogAction, updateBacklogAction } from '../actions';
import { ApproveForm } from '../approve-form';
import { BacklogFields } from '../fields';

export const metadata = { title: 'Backlog item' };

const yesNo = (v: boolean, yes: string, no: string, yesClass: string) => (v ? <span className={yesClass}>{yes}</span> : <span className="text-slate-500">{no}</span>);

export default async function BacklogDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; approved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const { data, error } = await supabase.from('backlog_board').select('*').eq('id', id).maybeSingle();
  if (error) {
    return (
      <div className="max-w-5xl">
        <Link href="/backlog" className="link text-sm">← Pending Backlog</Link>
        <div className="mt-3"><Notice tone="error">Could not load this backlog item: {friendlyError(error.message)}</Notice></div>
      </div>
    );
  }
  if (!data) notFound();
  const b = data as BacklogRow;
  const pending = b.status === 'Pending';
  const approved = b.status === 'Approved';
  const converted = b.status === 'Converted to Task';
  const dismissed = b.status === 'Dismissed';
  const canEdit = pending && (me.isManager || me.memberId === b.requested_by);

  const [members, { data: teamData }] = await Promise.all([me.isManager && pending ? activeMembers() : Promise.resolve([]), supabase.rpc('team_overview')]);
  const team = new Map(((teamData ?? []) as TeamRow[]).map((m) => [m.member_id, m]));
  const suggested = b.suggested_owner_id ? team.get(b.suggested_owner_id) : undefined;
  const assigned = b.final_owner_id ? team.get(b.final_owner_id) : undefined;
  const candidates = b.suggestion_candidates ?? [];

  return (
    <div className="max-w-5xl">
      {sp.created && <Notice>Added to the backlog. {b.suggested_owner_name ? `Suggested owner: ${b.suggested_owner_name}.` : ''} A manager will review it.</Notice>}
      {sp.approved && approved && <Notice>Approved and assigned to {b.final_owner_name}. Use &quot;Convert to task&quot; when the work should start.</Notice>}
      <Link href="/backlog" className="link text-sm">← Pending Backlog</Link>
      <div className="mb-5 mt-2">
        <div className="text-xs tabular-nums text-slate-500">{b.backlog_code}</div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{b.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <BacklogStatusBadge status={b.status} />
          <PriorityBadge priority={b.priority} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <dl className="card grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm sm:grid-cols-3">
            <div><dt className="label">Requested By</dt><dd>{b.requested_by_name}</dd></div>
            <div><dt className="label">Date Added</dt><dd>{fmtDate(b.date_added)}</dd></div>
            <div><dt className="label">Due Date</dt><dd>{fmtDate(b.due_date)}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="label">Skills Needed</dt><dd>{b.skills_needed}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="label">Details</dt><dd className="whitespace-pre-wrap text-slate-700">{b.details || '—'}</dd></div>
          </dl>

          <section className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900">Suggested assignee: {b.suggested_owner_name ?? 'none'}</h2>
                {suggested && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>Now:</span>
                    <CapacityBadge status={suggested.capacity_status} />
                    {suggested.on_leave && suggested.leave_until && <span>until {fmtDate(suggested.leave_until)}</span>}
                    <span className="tabular-nums">{suggested.open_tasks}/{suggested.max_open_tasks} open</span>
                  </div>
                )}
                <p className="mt-2 text-[13px] text-slate-500">Suggested by rules: skills, workload, overdue, blocked, availability</p>
                <p className="mt-1 text-sm text-slate-700">{b.suggestion_reason ?? 'No suggestion yet.'}</p>
                {b.suggested_at && <p className="mt-1 text-xs text-slate-500">Calculated <LocalTime iso={b.suggested_at} /></p>}
              </div>
              {pending && (
                <ActionForm action={refreshSuggestionAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <SubmitButton className="btn-secondary whitespace-nowrap" pendingText="…">Recalculate</SubmitButton>
                </ActionForm>
              )}
            </div>
            {candidates.length > 0 && (
              <div className="mt-4">
                {/* Phones: one card per candidate */}
                <ul className="space-y-2 md:hidden">
                  {candidates.map((c) => (
                    <li key={c.member_id} className={`rounded-lg border border-line p-3 text-sm ${c.eligible ? '' : 'text-slate-500'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        {yesNo(c.eligible, 'Eligible', 'Not eligible', 'text-xs font-semibold text-green-700')}
                      </div>
                      <div className="mt-1 text-xs">
                        Skill match {Math.round(c.skill * 100)}% · Open {c.open}/{c.max} · Overdue {c.overdue} · Blocked {c.blocked} · Score {Number(c.score).toFixed(2)}
                      </div>
                      {c.matched.length > 0 && <div className="mt-0.5 text-xs">Matched: {c.matched.join(', ')}</div>}
                      {c.on_leave && <div className="mt-0.5 text-xs font-medium text-violet-800">On leave today</div>}
                    </li>
                  ))}
                </ul>
                {/* Tablet / desktop: sheet */}
                <div className="hidden overflow-x-auto md:block">
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
                        <th>On leave</th>
                        <th>Eligible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => (
                        <tr key={c.member_id} className={c.eligible ? '' : 'text-slate-400'}>
                          <td className="whitespace-nowrap font-medium">
                            {c.name}
                            {!c.has_capacity && ' (at capacity)'}
                          </td>
                          <td className="text-right tabular-nums">{Number(c.score).toFixed(2)}</td>
                          <td className="text-right tabular-nums">{Math.round(c.skill * 100)}%</td>
                          <td className="text-xs">{c.matched.join(', ') || '—'}</td>
                          <td className="text-right tabular-nums">{c.open}/{c.max}</td>
                          <td className="text-right tabular-nums">{c.overdue}</td>
                          <td className="text-right tabular-nums">{c.blocked}</td>
                          <td>{yesNo(c.on_leave, 'On leave', 'No', 'text-xs font-semibold text-violet-800')}</td>
                          <td>{yesNo(c.eligible, 'Yes', 'No', 'text-xs font-semibold text-green-700')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Score = 70% skill match + 30% spare capacity (open + overdue + half of blocked, against Max Open Tasks). Only eligible people are suggested: not on leave today and below their open-task limit. Figures are from when the suggestion was calculated.
                </p>
              </div>
            )}
          </section>

          {canEdit && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-slate-900">Edit backlog item</summary>
              <ActionForm action={updateBacklogAction} className="mt-4 space-y-4">
                <input type="hidden" name="id" value={b.id} />
                <BacklogFields item={b} />
                <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </div>

        <aside className="space-y-5">
          {pending && me.isManager && (
            <section className="card border-navy-600/40 p-5">
              <h2 className="font-semibold text-slate-900">Manager decision</h2>
              <p className="mb-3 mt-1 text-sm text-slate-600">&quot;Approve and create task&quot; puts it on the Task Board as To Do. &quot;Approve only&quot; records who will take it; create the task later.</p>
              <ApproveForm
                itemId={b.id}
                suggestedId={b.suggested_owner_id}
                options={members.map((m) => {
                  const t = team.get(m.id);
                  return { id: m.id, name: m.name, onLeave: Boolean(t?.on_leave), leaveUntil: t?.leave_until ?? null };
                })}
              />
              <div className="mt-3">
                <ConfirmAction action={rejectBacklogAction} label="Dismiss" title="Dismiss this backlog item?" body="It will be marked Dismissed and kept for the record. No task is created. Add a reason so the requester knows why." confirmLabel="Dismiss" className="btn-secondary w-full" hidden={{ id: b.id }} withNote />
              </div>
            </section>
          )}
          {pending && !me.isManager && <Notice>Waiting for a manager to approve who takes it.</Notice>}

          {approved && (
            <section className={`card p-5 text-sm ${me.isManager ? 'border-navy-600/40' : ''}`}>
              <h2 className="font-semibold text-slate-900">Approved, not yet a task</h2>
              <p className="mt-2">
                Assigned to <strong>{b.final_owner_name}</strong>
                {b.overrode_suggestion ? ` (overrode suggestion: ${b.suggested_owner_name ?? 'none'})` : ' (as suggested)'}.
              </p>
              {assigned && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>Now:</span>
                  <CapacityBadge status={assigned.capacity_status} />
                  {assigned.on_leave && assigned.leave_until && <span>until {fmtDate(assigned.leave_until)}</span>}
                </div>
              )}
              {b.override_leave && <p className="mt-1 text-xs text-violet-800">Approved while {b.final_owner_name} was on leave.</p>}
              <p className="mt-1 text-slate-600">Approved by {b.decided_by_name ?? '—'} · <LocalTime iso={b.decided_at} /></p>
              {b.decision_note && <p className="mt-1 text-slate-600">Note: {b.decision_note}</p>}
              {me.isManager ? (
                <div className="mt-4 space-y-3">
                  <ActionForm action={convertBacklogAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <SubmitButton className="btn-primary w-full" pendingText="Creating task…">Convert to task</SubmitButton>
                  </ActionForm>
                  <ConfirmAction action={rejectBacklogAction} label="Dismiss" title="Dismiss this approved item?" body="It will be marked Dismissed and kept for the record. No task is created." confirmLabel="Dismiss" className="btn-secondary w-full" hidden={{ id: b.id }} withNote />
                </div>
              ) : (
                <p className="mt-3 text-slate-600">A manager will convert it to a task.</p>
              )}
            </section>
          )}

          {converted && (
            <section className="card p-5 text-sm">
              <SectionTitle>Decision</SectionTitle>
              <p>
                Assigned to <strong>{b.final_owner_name}</strong>
                {b.overrode_suggestion ? ` (overrode suggestion: ${b.suggested_owner_name ?? 'none'})` : ' (as suggested)'}.
              </p>
              {b.override_leave && <p className="mt-1 text-xs text-violet-800">Assigned while {b.final_owner_name} was on leave.</p>}
              <p className="mt-1">
                <strong>Approved</strong> by {b.decided_by_name ?? '—'} · <LocalTime iso={b.decided_at} />
              </p>
              <p className="mt-1">
                <strong>Converted to task</strong> by {b.converted_by_name ?? '—'} · <LocalTime iso={b.converted_at} />
              </p>
              {b.decision_note && <p className="mt-1 text-slate-600">Note: {b.decision_note}</p>}
              {b.task_id && (
                <Link href={`/tasks/${b.task_id}`} className="btn-secondary mt-4 w-full">Open task</Link>
              )}
            </section>
          )}

          {dismissed && (
            <section className="card p-5 text-sm">
              <SectionTitle>Decision</SectionTitle>
              <p>
                <strong>Dismissed</strong> by {b.decided_by_name ?? '—'} · <LocalTime iso={b.decided_at} />
              </p>
              <p className="mt-1 text-slate-600">Reason: {b.decision_note || 'none given'}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
