'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type Item = { href: string; label: string; icon: string; managerOnly?: boolean };

const ITEMS: Item[] = [
  { href: '/', label: 'My Dashboard', icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { href: '/manager', label: 'Dashboard', icon: 'M4 19V9m6 10V5m6 14v-7m4 7H2', managerOnly: true },
  { href: '/tasks', label: 'Task Board', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
  { href: '/backlog', label: 'Pending Backlog', icon: 'M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0h-5l-1 2h-4l-1-2H4' },
  { href: '/routines', label: 'Routine Tasks', icon: 'M4 4v5h5M20 20v-5h-5M5.6 15a7 7 0 0012.3 2M18.4 9A7 7 0 006.1 7' },
  { href: '/team', label: 'Team', icon: 'M17 20h5v-2a3 3 0 00-5.4-1.8M17 20H7m10 0v-2c0-.7-.1-1.3-.4-1.8M7 20H2v-2a3 3 0 015.4-1.8M7 20v-2c0-.7.1-1.3.4-1.8m0 0a5 5 0 019.2 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/data-review', label: 'Data Review', icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z', managerOnly: true },
  { href: '/help', label: 'How It Works', icon: 'M8.2 9a4 4 0 017.6 1c0 2-3 2.5-3 4.5M12 18h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Sidebar({ name, role, isManager, signOut }: { name: string; role: string; isManager: boolean; signOut: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4" aria-label="Main">
      {ITEMS.filter((i) => !i.managerOnly || isManager).map((i) => (
        <Link
          key={i.href}
          href={i.href}
          onClick={() => setOpen(false)}
          aria-current={active(i.href) ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            active(i.href) ? 'bg-white/15 text-white' : 'text-navy-100/85 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Icon d={i.icon} />
          {i.label}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 p-3">
      <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/10">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white">{name.slice(0, 1)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-white">{name}</span>
          <span className="block text-xs capitalize text-navy-100/70">{role} · account</span>
        </span>
      </Link>
      <form action={signOut}>
        <button type="submit" className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-navy-100/85 hover:bg-white/10 hover:text-white">
          Sign out
        </button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-navy-800">OP</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">OpsPulse</span>
        <span className="block text-[11px] uppercase tracking-wider text-navy-100/70">Workspace</span>
      </span>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-800 px-4 py-2.5 lg:hidden">
        {brand}
        <button type="button" className="rounded-lg p-2 text-white hover:bg-white/10" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>
      {open && <div className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-navy-800 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between">
          {brand}
          <button type="button" className="mr-3 rounded-lg p-2 text-white hover:bg-white/10 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        {nav}
        {footer}
      </aside>
    </>
  );
}
