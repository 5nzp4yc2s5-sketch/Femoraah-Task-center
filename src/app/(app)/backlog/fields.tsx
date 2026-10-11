import { PRIORITIES, type BacklogRow } from '@/lib/types';

export function BacklogFields({ item }: { item?: Partial<BacklogRow> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="title">Task</label>
        <input id="title" name="title" className="input" defaultValue={item?.title} required maxLength={200} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="details">Details</label>
        <textarea id="details" name="details" rows={3} className="input" defaultValue={item?.details} maxLength={5000} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="skills_needed">Skills Needed</label>
        <input id="skills_needed" name="skills_needed" className="input" defaultValue={item?.skills_needed} required maxLength={500} placeholder="e.g. packing count, dispatch, Myntra tickets" />
        <p className="mt-1 text-xs text-slate-500">Separate skills with commas. They are matched against each person&apos;s Expertise on the Team page.</p>
      </div>
      <div>
        <label className="label" htmlFor="priority">Priority</label>
        <select id="priority" name="priority" className="input" defaultValue={item?.priority ?? 'Medium'}>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="due_date">Due Date</label>
        <input id="due_date" name="due_date" type="date" className="input" defaultValue={item?.due_date} required />
      </div>
    </div>
  );
}
