import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  default: 'text-navy-900',
  red: 'text-red-700',
  amber: 'text-amber-700',
  grey: 'text-slate-700',
  green: 'text-green-700',
} as const;

export function StatCard({ label, value, tone = 'default', href, hint }: { label: string; value: number | string; tone?: keyof typeof tones; href?: string; hint?: string }) {
  const inner = (
    <div className="card h-full p-4 transition hover:border-navy-600/40">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-navy-600">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-navy-100 text-navy-800" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="font-medium text-navy-900">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-slate-600">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-800">{children}</h2>
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const s = tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900';
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${s}`}>{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="card overflow-x-auto">{children}</div>;
}
