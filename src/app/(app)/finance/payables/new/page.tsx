import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/finance';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { loadAccounts } from '../../data';
import { savePayableAction } from '../../actions';
import { PayableFields } from '../../fields';

export const metadata = { title: 'Add a payment due' };

export default async function NewPayable() {
  const me = await requireFinance();
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add a payment due" subtitle="Something the business has to pay. For a loan EMI, add the loan under Loans & EMIs instead, so every EMI is planned once." />
      <ActionForm action={savePayableAction} className="card space-y-5 p-5">
        <PayableFields accounts={accounts} today={todayIn(me.timezone)} />
        <div className="flex justify-end gap-2">
          <Link href="/finance/payables" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add payment due</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
