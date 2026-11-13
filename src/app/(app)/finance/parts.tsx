import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtDate } from '@/lib/format';
import { ACCOUNT_KINDS, CATEGORY_LABELS, PRIORITY_LABELS, TONE_BADGE, inr, localParts, type FinAccount, type FinEvent, type PayPriority, type Tone } from '@/lib/finance';

const KIND_LABELS = Object.fromEntries(ACCOUNT_KINDS.map((k) => [k.key, k.label])) as Record<string, string>;

/** An amount in rupees, red when below zero. */
export function Money({ paise, className = '', signed = false, plain = false }: { paise: number; className?: string; signed?: boolean; plain?: boolean }) {
  const neg = paise < 0;
  const text = signed && paise > 0 ? `+${inr(paise)}` : neg ? `−${inr(-paise)}` : inr(paise);
  // `plain`: a payment going out is not a warning, so it is not shown in red.
  return <span className={`whitespace-nowrap tabular-nums ${neg && !plain ? 'text-red-700' : ''} ${className}`}>{text}</span>;
}

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_BADGE[tone]}`}>{children}</span>;
}

const PRIORITY_TONE: Record<PayPriority, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  medium: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  low: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200',
};

export function PriorityTag({ priority }: { priority: PayPriority }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_TONE[priority]}`}>{PRIORITY_LABELS[priority]}</span>;
}

/** "HDFC Current ••1234" */
export function accountName(a: Pick<FinAccount, 'name' | 'last4'> | undefined | null): string {
  if (!a) return 'No account';
  return a.last4 ? `${a.name} ••${a.last4}` : a.name;
}

export function accountKind(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function categoryName(c: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[c] ?? c;
}

/** Account options for a select, with an optional "none" choice. */
export function AccountOptions({ accounts, none }: { accounts: FinAccount[]; none?: string }) {
  return (
    <>
      {none !== undefined && <option value="">{none}</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{accountName(a)}{a.bank ? ` (${a.bank})` : ''}</option>
      ))}
    </>
  );
}

export function Field({ label, htmlFor, hint, children, className = '' }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Rupee input: text so people can type 1,50,000. */
export function RupeeInput({ id, name, defaultValue, required = true, placeholder = '1,50,000' }: { id: string; name: string; defaultValue?: string; required?: boolean; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500" aria-hidden>₹</span>
      <input id={id} name={name} inputMode="decimal" autoComplete="off" className="input pl-7 tabular-nums" required={required} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  created: 'Added',
  updated: 'Edited',
  archived: 'Taken out of use',
  restored: 'Back in use',
  balance_recorded: 'Balance recorded',
  voided: 'Undone',
  paid: 'Payment recorded',
  postponed: 'Postponed',
  date_changed: 'Date changed',
  received: 'Receipt recorded',
  closed: 'Closed',
  status_open: 'Back to still to pay',
  status_scheduled: 'Marked as scheduled',
  status_on_hold: 'Put on hold',
  status_cancelled: 'Cancelled',
  status_disputed: 'Marked as disputed',
  status_written_off: 'Written off',
  confirmed: 'Checked and confirmed',
  details_filled: 'Details filled in',
  card_linked: 'Debit card changed',
  statement_imported: 'Bank statement uploaded',
};

function eventDetail(e: FinEvent): string {
  const d = e.details as Record<string, unknown>;
  const money = (k: string) => (typeof d[k] === 'number' ? inr(d[k] as number) : '');
  const parts: string[] = [];
  if (e.action === 'paid' || e.action === 'received') {
    parts.push(`${money('amount')} on ${fmtDate(String(d.on ?? ''))}${d.full ? ', now settled' : ''}`);
  } else if (e.action === 'postponed' || e.action === 'date_changed') {
    parts.push(`${fmtDate(String(d.from ?? ''))} to ${fmtDate(String(d.to ?? ''))}`);
  } else if (e.action === 'balance_recorded') {
    parts.push(money('balance'));
  } else if (e.action === 'created') {
    if (d.amount != null) parts.push(money('amount'));
    if (d.due) parts.push(`due ${fmtDate(String(d.due))}`);
    if (d.expected) parts.push(`expected ${fmtDate(String(d.expected))}`);
  } else if (e.action === 'updated' && d.before && d.after) {
    const b = d.before as Record<string, unknown>;
    const a = d.after as Record<string, unknown>;
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      if (k === 'amount' || k === 'emi' || k === 'outstanding') parts.push(`${k === 'outstanding' ? 'outstanding' : k === 'emi' ? 'EMI' : 'amount'} ${inr(Number(b[k]))} to ${inr(Number(a[k]))}`);
      else if (k === 'tenure') parts.push(`EMIs ${b[k]} to ${a[k]}`);
      else if (k === 'direction') parts.push(a[k] === 'in' ? 'now money in' : 'now money out');
      else if (k === 'priority') parts.push(`priority ${PRIORITY_LABELS[b[k] as PayPriority] ?? b[k]} to ${PRIORITY_LABELS[a[k] as PayPriority] ?? a[k]}`);
      else if (k === 'category') parts.push(`category ${categoryName(String(b[k]))} to ${categoryName(String(a[k]))}`);
      else parts.push(`${({ at: 'date and time', title: 'title', party: 'name', name: 'name' } as Record<string, string>)[k] ?? k} changed`);
    }
  } else if (e.action === 'voided') {
    parts.push(money('amount'));
  } else if (e.action === 'details_filled') {
    const filled = (k: string, label: string) => {
      const v = d[k] as { before?: string; after?: string } | undefined;
      if (v && v.after && v.after !== v.before) parts.push(`${label} ${v.after}`);
    };
    filled('counterparty', 'payee');
    filled('reference_no', 'reference');
    parts.push(d.by === 'statement' ? 'from a bank statement' : 'from the bank email');
  } else if (e.action === 'card_linked') {
    parts.push(d.after ? `card ending ${d.after}` : 'card removed');
  } else if (e.action === 'statement_imported' && d.from) {
    const n = (k: string) => Number(d[k] ?? 0);
    parts.push(`${fmtDate(String(d.from))} to ${fmtDate(String(d.to))}`, `${n('added')} added`, `${n('matched')} already recorded`);
    if (n('already')) parts.push(`${n('already')} brought in before`);
  }
  if (typeof d.reason === 'string' && d.reason) parts.push(`reason: ${d.reason}`);
  return parts.join(' · ');
}

/** Who changed what and when. */
export function History({ events, names, timeZone }: { events: FinEvent[]; names: Map<string, string>; timeZone: string }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No changes yet.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {events.map((e) => {
        const at = localParts(e.created_at, timeZone);
        const detail = eventDetail(e);
        return (
          <li key={e.id} className="flex flex-col gap-0.5 border-l-2 border-line pl-3 sm:flex-row sm:gap-3">
            <span className="shrink-0 tabular-nums text-xs text-slate-500 sm:w-32">{fmtDate(at.date)} {at.time}</span>
            <span>
              <strong className="font-medium text-navy-900">{ACTIONS[e.action] ?? e.action}</strong>
              {detail && <span className="text-slate-700"> · {detail}</span>}
              <span className="text-slate-500"> · {e.actor_member_id ? names.get(e.actor_member_id) ?? 'Someone' : 'Automatic'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-2 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline">
      <span aria-hidden>←</span> {children}
    </Link>
  );
}

/** A label and value row on a detail page. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/60 py-1.5 text-sm last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{children}</dd>
    </div>
  );
}
