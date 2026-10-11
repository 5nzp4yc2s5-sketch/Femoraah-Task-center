'use client';

import { useState } from 'react';
import type { MemberOption, TaskRow, TaskStatus } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';

function MemberSelect({
  id,
  label,
  value,
  fallbackName,
  members,
  disabled,
}: {
  id: 'owner_id' | 'assigned_by';
  label: string;
  value?: string;
  fallbackName?: string | null;
  members: MemberOption[];
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} name={id} className="input" defaultValue={value ?? ''} required disabled={disabled}>
        <option value="" disabled>Choose…</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        {value && !members.some((m) => m.id === value) && <option value={value}>{fallbackName ?? 'Former member'} (inactive)</option>}
      </select>
    </div>
  );
}

export function CoreFields({ task, members, disabled = false }: { task?: Partial<TaskRow>; members: MemberOption[]; disabled?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="title">Task</label>
        <input id="title" name="title" className="input" defaultValue={task?.title} required maxLength={200} disabled={disabled} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="details">Description</label>
        <textarea id="details" name="details" className="input" rows={3} defaultValue={task?.details} maxLength={5000} disabled={disabled} />
      </div>
      <MemberSelect id="assigned_by" label="Delegated by" value={task?.assigned_by} fallbackName={task?.assigned_by_name} members={members} disabled={disabled} />
      <MemberSelect id="owner_id" label="Assigned to" value={task?.owner_id} fallbackName={task?.owner_name} members={members} disabled={disabled} />
      <div>
        <label className="label" htmlFor="priority">Priority</label>
        <select id="priority" name="priority" className="input" defaultValue={task?.priority ?? 'Medium'} disabled={disabled}>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div className="flex items-end">
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" name="is_flagged" value="1" defaultChecked={task?.is_flagged ?? false} disabled={disabled} />
          Flag as important <span className="text-amber-500" aria-hidden>★</span>
        </label>
      </div>
      <div>
        <label className="label" htmlFor="start_date">Start Date</label>
        <input id="start_date" name="start_date" type="date" className="input" defaultValue={task?.start_date ?? ''} disabled={disabled} />
      </div>
      <div>
        <label className="label" htmlFor="due_date">Due Date</label>
        <input id="due_date" name="due_date" type="date" className="input" defaultValue={task?.due_date ?? ''} disabled={disabled} />
      </div>
    </div>
  );
}

export function ProgressFields({ task }: { task?: Partial<TaskRow> }) {
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'To Do');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="status">Status</label>
        <select id="status" name="status" className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="percent_complete">% Complete</label>
        <div className="relative">
          <input id="percent_complete" name="percent_complete" type="number" min={0} max={100} step={5} className="input pr-8" defaultValue={task?.percent_complete ?? 0} required />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">%</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">100% marks the task Done.</p>
      </div>
      {status === 'Blocked' && (
        <div className="sm:col-span-2">
          <label className="label" htmlFor="blocker_reason">Blocker reason <span className="text-orange-700">(required)</span></label>
          <input
            id="blocker_reason"
            name="blocker_reason"
            className="input border-orange-300"
            defaultValue={task?.blocker_reason ?? ''}
            maxLength={1000}
            required
            placeholder="What is stopping this task, and who or what you are waiting on"
          />
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="label" htmlFor="progress_note">Progress Note</label>
        <input id="progress_note" name="progress_note" className="input" defaultValue={task?.progress_note ?? ''} maxLength={1000} placeholder="One line on what changed" />
      </div>
    </div>
  );
}
