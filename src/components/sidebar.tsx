'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type Group = 'Work' | 'People' | 'Workspace';
type Item = { href: string; label: string; icon: string; group: Group; managerOnly?: boolean; settingsOnly?: boolean };

const GROUPS: Group[] = ['Work', 'People', 'Workspace'];

const ITEMS: Item[] = [
  { href: '/', label: 'My Dashboard', group: 'Work', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { href: '/manager', label: 'Dashboard', group: 'Work', icon: 'M4 19V9m6 10V5m6 14v-7m4 7H2', managerOnly: true },
  { href: '/tasks', label: 'Task Board', group: 'Work', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
  { href: '/backlog', label: 'Pending Backlog', group: 'Work', icon: 'M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0h-5l-1 2h-4l-1-2H4' },
  { href: '/routines', label: 'Routine Tasks', group: 'Work', icon: 'M4 4v5h5M20 20v-5h-5M5.6 15a7 7 0 0012.3 2M18.4 9A7 7 0 006.1 7' },
  { href: '/calendar', label: 'Team Calendar', group: 'People', icon: 'M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z' },
  { href: '/sheets', label: 'Google Sheets', group: 'Workspace', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 10h16M4 15h16M10 4v16' },
  { href: '/credentials', label: 'Credentials', group: 'Workspace', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.7 5.7L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.6a1 1 0 01.3-.7l6-6A6 6 0 1121 9z' },
  { href: '/attendance', label: 'Attendance', group: 'People', icon: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/team', label: 'Team', group: 'People', icon: 'M17 20h5v-2a3 3 0 00-5.4-1.8M17 20H7m10 0v-2c0-.7-.1-1.3-.4-1.8M7 20H2v-2a3 3 0 015.4-1.8M7 20v-2c0-.7.1-1.3.4-1.8m0 0a5 5 0 019.2 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/data-review', label: 'Data Review', group: 'Workspace', icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z', managerOnly: true },
  { href: '/settings', label: 'Settings', group: 'Workspace', icon: 'M10.3 4.3a1.7 1.7 0 013.4 0 1.7 1.7 0 002.6 1.1 1.7 1.7 0 012.4 2.4 1.7 1.7 0 001 2.5 1.7 1.7 0 010 3.4 1.7 1.7 0 00-1 2.6 1.7 1.7 0 01-2.4 2.4 1.7 1.7 0 00-2.6 1 1.7 1.7 0 01-3.4 0 1.7 1.7 0 00-2.5-1 1.7 1.7 0 01-2.4-2.4 1.7 1.7 0 00-1.1-2.6 1.7 1.7 0 010-3.4 1.7 1.7 0 001.1-2.5 1.7 1.7 0 012.4-2.4 1.7 1.7 0 002.5-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z', settingsOnly: true },
  { href: '/help', label: 'How It Works', group: 'Workspace', icon: 'M8.2 9a4 4 0 017.6 1c0 2-3 2.5-3 4.5M12 18h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export interface SidebarBrand {
  name: string;
  short: string;
  tagline: string;
  mark: string;
  logoUrl: string | null;
}

export function Sidebar({
  name,
  role,
  isManager,
  canSettings,
  signOut,
  brand: b,
}: {
  name: string;
  role: string;
  isManager: boolean;
  /** Can open Settings (attendance or company settings area). */
  canSettings: boolean;
  signOut: () => Promise<void>;
  brand: SidebarBrand;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  const visible = ITEMS.filter((i) => (!i.managerOnly || isManager) && (!i.settingsOnly || canSettings));
  const nav = (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4" aria-label="Main">
      {GROUPS.map((g) => {
        const items = visible.filter((i) => i.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="mt-5 first:mt-2">
            <div className="mb-1 px-3 text-xs font-medium text-slate-400">{g}</div>
            <ul className="space-y-px">
              {items.map((i) => {
                const on = active(i.href);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={() => setOpen(false)}
                      aria-current={on ? 'page' : undefined}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-[7px] text-sm transition-colors ${
                        on ? 'bg-sidebar font-medium text-white' : 'text-slate-600 hover:bg-subtle hover:text-slate-900'
                      }`}
                    >
                      <span className={on ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}>
                        <Icon d={i.icon} />
                      </span>
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-line p-3">
      <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-subtle">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-100 text-sm font-semibold text-navy-800">{name.slice(0, 1)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{name}</span>
          <span className="block truncate text-xs text-slate-500">{role}</span>
        </span>
      </Link>
      <form action={signOut}>
        <button type="submit" className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-subtle hover:text-slate-900">
          Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5 px-5 py-4">
      {b.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-line" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar text-[13px] font-bold text-white">{b.mark}</span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-slate-900">{b.short}</span>
        <span className="block truncate text-xs text-slate-500">{b.tagline}</span>
      </span>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 pr-2 backdrop-blur lg:hidden">
        {brand}
        <button type="button" className="rounded-lg p-2 text-slate-700 hover:bg-subtle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:translate-x-0 ${open ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between">
          {brand}
          <button type="button" className="mr-2 rounded-lg p-2 text-slate-500 hover:bg-subtle hover:text-slate-900 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {nav}
        {footer}
      </aside>
    </>
  );
}
