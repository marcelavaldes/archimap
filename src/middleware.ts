import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  getSessionSecret,
  readTokenFromHeader,
  verifyToken,
} from '@/lib/admin/session';

/**
 * Gates the admin surface at the edge, before any route handler or page runs.
 *
 * Every /api/admin route also calls verifyAdmin() itself — that stays as
 * defence in depth. The point of this middleware is that forgetting the call on
 * a new route is no longer fatal.
 */
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

/** Where an unauthenticated page request is rendered: the admin layout's login form. */
const LOGIN_PAGE = '/admin';

function unauthorized(isApi: boolean, request: NextRequest): NextResponse {
  if (isApi) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Render the login form. A rewrite rather than a redirect, so the URL is
  // preserved and reloading after login lands on the page that was asked for.
  if (request.nextUrl.pathname === LOGIN_PAGE) return NextResponse.next();
  return NextResponse.rewrite(new URL(LOGIN_PAGE, request.url));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/admin');

  // The login handler is what mints the token, so it cannot require one.
  if (pathname === '/api/admin/login') return NextResponse.next();

  const secret = getSessionSecret();
  if (!secret) {
    // Fail closed and say why — a misconfigured secret should be loud, not an
    // inexplicable login loop.
    const body = { error: 'ADMIN_SESSION_SECRET not configured' };
    return isApi
      ? NextResponse.json(body, { status: 500 })
      : new NextResponse(`${body.error}\n`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
  }

  const bearer = readTokenFromHeader(request.headers.get('Authorization'));
  if (bearer && (await verifyToken(secret, bearer))) return NextResponse.next();

  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  if (await verifyToken(secret, cookie)) return NextResponse.next();

  return unauthorized(isApi, request);
}
