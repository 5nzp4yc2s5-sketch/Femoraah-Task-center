import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/finance';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { loadAccounts } from '../../data';
import { saveReceivableAction } from '../../actions';
import { ReceivableFields } from '../../fields';

export const metadata = { title: 'Add money expected' };

export default async function NewReceivable() {
  const me = await requireFinance();
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add money expected" subtitle="A customer payment or marketplace settlement you are waiting for." />
      <ActionForm action={saveReceivableAction} className="card space-y-5 p-5">
        <ReceivableFields accounts={accounts} today={todayIn(me.timezone)} />
        <div className="flex justify-end gap-2">
          <Link href="/finance/receivables" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add money expected</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
