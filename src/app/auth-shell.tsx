import type { ReactNode } from 'react';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy-800 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-base font-bold text-navy-800">OP</span>
          <span>
            <span className="block text-lg font-semibold leading-tight">OpsPulse Workspace</span>
            <span className="block text-xs uppercase tracking-wider text-navy-100/75">Team task command center</span>
          </span>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-navy-900">{title}</h1>
          <p className="mb-5 mt-1 text-sm text-slate-600">{subtitle}</p>
          {children}
        </div>
        <p className="mt-4 text-center text-xs text-navy-100/70">Private workspace. Accounts are created by the admin.</p>
      </div>
    </main>
  );
}
