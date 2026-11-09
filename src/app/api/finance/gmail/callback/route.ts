import { timingSafeEqual } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';
import { requireFinance } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { GoogleError, OAUTH_COOKIE, exchangeCode, mailboxAddress, requestOrigin, revokeToken } from '@/lib/gmail';
import { checkMailbox } from '@/lib/gmail-sync';
import { friendlyError } from '@/lib/format';

// Google sends the Super Admin back here. The one-time code is swapped for a read-only permission,
// which is stored encrypted in the database; then the first check of the mailbox starts.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const me = await requireFinance();
  const origin = requestOrigin(request.headers, request.nextUrl.origin);
  const go = (query: string) => {
    const res = NextResponse.redirect(new URL(`/finance/gmail?${query}`, origin), 303);
    res.cookies.set(OAUTH_COOKIE, '', { path: '/api/finance/gmail', maxAge: 0 });
    return res;
  };
  if (!me.isAdmin) return go('error=admin');

  let saved: { state?: string; verifier?: string; from?: string; member?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(OAUTH_COOKIE)?.value ?? '{}');
  } catch {
    saved = {};
  }
  const params = request.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  if (!saved.state || !saved.verifier || !state || !same(saved.state, state) || saved.member !== me.memberId) return go('error=expired');
  if (params.get('error')) return go(params.get('error') === 'access_denied' ? 'error=denied' : 'error=google');
  const code = params.get('code');
  if (!code) return go('error=google');

  let refreshToken = '';
  try {
    const tokens = await exchangeCode(code, `${origin}/api/finance/gmail/callback`, saved.verifier);
    refreshToken = tokens.refreshToken;
    const email = await mailboxAddress(tokens.accessToken);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('fin_gmail_connect', { p_email: email, p_refresh_token: refreshToken, p_import_from: saved.from });
    if (error) {
      await revokeToken(refreshToken);
      return go(`error=save&detail=${encodeURIComponent(friendlyError(error.message))}`);
    }
    after(() => checkMailbox(data as string, me.memberId));
    return go('connected=1');
  } catch (e) {
    if (refreshToken) await revokeToken(refreshToken);
    const detail = e instanceof GoogleError ? e.message : 'Google sign-in did not finish. Try again.';
    return go(`error=google&detail=${encodeURIComponent(detail)}`);
  }
}
