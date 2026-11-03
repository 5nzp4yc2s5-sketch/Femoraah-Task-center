import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { localParts, todayIn, type FinTxn } from '@/lib/finance';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { memberNames } from '../../../attendance/data';
import { loadAccounts, loadEvents } from '../../data';
import { saveTxnAction, voidTxnAction } from '../../actions';
import { TxnFields } from '../../fields';
import { BackLink, Fact, History, Money, accountName, categoryName } from '../../parts';

export const metadata = { title: 'Transaction' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function TxnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const me = await requireFinance();
  const tz = me.timezone;
  const supabase = await createClient();
  const { data } = await supabase
    .from('fin_transactions')
    .select('id, account_id, txn_at, direction, amount_paise, category, counterparty, description, reference_no, source, review_status, payable_id, receivable_id, voided_at, void_reason, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();
  const t = { ...data, amount_paise: Number(data.amount_paise) } as FinTxn;
  const [accounts, events, names, linked] = await Promise.all([
    loadAccounts(supabase, true),
    loadEvents(supabase, id),
    memberNames(supabase),
    t.payable_id
      ? supabase.from('fin_payables').select('id, title').eq('id', t.payable_id).maybeSingle().then((r) => r.data as { id: string; title: string } | null)
      : t.receivable_id
        ? supabase.from('fin_receivables').select('id, party').eq('id', t.receivable_id).maybeSingle().then((r) => (r.data ? { id: r.data.id as string, title: r.data.party as string } : null))
        : Promise.resolve(null),
  ]);
  const account = accounts.find((a) => a.id === t.account_id);
  const when = localParts(t.txn_at, tz);
  const inUse = accounts.filter((a) => !a.archived_at || a.id === t.account_id);

  return (
    <div className="max-w-3xl">
      <BackLink href="/finance/transactions">Transactions</BackLink>
      <PageHeader title={t.counterparty || t.description || 'Transaction'} subtitle={`${t.direction === 'in' ? 'Money in' : 'Money out'} · ${fmtDate(when.date)} ${when.time}`} />
      {t.voided_at && <Notice tone="warn">This transaction was undone{t.void_reason ? `: ${t.void_reason}` : ''}. It no longer counts in balances.</Notice>}
      {t.review_status === 'needs_review' && !t.voided_at && <Notice tone="warn">This was read from a bank email and needs checking. Edit and save it to confirm.</Notice>}

      <dl className="card p-4">
        <Fact label="Amount"><Money paise={t.direction === 'in' ? t.amount_paise : -t.amount_paise} signed plain className={t.direction === 'in' ? 'text-lg text-green-700' : 'text-lg'} /></Fact>
        <Fact label="Account">{accountName(account)}</Fact>
        <Fact label="Category">{categoryName(t.category)}</Fact>
        {t.reference_no && <Fact label="Reference"><span className="font-mono">{t.reference_no}</span></Fact>}
        {t.description && <Fact label="Description"><span className="whitespace-pre-line font-normal">{t.description}</span></Fact>}
        <Fact label="Entered">{t.source === 'gmail' ? 'From a bank email' : t.source === 'statement' ? 'From a statement' : 'By hand'}</Fact>
        {linked && (
          <Fact label={t.payable_id ? 'Pays' : 'Receives'}>
            <Link href={t.payable_id ? `/finance/payables/${linked.id}` : `/finance/receivables/${linked.id}`} className="text-navy-700 hover:underline">{linked.title}</Link>
          </Fact>
        )}
      </dl>

      {!t.voided_at && (
        <>
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold text-navy-800">Edit transaction</summary>
            <ActionForm action={saveTxnAction} className="card mt-2 space-y-4 p-4">
              <TxnFields txn={t} accounts={inUse} today={todayIn(tz)} timeZone={tz} />
              <div className="flex justify-end"><SubmitButton>Save transaction</SubmitButton></div>
            </ActionForm>
          </details>
          <div className="mt-6 flex justify-end">
            <ConfirmAction
              action={voidTxnAction}
              hidden={{ id }}
              withNote
              label="Undo this transaction"
              title="Undo this transaction?"
              body={linked ? `It stops counting in balances, and ${linked.title} goes back to not paid by this amount. It stays in the history, crossed out.` : 'It stops counting in balances. It stays in the history, crossed out.'}
              confirmLabel="Undo it"
            />
          </div>
        </>
      )}

      <SectionTitle>History</SectionTitle>
      <div className="card p-4"><History events={events} names={names} timeZone={tz} /></div>
    </div>
  );
}
