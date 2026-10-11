import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type AccessRole = 'admin' | 'manager' | 'member';

export interface SessionStatus {
  signed_in: boolean;
  linked?: boolean;
  active?: boolean;
  member_id?: string;
  name?: string;
  access_role?: AccessRole;
  has_pin?: boolean;
  verified?: boolean;
  timezone?: string;
}

export const getSessionStatus = cache(async (): Promise<SessionStatus> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return { signed_in: false };
  const { data, error } = await supabase.rpc('session_status');
  if (error || !data) return { signed_in: false };
  return data as SessionStatus;
});

export interface Me {
  memberId: string;
  name: string;
  role: AccessRole;
  isManager: boolean;
  isAdmin: boolean;
  timezone: string;
}

/** Require a fully verified (PIN-checked) session or redirect to the right step. */
export async function requireMe(): Promise<Me> {
  const s = await getSessionStatus();
  if (!s.signed_in) redirect('/login');
  if (!s.linked || !s.active) redirect('/login?error=inactive');
  if (!s.verified) redirect('/verify');
  const role = s.access_role ?? 'member';
  return {
    memberId: s.member_id!,
    name: s.name!,
    role,
    isManager: role === 'manager' || role === 'admin',
    isAdmin: role === 'admin',
    timezone: s.timezone ?? 'UTC',
  };
}

export async function requireManager(): Promise<Me> {
  const me = await requireMe();
  if (!me.isManager) redirect('/?error=managers-only');
  return me;
}

export async function requireAdmin(): Promise<Me> {
  const me = await requireMe();
  if (!me.isAdmin) redirect('/?error=admins-only');
  return me;
}
