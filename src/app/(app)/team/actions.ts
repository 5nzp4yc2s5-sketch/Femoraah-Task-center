'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/session';
import { friendlyError } from '@/lib/format';
import type { ActionState } from '@/lib/types';

const memberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  role_title: z.string().trim().max(120).default(''),
  expertise: z.string().trim().max(1000).default(''),
  email: z.preprocess((v) => (v === '' ? null : v), z.email('Email looks invalid').nullable()),
  max_open_tasks: z.coerce.number().int().min(1, 'Max Open Tasks must be at least 1').max(200),
  access_role: z.enum(['member', 'manager', 'admin']),
  reports_to: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()),
  accepts_unmatched: z.boolean(),
});

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Username: 3-32 lowercase letters, digits, dot, dash or underscore'),
  pin: z.string().regex(/^\d{3}$/, 'PIN must be exactly 3 digits'),
});

function parseMember(formData: FormData) {
  return memberSchema.safeParse({ ...Object.fromEntries(formData), accepts_unmatched: formData.get('accepts_unmatched') === 'on' });
}

/** Login email: the member's own email if set, otherwise a non-routable placeholder. No email is ever sent. */
function loginEmail(username: string) {
  return `${username}@users.opspulse.invalid`;
}

async function provisionLogin(memberId: string, input: z.infer<typeof loginSchema>): Promise<string | null> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: loginEmail(input.username),
    // Sign-in is username + PIN, so nobody ever types this. It only has to be unguessable.
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
    app_metadata: { provisioned_by: 'opspulse-admin' },
  });
  if (error || !created.user) return error?.message.includes('already') ? 'That username is already taken.' : friendlyError(error?.message);
  const { error: linkErr } = await supabase.rpc('admin_link_login', { p_member: memberId, p_user: created.user.id, p_username: input.username });
  if (linkErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return friendlyError(linkErr.message);
  }
  const { error: pinErr } = await supabase.rpc('admin_set_pin', { p_member: memberId, p_pin: input.pin });
  if (pinErr) return friendlyError(pinErr.message);
  return null;
}

export async function createMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = parseMember(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const wantsLogin = Boolean(String(formData.get('username') ?? '').trim());
  const login = wantsLogin ? loginSchema.safeParse(Object.fromEntries(formData)) : null;
  if (login && !login.success) return { error: login.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from('members').insert(parsed.data).select('id').single();
  if (error) return { error: friendlyError(error.message) };
  if (login?.success) {
    const err = await provisionLogin(data.id, login.data);
    if (err) {
      revalidatePath('/team');
      redirect(`/team/${data.id}?loginError=${encodeURIComponent(err)}`);
    }
  }
  revalidatePath('/', 'layout');
  redirect(`/team/${data.id}?created=1`);
}

export async function updateMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get('id'));
  const parsed = parseMember(formData);
  if (!id.success) return { error: 'Unknown member.' };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from('members').update(parsed.data).eq('id', id.data).select('id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to edit members.' };
  revalidatePath('/', 'layout');
  return { ok: 'Saved.' };
}

export async function createLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get('id'));
  const login = loginSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return { error: 'Unknown member.' };
  if (!login.success) return { error: login.error.issues[0].message };
  const err = await provisionLogin(id.data, login.data);
  if (err) return { error: err };
  revalidatePath('/team', 'layout');
  return { ok: `Login created. Give ${login.data.username} their PIN in person; they can change it from Account.` };
}

async function userIdFor(memberId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('members').select('user_id').eq('id', memberId).maybeSingle();
  return data?.user_id ?? null;
}

export async function resetPinAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get('id'));
  const pin = loginSchema.shape.pin.safeParse(formData.get('pin'));
  if (!id.success) return { error: 'Unknown member.' };
  if (!pin.success) return { error: pin.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_pin', { p_member: id.data, p_pin: pin.data });
  if (error) return { error: friendlyError(error.message) };
  return { ok: 'PIN reset and lockout cleared.' };
}

export async function removeLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown member.' };
  const supabase = await createClient();
  const { data: userId, error } = await supabase.rpc('admin_unlink_login', { p_member: id.data });
  if (error) return { error: friendlyError(error.message) };
  if (userId) await createAdminClient().auth.admin.deleteUser(userId);
  revalidatePath('/team', 'layout');
  return { ok: 'Login removed. The member record and their task history are kept.' };
}

export async function setActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Unknown member.' };
  const active = formData.get('active') === '1';
  if (!active && id.data === me.memberId) return { error: 'You cannot deactivate yourself.' };
  const supabase = await createClient();
  const { data, error } = await supabase.from('members').update({ is_active: active }).eq('id', id.data).select('user_id');
  if (error) return { error: friendlyError(error.message) };
  if (!data?.length) return { error: 'You do not have permission to do that.' };
  const userId = data[0].user_id;
  if (userId) {
    // Ban blocks new sign-ins and token refresh; RLS already blocks data access immediately.
    await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
  }
  revalidatePath('/', 'layout');
  return { ok: active ? 'Member reactivated.' : 'Member deactivated. Their sessions no longer have access.' };
}
