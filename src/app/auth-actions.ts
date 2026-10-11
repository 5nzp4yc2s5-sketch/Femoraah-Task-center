'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionState } from '@/lib/types';

const GENERIC = 'Username or PIN is incorrect.';
const LOCKED = 'This account is locked after too many wrong PINs. Ask your admin to reset your PIN.';
const UNAVAILABLE = 'Sign-in is unavailable right now. Please try again shortly.';

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = String(formData.get('identifier') ?? '').trim().toLowerCase();
  const pin = String(formData.get('pin') ?? '').trim();
  if (!identifier || identifier.length > 254 || !/^\d{3}$/.test(pin)) return { error: 'Enter your username and 3-digit PIN.' };

  const ip = await clientIp();
  const admin = createAdminClient();
  // Per-username lockout lives with the PIN (service_pin_login); this only throttles one IP trying many usernames.
  const { data: gate, error: gateErr } = await admin.rpc('service_login_gate', { p_identifier: identifier, p_ip: ip });
  if (gateErr) return { error: UNAVAILABLE };
  if (gate?.ip_failures >= 20) return { error: 'Too many failed attempts. Please wait 15 minutes and try again.' };

  const { data: check, error: checkErr } = await admin.rpc('service_pin_login', { p_identifier: identifier, p_pin: pin });
  if (checkErr) return { error: UNAVAILABLE };
  if (!check?.ok) {
    await admin.rpc('service_record_login', { p_identifier: identifier, p_ip: ip, p_success: false });
    return { error: check?.error === 'locked' ? LOCKED : GENERIC };
  }

  // The PIN is right: start a session with a one-time magic-link token. No email is sent.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: check.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { error: UNAVAILABLE };
  const supabase = await createClient();
  const { error: otpErr } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (otpErr) return { error: UNAVAILABLE };
  const { data: verified } = await supabase.rpc('verify_pin', { p_pin: pin });
  await admin.rpc('service_record_login', { p_identifier: identifier, p_ip: ip, p_success: true });
  redirect(verified?.ok ? '/' : '/verify');
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
      return { error: `Incorrect PIN. ${data.remaining} attempt${data.remaining === 1 ? '' : 's'} left before the account locks.` };
    case 'locked':
      return { error: LOCKED };
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
