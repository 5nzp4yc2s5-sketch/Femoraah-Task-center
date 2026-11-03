import type { ReactNode } from 'react';
import { requireFinance } from '@/lib/session';
import { FinanceNav } from './nav';

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  // Each page checks access again: layouts are not re-run on every navigation.
  await requireFinance();
  return (
    <>
      <FinanceNav />
      {children}
    </>
  );
}
