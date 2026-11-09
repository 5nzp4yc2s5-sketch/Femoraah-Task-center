import { NextResponse, type NextRequest } from 'next/server';
import { requireFinance } from '@/lib/session';
import { OAUTH_COOKIE, authUrl, googleConfig, newOAuthState, requestOrigin } from '@/lib/gmail';
import { isIsoDate } from '@/lib/format';
import { plusDays, todayIn } from '@/lib/finance';

// Sends the Super Admin to Google to allow read-only access to the mailbox with the bank alerts.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const me = await requireFinance();
  const origin = requestOrigin(request.headers, request.nextUrl.origin);
  const back = (error: string) => NextResponse.redirect(new URL(`/finance/gmail?error=${error}`, origin), 303);
  if (!me.isAdmin) return back('admin');
  if (!googleConfig()) return back('setup');

  const today = todayIn(me.timezone);
  const asked = request.nextUrl.searchParams.get('from');
  const from = isIsoDate(asked) && asked <= today && asked >= plusDays(today, -90) ? asked : plusDays(today, -30);

  const { state, verifier, challenge } = newOAuthState();
  const redirectUri = `${origin}/api/finance/gmail/callback`;
  const res = NextResponse.redirect(authUrl(redirectUri, state, challenge), 303);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, from, member: me.memberId }), {
    httpOnly: true,
    secure: origin.startsWith('https:'),
    sameSite: 'lax',
    path: '/api/finance/gmail',
    maxAge: 600,
  });
  return res;
}
