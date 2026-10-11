import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from './server';

/**
 * Privileged client (bypasses RLS). Server-only. Used for: login lockout bookkeeping,
 * resolving a username to its login email, and creating / disabling auth users after the
 * caller has been verified as an admin through their own RLS-bound session.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
