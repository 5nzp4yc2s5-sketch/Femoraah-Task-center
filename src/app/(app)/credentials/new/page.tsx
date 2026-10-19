import Link from 'next/link';
import { requireArea } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { keyStatus } from '@/lib/credentials-crypto';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader } from '@/components/ui';
import { createCredentialAction } from '../actions';
import { CredentialFields } from '../fields';
import { PasswordInput } from '../inputs';
import { KeySetup } from '../setup';

export const metadata = { title: 'Add a login' };

export default async function NewCredential() {
  const me = await requireArea('credentials');
  const status = keyStatus();
  const supabase = await createClient();
  const { data: cats } = await supabase.from('credentials').select('category').is('archived_at', null).neq('category', '');
  const categories = [...new Set((cats ?? []).map((c) => c.category as string))].sort((a, b) => a.localeCompare(b));
  return (
    <div className="max-w-3xl">
      <PageHeader title="Add a login" subtitle="Save a shared login. Nobody else can see it until you share it on the next page." />
      {status !== 'ok' ? (
        <KeySetup status={status} isSuperAdmin={me.isAdmin} />
      ) : (
        <ActionForm action={createCredentialAction} className="card space-y-5 p-5">
          <CredentialFields categories={categories} />
          <PasswordInput id="cred-password" name="password" label="Password" />
          <div>
            <label className="label" htmlFor="cred-notes">Notes (encrypted, optional)</label>
            <textarea id="cred-notes" name="notes" rows={3} className="input" maxLength={2000} placeholder="Security questions, recovery codes, who to ask for the one-time code…" />
            <p className="mt-1 text-xs text-slate-500">Notes are encrypted like the password and shown only with a PIN.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Link href="/credentials" className="btn-secondary">Cancel</Link>
            <SubmitButton>Save login</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
