import { requireMe } from '@/lib/session';
import { getBrand, sidebarBrand } from '@/lib/brand';
import { Sidebar } from '@/components/sidebar';
import { AutoRefresh } from '@/components/auto-refresh';
import { signOutAction } from '../auth-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, brand] = await Promise.all([requireMe(), getBrand()]);
  return (
    <div className="min-h-dvh">
      <Sidebar name={me.name} role={me.role} isManager={me.isManager} isAdmin={me.isAdmin} signOut={signOutAction} brand={sidebarBrand(brand)} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
      <AutoRefresh />
    </div>
  );
}
