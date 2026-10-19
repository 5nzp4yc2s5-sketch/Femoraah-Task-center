'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireArea, requireMe } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import { CredentialKeyError, decryptField, encryptField, keyId } from '@/lib/credentials-crypto';
import type { ActionState } from '@/lib/types';
import type { RevealResult, SaveResult } from './lib';

// Passwords and notes only pass through here in plain text: they are encrypted before any database
// call and decrypted only for someone who passed the access and PIN checks. Nothing here logs them.

const id = z.uuid();
const pin = z.string().regex(/^\d{3}$/, 'Enter your 3-digit PIN.');
const password = z.string().min(1, 'Enter the password.').max(500, 'Keep the password under 500 characters.');
const notes = z.string().max(2000, 'Keep the notes under 2,000 characters.');
const fields = z.object({
  name: z.string().trim().min(1, 'Give the login a name.').max(120, 'Keep the name under 120 characters.'),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https?:\/\/[^\s<>"'\\]+$/.test(v), 'The website must be a full link starting with https:// or http://'),
  username: z.string().trim().max(200, 'Keep the username under 200 characters.'),
  category: z.string().trim().max(60, 'Keep the category under 60 characters.'),
});

function pinError(error: string, remaining?: number | null): string {
  if (error === 'wrong') return `Wrong PIN. ${remaining ?? 0} ${remaining === 1 ? 'try' : 'tries'} left before your account locks.`;
  if (error === 'locked') return 'Your account is locked after 5 wrong PINs. Ask the Super Admin to reset your PIN.';
  if (error === 'no_pin') return 'You do not have a PIN yet. Ask the Super Admin to set one.';
  if (error === 'not_found') return 'This login no longer exists or you no longer have access to it.';
  return 'Please sign in again.';
}

function keyMessage(e: unknown): string {
  return e instanceof CredentialKeyError ? e.message : 'Something went wrong. Please try again.';
}

export async function createCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireArea('credentials');
  const f = fields.safeParse(Object.fromEntries(formData));
  const pw = password.safeParse(formData.get('password'));
  const nt = notes.safeParse(String(formData.get('notes') ?? ''));
  if (!f.success) return { error: f.error.issues[0].message };
  if (!pw.success) return { error: pw.error.issues[0].message };
  if (!nt.success) return { error: nt.error.issues[0].message };
  const credId = randomUUID();
  let args;
  try {
    args = {
      p_id: credId,
      p_name: f.data.name,
      p_url: f.data.url,
      p_username: f.data.username,
      p_category: f.data.category,
      p_password_ct: encryptField(pw.data, credId, 'password'),
      p_notes_ct: nt.data.trim() ? encryptField(nt.data, credId, 'notes') : null,
      p_key_id: keyId(),
    };
  } catch (e) {
    return { error: keyMessage(e) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('cred_create', args);
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/credentials', 'layout');
  redirect(`/credentials/${credId}?created=1`);
}

export async function updateCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const cid = id.safeParse(formData.get('id'));
  const f = fields.safeParse(Object.fromEntries(formData));
  if (!cid.success) return { error: 'Unknown login.' };
  if (!f.success) return { error: f.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cred_update', {
    p_id: cid.data, p_name: f.data.name, p_url: f.data.url, p_username: f.data.username, p_category: f.data.category,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/credentials', 'layout');
  return { ok: 'Saved.' };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const cid = id.safeParse(formData.get('id'));
  const pw = password.safeParse(formData.get('password'));
  const p = pin.safeParse(formData.get('pin'));
  if (!cid.success) return { error: 'Unknown login.' };
  if (!pw.success) return { error: pw.error.issues[0].message };
  if (!p.success) return { error: p.error.issues[0].message };
  const r = await saveSecret(cid.data, p.data, 'password', pw.data);
  if (!r.ok) return { error: r.error };
  revalidatePath('/credentials', 'layout');
  return { ok: r.message };
}

export async function saveNotesAction(credId: string, pinValue: string, value: string): Promise<SaveResult> {
  await requireMe();
  const cid = id.safeParse(credId);
  const p = pin.safeParse(pinValue);
  const nt = notes.safeParse(value);
  if (!cid.success) return { ok: false, error: 'Unknown login.' };
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (!nt.success) return { ok: false, error: nt.error.issues[0].message };
  const r = await saveSecret(cid.data, p.data, 'notes', nt.data);
  if (r.ok) revalidatePath('/credentials', 'layout');
  return r;
}

async function saveSecret(credId: string, pinValue: string, field: 'password' | 'notes', value: string): Promise<SaveResult> {
  let ct: string | null;
  let kid: string;
  try {
    ct = field === 'notes' && !value.trim() ? null : encryptField(value, credId, field);
    kid = keyId();
  } catch (e) {
    return { ok: false, error: keyMessage(e) };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cred_set_secret', { p_id: credId, p_pin: pinValue, p_field: field, p_ct: ct, p_key_id: kid });
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.ok) return { ok: false, error: pinError(data?.error, data?.remaining) };
  return {
    ok: true,
    message: field === 'password' ? 'Password saved. This changes only the copy kept here, not the password on the website.' : 'Notes saved.',
  };
}

/** Check access and the PIN, record the event, and return the decrypted password (and notes to view). */
export async function revealCredential(credId: string, pinValue: string, purpose: 'view' | 'copy'): Promise<RevealResult> {
  await requireMe();
  const cid = id.safeParse(credId);
  const p = pin.safeParse(pinValue);
  if (!cid.success) return { ok: false, error: 'Unknown login.' };
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (purpose !== 'view' && purpose !== 'copy') return { ok: false, error: 'Unknown action.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cred_reveal', { p_id: cid.data, p_pin: p.data, p_purpose: purpose });
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.ok) return { ok: false, error: pinError(data?.error, data?.remaining) };
  try {
    return {
      ok: true,
      password: decryptField(data.password_ct, cid.data, 'password', data.key_id),
      notes: data.notes_ct ? decryptField(data.notes_ct, cid.data, 'notes', data.key_id) : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof CredentialKeyError ? e.message : 'This saved value could not be read with the current key.' };
  }
}

const target = z.string().regex(/^[mt]:[0-9a-f-]{36}$/i, 'Choose a person or a team.');

export async function shareAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const cid = id.safeParse(formData.get('id'));
  const t = target.safeParse(formData.get('target'));
  const level = z.enum(['use', 'manage']).safeParse(formData.get('level'));
  if (!cid.success) return { error: 'Unknown login.' };
  if (!t.success) return { error: t.error.issues[0].message };
  if (!level.success) return { error: 'Choose an access level.' };
  const [kind, who] = [t.data[0], t.data.slice(2)];
  const supabase = await createClient();
  const { error } = await supabase.rpc('cred_share', {
    p_id: cid.data, p_member: kind === 'm' ? who : null, p_team: kind === 't' ? who : null, p_level: level.data,
  });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/credentials', 'layout');
  return { ok: 'Access saved.' };
}

export async function unshareAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const aid = id.safeParse(formData.get('access'));
  if (!aid.success) return { error: 'Unknown access.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cred_unshare', { p_access: aid.data });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/credentials', 'layout');
  return { ok: 'Access removed.' };
}

export async function archiveCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMe();
  const cid = id.safeParse(formData.get('id'));
  if (!cid.success) return { error: 'Unknown login.' };
  const archived = formData.get('archived') !== '0';
  const supabase = await createClient();
  const { error } = await supabase.rpc('cred_set_archived', { p_id: cid.data, p_archived: archived });
  if (error) return { error: friendlyError(error.message) };
  revalidatePath('/credentials', 'layout');
  return { ok: archived ? 'Removed from use. A Credentials admin can restore it.' : 'Restored.' };
}
