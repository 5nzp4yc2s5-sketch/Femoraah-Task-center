import { requireMe } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';
import { ActionForm, SubmitButton } from '@/components/forms';
import { PageHeader, SectionTitle } from '@/components/ui';
import { signOutEverywhereAction } from '../../auth-actions';

export const metadata = { title: 'Account' };

async function changePin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  'use server';
  await requireMe();
  const next = String(formData.get('new_pin') ?? '');
  if (!/^\d{3}$/.test(next)) return { error: 'New PIN must be exactly 3 digits.' };
  if (next !== formData.get('confirm_pin')) return { error: 'The new PINs do not match.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('change_my_pin', { p_current: String(formData.get('current_pin') ?? ''), p_new: next });
  if (error) return { error: friendlyError(error.message) };
  if (!data?.ok) return { error: 'Current PIN is incorrect.' };
  return { ok: 'PIN changed.' };
}

export default async function Account() {
  const me = await requireMe();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Account" subtitle={`${me.name} · ${me.role}`} />
      <section className="card p-5">
        <SectionTitle>Change PIN</SectionTitle>
        <ActionForm action={changePin} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
          {(['current_pin', 'new_pin', 'confirm_pin'] as const).map((n) => (
            <div key={n}>
              <label className="label" htmlFor={n}>{n.replace('_', ' ')}</label>
              <input id={n} name={n} className="input" inputMode="numeric" pattern="[0-9]{3}" maxLength={3} required autoComplete="off" />
            </div>
          ))}
          <div className="sm:col-span-3"><SubmitButton>Change PIN</SubmitButton></div>
        </ActionForm>
      </section>
      <section className="card mt-5 p-5">
        <SectionTitle>Sessions</SectionTitle>
        <p className="mb-3 text-sm text-slate-600">Signs you out on every phone and computer, including this one.</p>
        <form action={signOutEverywhereAction}>
          <button className="btn-secondary">Sign out everywhere</button>
        </form>
      </section>
    </div>
  );
}
