import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { createMemberAction } from '../actions';
import { LoginFields, MemberFields } from '../fields';

export const metadata = { title: 'Add member' };

export default async function NewMember() {
  await requireAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add team member" />
      <ActionForm action={createMemberAction} className="card space-y-6 p-5">
        <MemberFields />
        <fieldset className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">Login (optional now, can be added later)</legend>
          <LoginFields optional />
        </fieldset>
        <div className="flex justify-end gap-2">
          <Link href="/team" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add member</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
