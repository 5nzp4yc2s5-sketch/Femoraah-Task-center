import type { MemberOption, TaskRow } from '@/lib/types';
import { PRIORITIES, STATUSES } from '@/lib/types';

export function CoreFields({ task, members, disabled = false }: { task?: Partial<TaskRow>; members: MemberOption[]; disabled?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="title">Task</label>
        <input id="title" name="title" className="input" defaultValue={task?.title} required maxLength={200} disabled={disabled} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="details">Details</label>
        <textarea id="details" name="details" className="input" rows={3} defaultValue={task?.details} maxLength={5000} disabled={disabled} />
      </div>
      <div>
        <label className="label" htmlFor="owner_id">Owner</label>
        <select id="owner_id" name="owner_id" className="input" defaultValue={task?.owner_id ?? ''} required disabled={disabled}>
          <option value="" disabled>Choose…</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          {task?.owner_id && !members.some((m) => m.id === task.owner_id) && <option value={task.owner_id}>{task.owner_name} (inactive)</option>}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="priority">Priority</label>
        <select id="priority" name="priority" className="input" defaultValue={task?.priority ?? 'Medium'} disabled={disabled}>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="status">Status</label>
        <select id="status" name="status" className="input" defaultValue={task?.status ?? 'Not Started'}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="percent_complete">% Complete</label>
        <div className="relative">
          <input id="percent_complete" name="percent_complete" type="number" min={0} max={100} step={5} className="input pr-8" defaultValue={task?.percent_complete ?? 0} required />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">%</span>
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="progress_note">Progress Note / Blocker</label>
        <input id="progress_note" name="progress_note" className="input" defaultValue={task?.progress_note ?? ''} maxLength={1000} placeholder="One line on what changed, or what is blocking you" />
      </div>
    </div>
  );
}
