'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionState } from '@/lib/types';

const GENERIC = 'Username or password is incorrect.';

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = String(formData.get('identifier') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!identifier || !password || identifier.length > 254 || password.length > 200) return { error: GENERIC };

  const ip = await clientIp();
  const admin = createAdminClient();
  const { data: gate, error: gateErr } = await admin.rpc('service_login_gate', { p_identifier: identifier, p_ip: ip });
  if (gateErr) return { error: 'Sign-in is unavailable right now. Please try again shortly.' };
  if (!gate?.allowed) return { error: 'Too many failed attempts. Please wait 15 minutes and try again.' };

  const { data: email } = await admin.rpc('service_resolve_login', { p_identifier: identifier });
  const supabase = await createClient();
  let ok = false;
  if (email) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    ok = !error;
  }
  await admin.rpc('service_record_login', { p_identifier: identifier, p_ip: ip, p_success: ok });
  if (!ok) return { error: GENERIC };
  redirect('/verify');
}

export async function verifyPinAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const pin = String(formData.get('pin') ?? '').trim();
  if (!/^\d{3}$/.test(pin)) return { error: 'Enter your 3-digit PIN.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('verify_pin', { p_pin: pin });
  if (error) return { error: 'Could not check your PIN. Please try again.' };
  if (data?.ok) redirect('/');
  switch (data?.error) {
    case 'wrong_pin':
      return { error: `Incorrect PIN. ${data.remaining} attempt${data.remaining === 1 ? '' : 's'} left before a 15-minute lock.` };
    case 'locked':
      return { error: `Too many wrong PINs. Try again after ${new Date(data.locked_until).toLocaleTimeString()}.` };
    case 'no_pin':
      return { error: 'No PIN has been set for your account yet. Ask your admin to set one.' };
    default:
      redirect('/login');
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('end_session');
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

export async function signOutEverywhereAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('end_session');
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login?signedout=all');
}
