import {
  ACCOUNT_KINDS,
  IN_CATEGORIES,
  OUT_CATEGORIES,
  PAYABLE_CATEGORIES,
  PRIORITIES,
  RECEIVABLE_SOURCES,
  RECURRENCES,
  TRANSFER,
  localParts,
  rupeesField,
  type FinAccount,
  type FinLoan,
  type FinPayable,
  type FinReceivable,
  type FinTxn,
} from '@/lib/finance';
import { AccountOptions, Field, RupeeInput } from './parts';

export function AccountFields({ account, today }: { account?: FinAccount; today: string }) {
  const id = (f: string) => `acc-${f}`;
  return (
    <div className="space-y-4">
      {account && <input type="hidden" name="id" value={account.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" htmlFor={id('name')}>
          <input id={id('name')} name="name" className="input" required maxLength={80} defaultValue={account?.name} placeholder="HDFC Current" />
        </Field>
        <Field label="Bank" htmlFor={id('bank')}>
          <input id={id('bank')} name="bank" className="input" maxLength={80} defaultValue={account?.bank} placeholder="HDFC Bank" />
        </Field>
        <Field label="Type" htmlFor={id('kind')}>
          <select id={id('kind')} name="kind" className="input" defaultValue={account?.kind ?? 'current'}>
            {ACCOUNT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Last 4 digits of the account number" htmlFor={id('last4')} hint="Only the last 4 digits are kept, to tell accounts apart. Never enter the full number, passwords or OTPs.">
          <input id={id('last4')} name="last4" className="input tabular-nums" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={account?.last4} placeholder="1234" />
        </Field>
      </div>
      {!account && (
        <div className="grid gap-4 rounded-lg border border-line bg-slate-50 p-3 sm:grid-cols-3">
          <Field label="Current balance" htmlFor={id('balance')} hint="Negative for an overdraft or card dues, e.g. -25,000." className="sm:col-span-1">
            <RupeeInput id={id('balance')} name="balance" placeholder="15,00,000" />
          </Field>
          <Field label="As on date" htmlFor={id('as_of_date')}>
            <input id={id('as_of_date')} name="as_of_date" type="date" className="input" required defaultValue={today} max={today} />
          </Field>
          <Field label="Time" htmlFor={id('as_of_time')} hint="Transactions after this moment are added to it.">
            <input id={id('as_of_time')} name="as_of_time" type="time" className="input" defaultValue="09:00" />
          </Field>
        </div>
      )}
      <Field label="Notes" htmlFor={id('notes')}>
        <textarea id={id('notes')} name="notes" rows={2} className="input" maxLength={500} defaultValue={account?.notes} placeholder="Used for vendor payments" />
      </Field>
    </div>
  );
}

function CategorySelect({ id, defaultValue, include = 'all' }: { id: string; defaultValue?: string; include?: 'all' | 'payable' }) {
  if (include === 'payable') {
    return (
      <select id={id} name="category" className="input" defaultValue={defaultValue ?? 'vendor'} required>
        {PAYABLE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
    );
  }
  return (
    <select id={id} name="category" className="input" defaultValue={defaultValue ?? ''} required>
      <option value="" disabled>Choose a category</option>
      <optgroup label="Money out">
        {OUT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </optgroup>
      <optgroup label="Money in">
        {IN_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </optgroup>
      <optgroup label="Either">
        <option value={TRANSFER.key}>{TRANSFER.label}</option>
      </optgroup>
    </select>
  );
}

export function TxnFields({ txn, accounts, today, timeZone, defaultAccount }: { txn?: FinTxn; accounts: FinAccount[]; today: string; timeZone: string; defaultAccount?: string }) {
  const id = (f: string) => `txn-${f}`;
  const at = txn ? localParts(txn.txn_at, timeZone) : { date: today, time: '' };
  const linked = Boolean(txn?.payable_id || txn?.receivable_id);
  return (
    <div className="space-y-4">
      {txn && <input type="hidden" name="id" value={txn.id} />}
      {linked && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          This transaction records a payment, so its amount, direction and account stay as they are. Undo it to correct those.
        </p>
      )}
      <fieldset>
        <legend className="label">Money in or out</legend>
        <div className="flex gap-4">
          {(['out', 'in'] as const).map((d) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="direction" value={d} defaultChecked={(txn?.direction ?? 'out') === d} required disabled={linked} />
              {d === 'out' ? 'Money out (debit)' : 'Money in (credit)'}
            </label>
          ))}
        </div>
        {linked && <input type="hidden" name="direction" value={txn!.direction} />}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" htmlFor={id('amount')}>
          {linked ? (
            <>
              <input id={id('amount')} className="input tabular-nums" disabled defaultValue={rupeesField(txn!.amount_paise)} />
              <input type="hidden" name="amount" value={rupeesField(txn!.amount_paise)} />
            </>
          ) : (
            <RupeeInput id={id('amount')} name="amount" defaultValue={rupeesField(txn?.amount_paise)} />
          )}
        </Field>
        <Field label="Bank account" htmlFor={id('account')}>
          <select id={id('account')} name={linked ? undefined : 'account'} className="input" required defaultValue={txn?.account_id ?? defaultAccount ?? ''} disabled={linked}>
            <option value="" disabled>Choose an account</option>
            <AccountOptions accounts={accounts} />
          </select>
          {linked && <input type="hidden" name="account" value={txn!.account_id} />}
        </Field>
        <Field label="Date" htmlFor={id('date')}>
          <input id={id('date')} name="date" type="date" className="input" required defaultValue={at.date} />
        </Field>
        <Field label="Time" htmlFor={id('time')} hint="Optional. Midday if left empty.">
          <input id={id('time')} name="time" type="time" className="input" defaultValue={at.time} />
        </Field>
        <Field label="Category" htmlFor={id('category')}>
          <CategorySelect id={id('category')} defaultValue={txn?.category} />
        </Field>
        <Field label="Paid to / received from" htmlFor={id('counterparty')}>
          <input id={id('counterparty')} name="counterparty" className="input" maxLength={120} defaultValue={txn?.counterparty} placeholder="Vendor A" />
        </Field>
        <Field label="Reference number" htmlFor={id('reference')} hint="UTR, cheque or transaction ID. The same reference cannot be entered twice for one account.">
          <input id={id('reference')} name="reference" className="input font-mono text-sm" maxLength={80} defaultValue={txn?.reference_no} placeholder="UTR123456789" />
        </Field>
      </div>
      <Field label="Description" htmlFor={id('description')}>
        <textarea id={id('description')} name="description" rows={2} className="input" maxLength={500} defaultValue={txn?.description} />
      </Field>
    </div>
  );
}

export function PayableFields({ payable, accounts, today }: { payable?: FinPayable; accounts: FinAccount[]; today: string }) {
  const id = (f: string) => `pay-${f}`;
  const emi = Boolean(payable?.loan_id);
  return (
    <div className="space-y-4">
      {payable && <input type="hidden" name="id" value={payable.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What is it for" htmlFor={id('title')}>
          <input id={id('title')} name="title" className="input" required maxLength={120} defaultValue={payable?.title} placeholder="Vendor A invoice 1042" />
        </Field>
        <Field label="Pay to" htmlFor={id('payee')}>
          <input id={id('payee')} name="payee" className="input" maxLength={120} defaultValue={payable?.payee} placeholder="Vendor A" />
        </Field>
        <Field label="Amount" htmlFor={id('amount')} hint={payable && payable.paid_paise > 0 ? 'Cannot be less than what is already paid.' : undefined}>
          <RupeeInput id={id('amount')} name="amount" defaultValue={rupeesField(payable?.amount_paise)} placeholder="4,00,000" />
        </Field>
        {!payable && (
          <Field label="Due date" htmlFor={id('due')}>
            <input id={id('due')} name="due" type="date" className="input" required defaultValue={today} />
          </Field>
        )}
        <Field label="Category" htmlFor={id('category')}>
          {emi ? (
            <>
              <input id={id('category')} className="input" disabled value="Loan EMI" />
              <input type="hidden" name="category" value="loan_emi" />
            </>
          ) : (
            <CategorySelect id={id('category')} defaultValue={payable?.category} include="payable" />
          )}
        </Field>
        <Field label="Pay from" htmlFor={id('account')}>
          <select id={id('account')} name="account" className="input" defaultValue={payable?.account_id ?? ''}>
            <AccountOptions accounts={accounts} none="Not decided" />
          </select>
        </Field>
        {!emi && (
          <Field label="Repeats" htmlFor={id('recurrence')} hint="When a repeating payment is paid in full, the next one is added for you.">
            <select id={id('recurrence')} name="recurrence" className="input" defaultValue={payable?.recurrence ?? 'none'}>
              {RECURRENCES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      <fieldset>
        <legend className="label">Priority</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {PRIORITIES.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2 text-sm has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
              <input type="radio" name="priority" value={p.key} defaultChecked={(payable?.priority ?? (emi ? 'critical' : 'high')) === p.key} className="mt-0.5" />
              <span>
                <span className="block font-medium text-navy-900">{p.label}</span>
                <span className="block text-xs text-slate-500">{p.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Late payment penalty or terms" htmlFor={id('penalty')} hint="Only what you know, e.g. 2% a month after 7 days. The app never assumes a penalty or that a vendor can wait.">
        <input id={id('penalty')} name="penalty" className="input" maxLength={300} defaultValue={payable?.penalty} />
      </Field>
      <Field label="Notes" htmlFor={id('notes')}>
        <textarea id={id('notes')} name="notes" rows={2} className="input" maxLength={1000} defaultValue={payable?.notes} />
      </Field>
    </div>
  );
}

export function ReceivableFields({ receivable, accounts, today }: { receivable?: FinReceivable; accounts: FinAccount[]; today: string }) {
  const id = (f: string) => `rec-${f}`;
  return (
    <div className="space-y-4">
      {receivable && <input type="hidden" name="id" value={receivable.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who is paying" htmlFor={id('party')}>
          <input id={id('party')} name="party" className="input" required maxLength={120} defaultValue={receivable?.party} placeholder="Customer or marketplace name" />
        </Field>
        <Field label="Type" htmlFor={id('source')}>
          <select id={id('source')} name="source" className="input" defaultValue={receivable?.source ?? 'customer'}>
            {RECEIVABLE_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Expected amount" htmlFor={id('amount')}>
          <RupeeInput id={id('amount')} name="amount" defaultValue={rupeesField(receivable?.amount_paise)} placeholder="3,00,000" />
        </Field>
        {!receivable && (
          <Field label="Expected date" htmlFor={id('expected')}>
            <input id={id('expected')} name="expected" type="date" className="input" required defaultValue={today} />
          </Field>
        )}
        <Field label="Category" htmlFor={id('category')}>
          <select id={id('category')} name="category" className="input" defaultValue={receivable?.category ?? 'customer_receipt'}>
            {IN_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Invoice or reference number" htmlFor={id('reference')}>
          <input id={id('reference')} name="reference" className="input font-mono text-sm" maxLength={80} defaultValue={receivable?.reference_no} placeholder="INV-2026-118" />
        </Field>
        <Field label="Comes into" htmlFor={id('account')}>
          <select id={id('account')} name="account" className="input" defaultValue={receivable?.account_id ?? ''}>
            <AccountOptions accounts={accounts} none="Not known" />
          </select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={id('notes')}>
        <textarea id={id('notes')} name="notes" rows={2} className="input" maxLength={1000} defaultValue={receivable?.notes} />
      </Field>
    </div>
  );
}

export function LoanFields({ loan, accounts, today }: { loan?: FinLoan; accounts: FinAccount[]; today: string }) {
  const id = (f: string) => `loan-${f}`;
  return (
    <div className="space-y-4">
      {loan && <input type="hidden" name="id" value={loan.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loan name" htmlFor={id('name')}>
          <input id={id('name')} name="name" className="input" required maxLength={120} defaultValue={loan?.name} placeholder="Business loan" />
        </Field>
        <Field label="Lender" htmlFor={id('lender')}>
          <input id={id('lender')} name="lender" className="input" maxLength={120} defaultValue={loan?.lender} placeholder="Bajaj Finance" />
        </Field>
        <Field label="Loan amount" htmlFor={id('principal')}>
          <RupeeInput id={id('principal')} name="principal" defaultValue={rupeesField(loan?.principal_paise)} placeholder="25,00,000" />
        </Field>
        <Field label="Principal still outstanding" htmlFor={id('outstanding')} hint="From your latest loan statement.">
          <RupeeInput id={id('outstanding')} name="outstanding" defaultValue={rupeesField(loan?.outstanding_paise)} placeholder="18,00,000" />
        </Field>
        <Field label="Interest rate, % a year" htmlFor={id('rate')} hint="Optional. Used only to estimate how much of each EMI reduces the principal.">
          <input id={id('rate')} name="rate" className="input tabular-nums" inputMode="decimal" defaultValue={loan?.annual_rate ?? ''} placeholder="12.5" />
        </Field>
        <Field label="EMI amount" htmlFor={id('emi')}>
          <RupeeInput id={id('emi')} name="emi" defaultValue={rupeesField(loan?.emi_paise)} placeholder="1,50,000" />
        </Field>
        <Field label="First EMI date" htmlFor={id('first_emi')} hint="EMIs fall on this day each month.">
          <input id={id('first_emi')} name="first_emi" type="date" className="input" required defaultValue={loan?.first_emi_date ?? today} />
        </Field>
        <Field label="Number of EMIs in total" htmlFor={id('tenure')}>
          <input id={id('tenure')} name="tenure" type="number" min={1} max={600} className="input tabular-nums" required defaultValue={loan?.tenure_months} placeholder="24" />
        </Field>
        <Field label="EMIs already paid before adding it here" htmlFor={id('paid_before')} hint="These are not added as payments due.">
          <input id={id('paid_before')} name="paid_before" type="number" min={0} max={600} className="input tabular-nums" defaultValue={loan?.paid_before ?? 0} />
        </Field>
        <Field label="Paid from" htmlFor={id('account')}>
          <select id={id('account')} name="account" className="input" defaultValue={loan?.account_id ?? ''}>
            <AccountOptions accounts={accounts} none="Not decided" />
          </select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={id('notes')}>
        <textarea id={id('notes')} name="notes" rows={2} className="input" maxLength={1000} defaultValue={loan?.notes} />
      </Field>
    </div>
  );
}

/** Records all or part of a payable or receivable. The person confirms the amount, date and account. */
export function SettleFields({ kind, id, left, accountId, accounts, today }: { kind: 'pay' | 'receive'; id: string; left: number; accountId: string | null; accounts: FinAccount[]; today: string }) {
  const f = (x: string) => `settle-${kind}-${x}`;
  return (
    <div className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === 'pay' ? 'Amount paid' : 'Amount received'} htmlFor={f('amount')} hint="Enter less for a part payment.">
          <RupeeInput id={f('amount')} name="amount" defaultValue={rupeesField(left)} />
        </Field>
        <Field label={kind === 'pay' ? 'Paid on' : 'Received on'} htmlFor={f('date')}>
          <input id={f('date')} name={kind === 'pay' ? 'paid_on' : 'received_on'} type="date" className="input" required defaultValue={today} max={today} />
        </Field>
        <Field label={kind === 'pay' ? 'From account' : 'Into account'} htmlFor={f('account')}>
          <select id={f('account')} name="account" className="input" required defaultValue={accountId ?? (accounts.length === 1 ? accounts[0].id : '')}>
            <option value="" disabled>Choose an account</option>
            <AccountOptions accounts={accounts} />
          </select>
        </Field>
        <Field label="Reference number" htmlFor={f('reference')}>
          <input id={f('reference')} name="reference" className="input font-mono text-sm" maxLength={80} placeholder="UTR or cheque number" />
        </Field>
      </div>
      <Field label="Note" htmlFor={f('note')}>
        <input id={f('note')} name="note" className="input" maxLength={300} />
      </Field>
    </div>
  );
}
