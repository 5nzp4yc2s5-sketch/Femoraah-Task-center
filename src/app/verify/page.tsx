import { redirect } from 'next/navigation';
import { getSessionStatus } from '@/lib/session';
import { ActionForm, SubmitButton } from '@/components/forms';
import { signOutAction, verifyPinAction } from '../auth-actions';
import { AuthShell } from '../auth-shell';

export const metadata = { title: 'Enter PIN' };

export default async function VerifyPage() {
  const s = await getSessionStatus();
  if (!s.signed_in) redirect('/login');
  if (!s.linked || !s.active) redirect('/login?error=inactive');
  if (s.verified) redirect('/');
  return (
    <AuthShell title={`Hi ${s.name}, enter your PIN`} subtitle="For your security, enter your 3-digit PIN again.">
      <ActionForm action={verifyPinAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="pin">PIN</label>
          <input
            id="pin"
            name="pin"
            className="input text-center text-2xl tracking-[0.6em]"
            inputMode="numeric"
            pattern="[0-9]{3}"
            maxLength={3}
            autoComplete="one-time-code"
            required
            autoFocus
          />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Checking…">Sign in</SubmitButton>
      </ActionForm>
      <form action={signOutAction} className="mt-3 text-center">
        <button className="text-sm text-slate-500 underline-offset-2 hover:underline">Use a different account</button>
      </form>
    </AuthShell>
  );
}
