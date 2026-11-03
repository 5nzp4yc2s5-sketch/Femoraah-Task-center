import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { RECURRENCES, localParts, payableStatus, todayIn, type FinPayable } from '@/lib/finance';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/forms';
import { Notice, PageHeader, SectionTitle } from '@/components/ui';
import { memberNames } from '../../../attendance/data';
import { loadAccounts, loadEvents, loadTxns } from '../../data';
import { payPayableAction, reschedulePayableAction, savePayableAction, setPayableStateAction } from '../../actions';
import { PayableFields, SettleFields } from '../../fields';
import { BackLink, Fact, Field, History, Money, PriorityTag, ToneBadge, accountName, categoryName } from '../../parts';

export const metadata = { title: 'Payment due' };

const UUID = /^[0-9a-f-]{36}$/i;
const PAY_COLS = 'id, title, payee, amount_paise, paid_paise, due_date, original_due_date, category, account_id, priority, state, recurrence, series_id, loan_id, emi_no, penalty, notes, state_reason, postpone_reason, updated_at';

export default async function PayablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const me = await requireFinance();
  const tz = me.timezone;
  const supabase = await createClient();
  const { data } = await supabase.from('fin_payables').select(PAY_COLS).eq('id', id).maybeSingle();
  if (!data) notFound();
  const p = { ...data, amount_paise: Number(data.amount_paise), paid_paise: Number(data.paid_paise) } as FinPayable;
  const [accounts, payments, events, names, loan, series] = await Promise.all([
    loadAccounts(supabase, true),
    loadTxns(supabase, { payableId: id, includeVoided: true }),
    loadEvents(supabase, id),
    memberNames(supabase),
    p.loan_id ? supabase.from('fin_loans').select('id, name, tenure_months').eq('id', p.loan_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    p.recurrence !== 'none' && !p.loan_id
      ? supabase.from('fin_payables').select('id, due_date, state').eq('series_id', p.series_id).neq('id', id).order('original_due_date', { ascending: false }).limit(6).then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);
  const today = todayIn(tz);
  const s = payableStatus(p, today);
  const left = p.amount_paise - p.paid_paise;
  const open = p.state === 'open' || p.state === 'scheduled' || p.state === 'on_hold';
  const inUse = accounts.filter((a) => !a.archived_at);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="max-w-4xl">
      <BackLink href="/finance/payables">Payments due</BackLink>
      <PageHeader
        title={p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ToneBadge tone={s.tone}>{s.label}</ToneBadge>
            <PriorityTag priority={p.priority} />
            {p.payee && <span>to {p.payee}</span>}
          </span>
        }
      />
      {sp.added && <Notice>Payment due added. It is now in the forecast.</Notice>}
      {p.state === 'on_hold' && <Notice tone="warn">On hold{p.state_reason ? `: ${p.state_reason}` : ''}. It is left out of the forecast until you resume it.</Notice>}
      {p.state === 'cancelled' && <Notice tone="warn">Cancelled{p.state_reason ? `: ${p.state_reason}` : ''}.</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="card p-4">
          <Fact label="Amount"><Money paise={p.amount_paise} /></Fact>
          <Fact label="Paid so far"><Money paise={p.paid_paise} /></Fact>
          <Fact label="Still to pay"><Money paise={open ? left : 0} className="text-lg" /></Fact>
          <Fact label="Due">
            {fmtDate(p.due_date)}
            {p.due_date !== p.original_due_date && <span className="block text-xs font-normal text-slate-500">Originally {fmtDate(p.original_due_date)}{p.postpone_reason ? `. Moved because: ${p.postpone_reason}` : ''}</span>}
          </Fact>
          <Fact label="Category">{categoryName(p.category)}</Fact>
          <Fact label="Pay from">{p.account_id ? accountName(byId.get(p.account_id)) : 'Not decided'}</Fact>
          {p.recurrence !== 'none' && <Fact label="Repeats">{RECURRENCES.find((r) => r.key === p.recurrence)?.label}</Fact>}
          {loan && <Fact label="Loan"><Link href={`/finance/loans/${loan.id}`} className="text-navy-700 hover:underline">{loan.name}</Link>{p.emi_no ? `, EMI ${p.emi_no} of ${loan.tenure_months}` : ''}</Fact>}
          {p.penalty && <Fact label="Penalty or terms"><span className="font-normal">{p.penalty}</span></Fact>}
          {p.notes && <Fact label="Notes"><span className="whitespace-pre-line font-normal">{p.notes}</span></Fact>}
        </dl>

        {open && p.state !== 'on_hold' && (
          <ActionForm action={payPayableAction} className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-navy-900">Record a payment you made</h2>
            <p className="text-xs text-slate-600">Only after the money has left your account. This adds the bank transaction too.</p>
            <SettleFields kind="pay" id={id} left={left} accountId={p.account_id} accounts={inUse} today={today} />
            <div className="flex justify-end"><SubmitButton>Record payment</SubmitButton></div>
          </ActionForm>
        )}
      </div>

      {open && (
        <>
          <SectionTitle>Change the plan</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm action={reschedulePayableAction} className="card space-y-3 p-4">
              <h3 className="text-sm font-semibold text-navy-900">Change the due date</h3>
              <input type="hidden" name="id" value={id} />
              <Field label="New due date" htmlFor="re-due">
                <input id="re-due" name="due" type="date" className="input" required defaultValue={p.due_date} />
              </Field>
              <Field label="Reason" htmlFor="re-reason" hint="Needed when you move it later.">
                <input id="re-reason" name="reason" className="input" maxLength={300} placeholder="Agreed with vendor to pay on the 20th" />
              </Field>
              <div className="flex justify-end"><SubmitButton>Change date</SubmitButton></div>
            </ActionForm>
            <div className="card space-y-3 p-4">
              <h3 className="text-sm font-semibold text-navy-900">Status</h3>
              <p className="text-xs text-slate-600">To pay part now and the rest later, record the part payment, then change the due date for the rest.</p>
              <div className="flex flex-wrap gap-2">
                {p.state === 'open' && (
                  <ConfirmAction action={setPayableStateAction} hidden={{ id, state: 'scheduled' }} withNote label="Mark as scheduled" title="Mark as scheduled?" body="Use this when the payment is set up in the bank but has not gone yet. It still counts on its due date." confirmLabel="Mark scheduled" className="btn-secondary" />
                )}
                {p.state !== 'open' && (
                  <ConfirmAction action={setPayableStateAction} hidden={{ id, state: 'open' }} label={p.state === 'on_hold' ? 'Resume' : 'Not scheduled any more'} title={p.state === 'on_hold' ? 'Resume this payment?' : 'Mark as not scheduled?'} body="It counts in the forecast on its due date again." confirmLabel="Yes" className="btn-secondary" />
                )}
                {p.state !== 'on_hold' && (
                  <ConfirmAction action={setPayableStateAction} hidden={{ id, state: 'on_hold' }} withNote noteRequired label="Put on hold" title="Put this payment on hold?" body="It is left out of the forecast until you resume it. Say why, so others know." confirmLabel="Put on hold" className="btn-secondary" />
                )}
                {p.paid_paise === 0 && (
                  <ConfirmAction action={setPayableStateAction} hidden={{ id, state: 'cancelled' }} withNote noteRequired label="Cancel payment" title="Cancel this payment?" body={p.recurrence !== 'none' ? 'It is no longer owed. The next one in the series is still planned. Say why.' : 'It is no longer owed. Say why. It stays in the history.'} confirmLabel="Cancel payment" />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <SectionTitle>Payments made</SectionTitle>
      {payments.length === 0 ? (
        <p className="card p-4 text-sm text-slate-600">Nothing paid yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead><tr><th>Paid on</th><th>From</th><th>Reference</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>
              {payments.map((t) => (
                <tr key={t.id} className={t.voided_at ? 'text-slate-400 line-through' : ''}>
                  <td className="whitespace-nowrap text-sm">{fmtDate(localParts(t.txn_at, tz).date)}</td>
                  <td className="text-sm">{accountName(byId.get(t.account_id))}</td>
                  <td className="font-mono text-xs">{t.reference_no}</td>
                  <td className="text-right"><Money paise={t.amount_paise} /></td>
                  <td className="text-right text-sm"><Link href={`/finance/transactions/${t.id}`} className="text-navy-700 no-underline hover:underline">{t.voided_at ? 'Undone' : 'Open'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {series.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Other payments in this series:{' '}
          {series.map((o, i) => (
            <span key={o.id}>{i > 0 && ', '}<Link href={`/finance/payables/${o.id}`} className="text-navy-700 hover:underline">{fmtDate(o.due_date)}</Link></span>
          ))}
        </p>
      )}

      {open && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-navy-800">Edit details</summary>
          <ActionForm action={savePayableAction} className="card mt-2 space-y-4 p-4">
            <PayableFields payable={p} accounts={accounts.filter((a) => !a.archived_at || a.id === p.account_id)} today={today} />
            <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
          </ActionForm>
        </details>
      )}

      <SectionTitle>History</SectionTitle>
      <div className="card p-4"><History events={events} names={names} timeZone={tz} /></div>
    </div>
  );
}
