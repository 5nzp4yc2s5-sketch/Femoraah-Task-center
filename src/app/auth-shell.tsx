import type { ReactNode } from 'react';
import { getBrand, initials } from '@/lib/brand';

export async function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const brand = await getBrand();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" className="h-11 w-11 rounded-xl bg-white object-contain p-1" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-base font-bold text-slate-900">{initials(brand.companyName)}</span>
          )}
          <span>
            <span className="block text-lg font-semibold leading-tight tracking-tight">{brand.companyName}</span>
            <span className="block text-sm text-white/70">{brand.tagline}</span>
          </span>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-2xl shadow-black/20">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mb-6 mt-1.5 text-sm text-slate-600">{subtitle}</p>
          {children}
        </div>
        <p className="mt-5 text-center text-xs text-white/60">Private workspace. Accounts are created by the admin.</p>
      </div>
    </main>
  );
}
