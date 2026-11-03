import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/finance';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { loadAccounts } from '../../data';
import { saveLoanAction } from '../../actions';
import { LoanFields } from '../../fields';

export const metadata = { title: 'Add a loan' };

export default async function NewLoan() {
  const me = await requireFinance();
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add a loan" subtitle="Its EMIs are added to Payments due as critical, 90 days ahead. Enter how many EMIs were already paid so they are not added again." />
      <ActionForm action={saveLoanAction} className="card space-y-5 p-5">
        <LoanFields accounts={accounts} today={todayIn(me.timezone)} />
        <div className="flex justify-end gap-2">
          <Link href="/finance/loans" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add loan</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
