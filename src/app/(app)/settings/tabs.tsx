import Link from 'next/link';
import type { AdminArea } from '@/lib/types';

const TABS = [
  { href: '/settings', label: 'Attendance', area: 'attendance' },
  { href: '/settings/company', label: 'Company & branding', area: 'settings' },
  { href: '/settings/quotes', label: 'Quotes', area: 'settings' },
] as const;

export function SettingsTabs({ current, areas }: { current: (typeof TABS)[number]['href']; areas: Record<AdminArea, boolean> }) {
  return (
    <nav aria-label="Settings sections" className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.filter((t) => areas[t.area]).map((t) => (
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
