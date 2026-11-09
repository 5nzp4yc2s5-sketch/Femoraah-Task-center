import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

// Talks to Google for the Cash Flow bank-alert import. It asks only for read-only Gmail access
// (gmail.readonly), so the app can never send, change or remove an email. The client ID and secret
// come from the server environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) and never reach the
// browser.

/** Short-lived cookie holding the sign-in state and PKCE verifier while the person is at Google. */
export const OAUTH_COOKIE = 'opspulse_gmail_oauth';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/** Scopes Google may also report for the same grant; anything else means more access than read-only. */
const HARMLESS_SCOPES = new Set([GMAIL_SCOPE, 'openid', 'email', 'https://www.googleapis.com/auth/userinfo.email']);

export class GoogleError extends Error {
  constructor(message: string, readonly code: string = 'google') {
    super(message);
  }
}

// Local tests point these at a stand-in server; only a localhost address is accepted.
function base(): { auth: string; token: string; revoke: string; gmail: string } {
  const test = process.env.GOOGLE_API_TEST_BASE?.trim();
  if (test && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(test)) {
    return { auth: `${test}/o/oauth2/v2/auth`, token: `${test}/token`, revoke: `${test}/revoke`, gmail: `${test}/gmail/v1` };
  }
  return {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    gmail: 'https://gmail.googleapis.com/gmail/v1',
  };
}

/** The address the person is using the app at, e.g. https://femoraah-task-center.vercel.app. */
export function requestOrigin(headers: Headers, fallback: string): string {
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return fallback;
  const proto = (headers.get('x-forwarded-proto') ?? fallback.split(':')[0]).split(',')[0].trim();
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function requireConfig() {
  const c = googleConfig();
  if (!c) throw new GoogleError('Google sign-in is not set up on the server yet.', 'setup');
  return c;
}

export function newOAuthState(): { state: string; verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { state: randomBytes(24).toString('base64url'), verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authUrl(redirectUri: string, state: string, challenge: string): string {
  const { clientId } = requireConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${base().auth}?${p}`;
}

async function tokenCall(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(base().token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    throw new GoogleError(
      code === 'invalid_grant' ? 'Google no longer allows this app to read the mailbox. Connect it again.' : `Google refused the request (${code}).`,
      code,
    );
  }
  return json;
}

/** Swaps the one-time code for tokens and checks that only read-only access was granted. */
export async function exchangeCode(code: string, redirectUri: string, verifier: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { clientId, clientSecret } = requireConfig();
  const t = await tokenCall({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code_verifier: verifier });
  const scopes = String(t.scope ?? '').split(/\s+/).filter(Boolean);
  const accessToken = String(t.access_token ?? '');
  const refreshToken = String(t.refresh_token ?? '');
  if (!scopes.includes(GMAIL_SCOPE)) {
    await revokeToken(refreshToken || accessToken);
    throw new GoogleError('Read access to Gmail was not ticked on Google\'s screen, so nothing was connected.', 'scope_missing');
  }
  if (scopes.some((s) => !HARMLESS_SCOPES.has(s))) {
    await revokeToken(refreshToken || accessToken);
    throw new GoogleError('Google granted more than read-only access, so the app refused it and nothing was saved.', 'scope_extra');
  }
  if (!accessToken || !refreshToken) {
    await revokeToken(refreshToken || accessToken);
    throw new GoogleError('Google did not give a lasting permission. Try connecting again.', 'no_refresh');
  }
  return { accessToken, refreshToken };
}

export async function accessTokenFrom(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = requireConfig();
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  const token = String(t.access_token ?? '');
  if (!token) throw new GoogleError('Google did not return access. Try again later.');
  return token;
}

/** Tells Google to cancel the permission. Best effort: a failure here does not stop a disconnect. */
export async function revokeToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(base().revoke, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${base().gmail}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    throw new GoogleError(`Gmail refused the request (${json.error?.status ?? res.status}).`, json.error?.status ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function mailboxAddress(accessToken: string): Promise<string> {
  const p = await gmailGet<{ emailAddress?: string }>(accessToken, '/users/me/profile');
  if (!p.emailAddress) throw new GoogleError('Gmail did not say which mailbox this is.');
  return p.emailAddress.toLowerCase();
}

/** Message ids matching a Gmail search, newest first, up to `limit`. */
export async function searchMessages(accessToken: string, q: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';
  while (ids.length < limit) {
    const p = new URLSearchParams({ q, maxResults: String(Math.min(100, limit - ids.length)) });
    if (pageToken) p.set('pageToken', pageToken);
    const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, `/users/me/messages?${p}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return ids;
}

interface Part {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: Part[];
}

export interface MailMessage {
  id: string;
  receivedAt: string;
  from: string;
  subject: string;
  authResults: string[];
  body: string;
}

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

function findBody(part: Part, type: string): string {
  if (part.mimeType === type && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = findBody(p, type);
    if (found) return found;
  }
  return '';
}

export async function readMessage(accessToken: string, id: string): Promise<MailMessage> {
  const m = await gmailGet<{ id: string; internalDate?: string; payload?: Part }>(accessToken, `/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const headers = m.payload?.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const payload = m.payload ?? {};
  return {
    id: m.id,
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    from: header('from'),
    subject: header('subject'),
    authResults: headers.filter((h) => h.name.toLowerCase() === 'authentication-results').map((h) => h.value),
    body: findBody(payload, 'text/plain') || findBody(payload, 'text/html') || decode(payload.body?.data),
  };
}
