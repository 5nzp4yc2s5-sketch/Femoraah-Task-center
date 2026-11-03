import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { RECEIVABLE_SOURCES, localParts, receivableStatus, todayIn, type FinReceivable } from '@/lib/finance';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { memberNames } from '../../../attendance/data';
import { loadAccounts, loadEvents, loadTxns } from '../../data';
import { receiveAction, rescheduleReceivableAction, saveReceivableAction, setReceivableStateAction } from '../../actions';
import { ReceivableFields, SettleFields } from '../../fields';
import { BackLink, Fact, Field, History, Money, ToneBadge, accountName, categoryName } from '../../parts';

export const metadata = { title: 'Money expected' };

const UUID = /^[0-9a-f-]{36}$/i;
const REC_COLS = 'id, party, source, reference_no, category, amount_paise, received_paise, expected_date, original_expected_date, account_id, state, notes, state_reason, delay_reason, updated_at';

export default async function ReceivablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const me = await requireFinance();
  const tz = me.timezone;
  const supabase = await createClient();
  const { data } = await supabase.from('fin_receivables').select(REC_COLS).eq('id', id).maybeSingle();
  if (!data) notFound();
  const r = { ...data, amount_paise: Number(data.amount_paise), received_paise: Number(data.received_paise) } as FinReceivable;
  const [accounts, receipts, events, names] = await Promise.all([loadAccounts(supabase, true), loadTxns(supabase, { receivableId: id, includeVoided: true }), loadEvents(supabase, id), memberNames(supabase)]);
  const today = todayIn(tz);
  const s = receivableStatus(r, today);
  const left = r.amount_paise - r.received_paise;
  const open = r.state === 'open' || r.state === 'disputed';
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const inUse = accounts.filter((a) => !a.archived_at);

  return (
    <div className="max-w-4xl">
      <BackLink href="/finance/receivables">Money coming in</BackLink>
      <PageHeader title={r.party} subtitle={<span className="flex flex-wrap items-center gap-2"><ToneBadge tone={s.tone}>{s.label}</ToneBadge>{RECEIVABLE_SOURCES.find((x) => x.key === r.source)?.label}</span>} />
      {sp.added && <Notice>Added. It is now in the forecast on its expected date.</Notice>}
      {r.state === 'disputed' && <Notice tone="warn">Disputed{r.state_reason ? `: ${r.state_reason}` : ''}. It is left out of the forecast.</Notice>}
      {s.key === 'overdue' && r.state === 'open' && <Notice tone="warn">This is late and is left out of the forecast. Record it when it arrives, or give it a new expected date.</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="card p-4">
          <Fact label="Expected amount"><Money paise={r.amount_paise} /></Fact>
          <Fact label="Received so far"><Money paise={r.received_paise} /></Fact>
          <Fact label="Still to come"><Money paise={open ? left : 0} className="text-lg" /></Fact>
          <Fact label="Expected on">
            {fmtDate(r.expected_date)}
            {r.expected_date !== r.original_expected_date && <span className="block text-xs font-normal text-slate-500">Originally {fmtDate(r.original_expected_date)}{r.delay_reason ? `. Delayed because: ${r.delay_reason}` : ''}</span>}
          </Fact>
          <Fact label="Category">{categoryName(r.category)}</Fact>
          {r.reference_no && <Fact label="Invoice or reference"><span className="font-mono">{r.reference_no}</span></Fact>}
          <Fact label="Comes into">{r.account_id ? accountName(byId.get(r.account_id)) : 'Not known'}</Fact>
          {r.notes && <Fact label="Notes"><span className="whitespace-pre-line font-normal">{r.notes}</span></Fact>}
          {(r.state === 'written_off' || r.state === 'cancelled') && r.state_reason && <Fact label="Reason"><span className="font-normal">{r.state_reason}</span></Fact>}
        </dl>

        {open && (
          <ActionForm action={receiveAction} className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-navy-900">Record money received</h2>
            <p className="text-xs text-slate-600">Only once it shows in your account. This adds the bank transaction too.</p>
            <SettleFields kind="receive" id={id} left={left} accountId={r.account_id} accounts={inUse} today={today} />
            <div className="flex justify-end"><SubmitButton>Record receipt</SubmitButton></div>
          </ActionForm>
        )}
      </div>

      {open && (
        <>
          <SectionTitle>Change the plan</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm action={rescheduleReceivableAction} className="card space-y-3 p-4">
              <h3 className="text-sm font-semibold text-navy-900">Change the expected date</h3>
              <input type="hidden" name="id" value={id} />
              <Field label="New expected date" htmlFor="re-exp">
                <input id="re-exp" name="expected" type="date" className="input" required defaultValue={r.expected_date < today ? today : r.expected_date} />
              </Field>
              <Field label="Reason" htmlFor="re-reason">
                <input id="re-reason" name="reason" className="input" maxLength={300} placeholder="Customer asked for 15 more days" />
              </Field>
              <div className="flex justify-end"><SubmitButton>Change date</SubmitButton></div>
            </ActionForm>
            <div className="card space-y-3 p-4">
              <h3 className="text-sm font-semibold text-navy-900">Status</h3>
              <div className="flex flex-wrap gap-2">
                {r.state === 'disputed' ? (
                  <ConfirmAction action={setReceivableStateAction} hidden={{ id, state: 'open' }} label="Dispute settled" title="Mark the dispute as settled?" body="It counts in the forecast on its expected date again." confirmLabel="Settled" className="btn-secondary" />
                ) : (
                  <ConfirmAction action={setReceivableStateAction} hidden={{ id, state: 'disputed' }} withNote noteRequired label="Mark as disputed" title="Mark as disputed?" body="It is left out of the forecast until the dispute is settled. Say what is disputed." confirmLabel="Mark disputed" className="btn-secondary" />
                )}
                {r.received_paise > 0 ? (
                  <ConfirmAction action={setReceivableStateAction} hidden={{ id, state: 'written_off' }} withNote noteRequired label="Write off the rest" title="Write off what has not arrived?" body="The rest is no longer expected. Say why." confirmLabel="Write off" />
                ) : (
                  <>
                    <ConfirmAction action={setReceivableStateAction} hidden={{ id, state: 'written_off' }} withNote noteRequired label="Write off" title="Write this off?" body="The money is no longer expected, e.g. a bad debt. Say why." confirmLabel="Write off" />
                    <ConfirmAction action={setReceivableStateAction} hidden={{ id, state: 'cancelled' }} withNote noteRequired label="Cancel" title="Cancel this?" body="Use this when it was entered by mistake or the order was cancelled. Say why." confirmLabel="Cancel it" />
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <SectionTitle>Money received</SectionTitle>
      {receipts.length === 0 ? (
        <p className="card p-4 text-sm text-slate-600">Nothing received yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead><tr><th>Received on</th><th>Into</th><th>Reference</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>
              {receipts.map((t) => (
                <tr key={t.id} className={t.voided_at ? 'text-slate-400 line-through' : ''}>
                  <td className="whitespace-nowrap text-sm">{fmtDate(localParts(t.txn_at, tz).date)}</td>
                  <td className="text-sm">{accountName(byId.get(t.account_id))}</td>
                  <td className="font-mono text-xs">{t.reference_no}</td>
                  <td className="text-right"><Money paise={t.amount_paise} /></td>
                  <td className="text-right text-sm"><Link href={`/finance/transactions/${t.id}`} className="text-navy-700 hover:underline">{t.voided_at ? 'Undone' : 'Open'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-navy-800">Edit details</summary>
          <ActionForm action={saveReceivableAction} className="card mt-2 space-y-4 p-4">
            <ReceivableFields receivable={r} accounts={accounts.filter((a) => !a.archived_at || a.id === r.account_id)} today={today} />
            <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
          </ActionForm>
        </details>
      )}

      <SectionTitle>History</SectionTitle>
      <div className="card p-4"><History events={events} names={names} timeZone={tz} /></div>
    </div>
  );
}
