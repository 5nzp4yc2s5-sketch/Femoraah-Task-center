export interface CredentialRow {
  id: string;
  name: string;
  url: string;
  username: string;
  category: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  password_changed_by: string | null;
  password_changed_at: string;
  archived_by: string | null;
  archived_at: string | null;
}

export interface AccessRow {
  id: string;
  credential_id: string;
  member_id: string | null;
  team_id: string | null;
  level: 'use' | 'manage';
  granted_by: string | null;
  granted_at: string;
}

export type MyLevel = 'admin' | 'manage' | 'use';

export const LEVEL_LABELS: Record<MyLevel, string> = { admin: 'Credentials admin', manage: 'Access manager', use: 'Can use' };

export const CRED_COLUMNS = 'id, name, url, username, category, created_by, created_at, updated_by, updated_at, password_changed_by, password_changed_at, archived_by, archived_at';

/** The site's host name for display, or the raw text if it is not a link. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export type RevealResult = { ok: true; password: string; notes: string | null } | { ok: false; error: string };
export type SaveResult = { ok: true; message: string } | { ok: false; error: string };
