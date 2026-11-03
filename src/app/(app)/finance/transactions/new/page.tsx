import Link from 'next/link';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/finance';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EmptyState, PageHeader } from '@/components/ui';
import { loadAccounts } from '../../data';
import { saveTxnAction } from '../../actions';
import { TxnFields } from '../../fields';

export const metadata = { title: 'Add a transaction' };

export default async function NewTxn({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const sp = await searchParams;
  const me = await requireFinance();
  const supabase = await createClient();
  const accounts = await loadAccounts(supabase);
  if (accounts.length === 0) {
    return <EmptyState title="Add a bank account first" body="Every transaction belongs to a bank account." action={<Link href="/finance/accounts/new" className="btn-primary">Add a bank account</Link>} />;
  }
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Add a transaction"
        subtitle="For money that already moved, like bank charges or a receipt you were not expecting. To pay a payment due, open it and record the payment there, so it is marked paid."
      />
      <ActionForm action={saveTxnAction} className="card space-y-5 p-5">
        <TxnFields accounts={accounts} today={todayIn(me.timezone)} timeZone={me.timezone} defaultAccount={accounts.some((a) => a.id === sp.account) ? sp.account : accounts.length === 1 ? accounts[0].id : undefined} />
        <div className="flex justify-end gap-2">
          <Link href="/finance/transactions" className="btn-secondary">Cancel</Link>
          <SubmitButton>Add transaction</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
