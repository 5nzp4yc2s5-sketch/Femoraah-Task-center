import Link from 'next/link';
import { requireManager } from '@/lib/session';
import { activeMembers } from '@/lib/data';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { createRoutineAction } from '../actions';
import { RoutineFields } from '../fields';

export const metadata = { title: 'New routine' };

export default async function NewRoutine() {
  await requireManager();
  const members = await activeMembers();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New routine task" />
      <ActionForm action={createRoutineAction} className="card space-y-5 p-5">
        <RoutineFields members={members} />
        <div className="flex justify-end gap-2">
          <Link href="/routines" className="btn-secondary">Cancel</Link>
          <SubmitButton>Create routine</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
