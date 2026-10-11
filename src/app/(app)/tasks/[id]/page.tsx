import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { activeMembers } from '@/lib/data';
import { daysLeftLabel, fmtDate } from '@/lib/format';
import type { TaskRow } from '@/lib/types';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { FlagBadge, PriorityBadge, ProgressBar, StatusBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { FlagToggle, StatusSelect } from '@/components/status-select';
import { Notice, SectionTitle } from '@/components/ui';
import { addCollaboratorAction, removeCollaboratorAction, setArchivedAction, updateProgressAction, updateTaskAction } from '../actions';
import { CoreFields, ProgressFields } from '../task-fields';

export const metadata = { title: 'Task' };

type Activity = { at: string; kind: string; summary: string; actor_name: string | null };

const KIND_DOT: Record<string, string> = {
  assignment: 'bg-navy-700',
  delegated_by: 'bg-navy-700',
  blocker: 'bg-orange-500',
  due_date: 'bg-amber-500',
  start_date: 'bg-amber-500',
  flagged: 'bg-amber-400',
  progress: 'bg-slate-400',
};

export default async function TaskDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireMe();
  const supabase = await createClient();
  const { data: task } = await supabase.from('task_board').select('*').eq('id', id).maybeSingle<TaskRow>();
  if (!task) notFound();

  const [members, { data: collabs }, { data: activity, error: activityError }, backlog] = await Promise.all([
    activeMembers(),
    supabase.from('task_collaborators').select('member_id, added_at').eq('task_id', id),
    supabase.from('task_activity').select('at, kind, summary, actor_name').eq('task_id', id).order('at', { ascending: false }).limit(200),
    task.backlog_item_id ? supabase.from('backlog_board').select('id, backlog_code').eq('id', task.backlog_item_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const { data: allMembers } = await supabase.from('members').select('id, name');
  const nameOf = (mid: string | null) => allMembers?.find((m) => m.id === mid)?.name ?? (mid ? 'Former member' : '—');
  const collabIds = (collabs ?? []).map((c) => c.member_id);
  const canEdit = me.isManager || me.memberId === task.created_by || me.memberId === task.assigned_by;
  const canProgress = canEdit || me.memberId === task.owner_id || collabIds.includes(me.memberId);
  const canArchive = me.isManager || me.memberId === task.created_by;

  const history = (activity ?? []) as Activity[];

  return (
    <div className="max-w-5xl">
      {sp.created && <Notice>Task created and assigned to {task.owner_name}.</Notice>}
      {task.archived_at && <Notice tone="warn">This task is archived. It no longer counts toward workload or dashboards.</Notice>}
      <Link href="/tasks" className="text-sm text-navy-700 hover:underline">← Task Board</Link>
      <div className="mb-5 mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">{task.task_code}</div>
          <h1 className="text-xl font-semibold text-navy-900 sm:text-2xl">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <FlagBadge flag={task.flag} />
            {canProgress && !task.archived_at ? <StatusSelect id={task.id} status={task.status} blocker={task.blocker_reason} /> : <StatusBadge status={task.status} />}
            <PriorityBadge priority={task.priority} />
            {canProgress && !task.archived_at ? (
              <FlagToggle id={task.id} on={task.is_flagged} />
            ) : (
              task.is_flagged && <span className="text-amber-500" title="Flagged as important">★</span>
            )}
          </div>
        </div>
        {canArchive && (
          <div className="flex gap-2">
            {task.archived_at ? (
              <ConfirmAction action={setArchivedAction} label="Restore" title="Restore this task?" body="It will return to the Task Board and count toward workload again." confirmLabel="Restore" className="btn-secondary" hidden={{ id: task.id, archive: '0' }} />
            ) : (
              <ConfirmAction action={setArchivedAction} label="Archive" title="Archive this task?" body="It will be hidden from the Task Board and dashboards. Its history is kept and a manager can restore it." confirmLabel="Archive task" hidden={{ id: task.id, archive: '1' }} />
            )}
          </div>
        )}
      </div>

      {task.status === 'Blocked' && (
        <div className="mb-5 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3" role="note">
          <div className="text-xs font-semibold uppercase tracking-wide text-orange-800">
            Blocked{task.blocked_at && <> since <LocalTime iso={task.blocked_at} /></>}
          </div>
          <p className="mt-1 whitespace-pre-wrap font-medium text-orange-900">{task.blocker_reason || 'No reason recorded'}</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <dl className="card grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm sm:grid-cols-3">
            {[
              ['Assigned To', task.owner_name],
              ['Delegated By', task.assigned_by_name],
              ['Entered By', task.created_by_name],
              ['Start Date', fmtDate(task.start_date)],
              ['Due Date', fmtDate(task.due_date)],
              ['Days Left', daysLeftLabel(task.days_left)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="label">{k}</dt>
                <dd className="text-navy-900">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="label">% Complete</dt>
              <dd><ProgressBar value={task.percent_complete} /></dd>
            </div>
            <div>
              <dt className="label">Last Update</dt>
              <dd><LocalTime iso={task.last_update_at} />{task.is_stale && <span className="ml-1 text-xs font-semibold text-amber-700">· stale</span>}</dd>
            </div>
            <div>
              <dt className="label">Created</dt>
              <dd><LocalTime iso={task.created_at} /></dd>
            </div>
            {backlog?.data && (
              <div>
                <dt className="label">From backlog</dt>
                <dd><Link href={`/backlog/${backlog.data.id}`} className="text-navy-700 underline">{backlog.data.backlog_code}</Link></dd>
              </div>
            )}
            <div className="col-span-2 sm:col-span-3">
              <dt className="label">Description</dt>
              <dd className="whitespace-pre-wrap text-slate-700">{task.details || '—'}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="label">Progress Note</dt>
              <dd className="text-slate-700">{task.progress_note || '—'}</dd>
            </div>
          </dl>

          {canProgress && !task.archived_at && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold text-navy-900">Update progress</h2>
              <ActionForm action={updateProgressAction} className="space-y-4">
                <input type="hidden" name="id" value={task.id} />
                <ProgressFields task={task} />
                <div className="flex justify-end"><SubmitButton>Save progress</SubmitButton></div>
              </ActionForm>
            </section>
          )}

          {canEdit && !task.archived_at && (
            <details className="card p-5">
              <summary className="cursor-pointer font-semibold text-navy-900">Edit task, reassign or change who delegated it</summary>
              <ActionForm action={updateTaskAction} className="mt-4 space-y-4">
                <input type="hidden" name="id" value={task.id} />
                <CoreFields task={task} members={members} />
                <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
              </ActionForm>
            </details>
          )}
          {!canProgress && <Notice>You can view this task but not change it.</Notice>}
        </div>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-2 font-semibold text-navy-900">Collaborators</h2>
            {collabIds.length === 0 && <p className="text-sm text-slate-500">None. Collaborators can see and update progress.</p>}
            <ul className="space-y-1.5">
              {collabIds.map((cid) => (
                <li key={cid} className="flex items-center justify-between text-sm">
                  <span>{nameOf(cid)}</span>
                  {canEdit && (
                    <ConfirmAction action={removeCollaboratorAction} label="Remove" title={`Remove ${nameOf(cid)}?`} body="They will no longer see this task unless it is assigned to them, they entered it or they delegated it." confirmLabel="Remove" className="btn-ghost px-2 py-1 text-xs text-red-700" hidden={{ task_id: task.id, member_id: cid }} />
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <ActionForm action={addCollaboratorAction} className="mt-3 flex gap-2" resetOnSuccess>
                <input type="hidden" name="task_id" value={task.id} />
                <select name="member_id" className="input" defaultValue="" aria-label="Add collaborator">
                  <option value="" disabled>Add person…</option>
                  {members.filter((m) => !collabIds.includes(m.id) && m.id !== task.owner_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <SubmitButton className="btn-secondary" pendingText="…">Add</SubmitButton>
              </ActionForm>
            )}
          </section>

          <section className="card p-5">
            <SectionTitle>History</SectionTitle>
            {activityError && <p className="text-sm text-red-700">Could not load the history.</p>}
            {history.length === 0 && !activityError && <p className="text-sm text-slate-500">No changes recorded yet.</p>}
            <ol className="space-y-3">
              {history.map((h, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[h.kind] ?? 'bg-slate-300'}`} aria-hidden />
                  <div>
                    <div className="text-slate-800">{h.summary}</div>
                    <div className="text-xs text-slate-500">{h.actor_name ?? 'System'} · <LocalTime iso={h.at} /></div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
