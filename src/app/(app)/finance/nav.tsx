'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/finance', label: 'Overview' },
  { href: '/finance/forecast', label: 'Forecast' },
  { href: '/finance/payables', label: 'Payments due' },
  { href: '/finance/receivables', label: 'Money coming in' },
  { href: '/finance/loans', label: 'Loans & EMIs' },
  { href: '/finance/transactions', label: 'Transactions' },
  { href: '/finance/accounts', label: 'Banks' },
];

export function FinanceNav() {
  const path = usePathname();
  const current = TABS.filter((t) => path === t.href || path.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Cash Flow sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? 'page' : undefined}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
            t.href === current ? 'border-navy-800 text-navy-900' : 'border-transparent text-slate-600 hover:border-line hover:text-navy-900'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
