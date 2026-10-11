import { redirect } from 'next/navigation';
import { getSessionStatus } from '@/lib/session';
import { ActionForm, SubmitButton } from '@/components/forms';
import { signInAction } from '../auth-actions';
import { AuthShell } from '../auth-shell';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; signedout?: string }> }) {
  const sp = await searchParams;
  const s = await getSessionStatus();
  if (s.signed_in && s.linked && s.active) redirect(s.verified ? '/' : '/verify');
  return (
    <AuthShell step={1} title="Sign in" subtitle="Use the username and password your admin gave you.">
      {sp.error === 'inactive' && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This account is not active. Ask your admin if you think this is a mistake.
        </p>
      )}
      {sp.signedout === 'all' && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Signed out on all devices.</p>}
      <ActionForm action={signInAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="identifier">Username</label>
          <input id="identifier" name="identifier" className="input" autoComplete="username" autoCapitalize="none" required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Continue</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
