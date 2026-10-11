import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { activeMembers } from '@/lib/data';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { createTaskAction } from '../actions';
import { CoreFields, ProgressFields } from '../task-fields';

export const metadata = { title: 'New task' };

export default async function NewTask() {
  const me = await requireMe();
  const members = await activeMembers();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New task" subtitle={`Assigned work goes on the Task Board. You (${me.name}) will be recorded as Assigned By and can track it.`} />
      <ActionForm action={createTaskAction} className="card space-y-6 p-5">
        <CoreFields members={members} task={{ owner_id: me.memberId }} />
        <ProgressFields />
        <fieldset>
          <legend className="label">Collaborators (optional)</legend>
          <p className="mb-2 text-xs text-slate-500">Collaborators can see this task and update its progress.</p>
          <div className="flex flex-wrap gap-3">
            {members.filter((m) => m.id !== me.memberId).map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="collaborators" value={m.id} /> {m.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Link href="/tasks" className="btn-secondary">Cancel</Link>
          <SubmitButton>Create task</SubmitButton>
        </div>
      </ActionForm>
      <p className="mt-3 text-sm text-slate-600">Work that has no owner yet? <Link href="/backlog/new" className="text-navy-700 underline">Add it to the Pending Backlog</Link> instead.</p>
    </div>
  );
}
