import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px] sm:leading-9">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-600">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

const tones = {
  default: 'text-slate-900',
  red: 'text-red-700',
  amber: 'text-amber-700',
  orange: 'text-orange-700',
  grey: 'text-slate-700',
  green: 'text-green-700',
} as const;

export function StatCard({ label, value, tone = 'default', href, hint }: { label: string; value: number | string; tone?: keyof typeof tones; href?: string; hint?: string }) {
  const inner = (
    <div className={`card h-full px-4 py-3.5 ${href ? 'transition-colors hover:border-line-strong hover:bg-subtle' : ''}`}>
      <div className="text-[13px] font-medium text-slate-500">{label}</div>
      <div className={`mt-1.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-2 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-subtle text-slate-500 ring-1 ring-line" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <p className="font-medium text-slate-900">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-9 flex items-end justify-between gap-3">
      <h2 className="text-[15px] font-semibold text-slate-900">{children}</h2>
      {action && <div className="shrink-0 text-sm">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const s =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-navy-100 bg-navy-50 text-slate-800';
  return <div className={`mb-4 rounded-lg border px-3.5 py-2.5 text-sm ${s}`}>{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="card overflow-x-auto">{children}</div>;
}
