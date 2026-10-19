import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { ADMIN_AREAS, type AccessRole, type AdminArea } from './types';

export type { AccessRole, AdminArea } from './types';

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
  /** The Super Admin. */
  isAdmin: boolean;
  /** Admin areas this person can manage (the Super Admin has all of them). */
  areas: Record<AdminArea, boolean>;
  timezone: string;
}

const NO_AREAS: Record<AdminArea, boolean> = { attendance: false, settings: false, sheets: false, credentials: false };

/** Only an Admin (manager) has to ask: the Super Admin has every area and an Employee none. */
const getMyAreas = cache(async (role: AccessRole): Promise<Record<AdminArea, boolean>> => {
  if (role === 'admin') return { attendance: true, settings: true, sheets: true, credentials: true };
  if (role !== 'manager') return NO_AREAS;
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_admin_areas');
  const list = Array.isArray(data) ? (data as string[]) : [];
  return Object.fromEntries(ADMIN_AREAS.map((a) => [a.key, list.includes(a.key)])) as Record<AdminArea, boolean>;
});

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
    areas: await getMyAreas(role),
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

/** The Super Admin, or an Admin who has been given this area. */
export async function requireArea(area: AdminArea): Promise<Me> {
  const me = await requireMe();
  if (!me.areas[area]) redirect('/?error=admins-only');
  return me;
}
