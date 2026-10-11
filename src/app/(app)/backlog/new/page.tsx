import Link from 'next/link';
import { requireMe } from '@/lib/session';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { createBacklogAction } from '../actions';
import { BacklogFields } from '../fields';

export const metadata = { title: 'Add to backlog' };

export default async function NewBacklog() {
  await requireMe();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add to Pending Backlog" subtitle="For work nobody owns yet. The app suggests someone by rules (skills, workload, overdue, blocked, availability); a manager approves the assignment." />
      <ActionForm action={createBacklogAction} className="card space-y-5 p-5">
        <BacklogFields />
        <div className="flex justify-end gap-2">
          <Link href="/backlog" className="btn-secondary">Cancel</Link>
          <SubmitButton>Submit to backlog</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
