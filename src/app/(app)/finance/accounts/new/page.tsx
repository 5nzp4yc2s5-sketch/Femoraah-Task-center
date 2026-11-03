import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { todayIn } from '@/lib/finance';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { saveAccountAction } from '../../actions';
import { AccountFields } from '../../fields';

export const metadata = { title: 'Add a bank account' };

export default async function NewAccount() {
  const me = await requireFinance();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add a bank account" subtitle="Enter the balance shown in your bank today. Never enter passwords, OTPs or full account numbers." />
      <ActionForm action={saveAccountAction} className="card space-y-5 p-5">
        <AccountFields today={todayIn(me.timezone)} />
        <div className="flex justify-end gap-2">
          <Link href="/finance/accounts" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add account</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
