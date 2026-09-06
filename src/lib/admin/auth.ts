import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  getSessionSecret,
  readTokenFromHeader,
  verifyToken,
} from './session';

/**
 * Verify an admin session via Bearer token or cookie.
 * Returns null if authenticated, or a 401 NextResponse if not.
 *
 * This checks a signed session token — it never compares anything against
 * ADMIN_PASSWORD. Minting that token is the login handler's job alone.
 *
 * `src/middleware.ts` already gates every /api/admin route; these per-route
 * calls stay as defence in depth so a matcher change cannot silently expose a
 * handler.
 */
export async function verifyAdmin(request: NextRequest): Promise<NextResponse | null> {
  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'ADMIN_SESSION_SECRET not configured' },
      { status: 500 }
    );
  }

  const bearer = readTokenFromHeader(request.headers.get('Authorization'));
  if (bearer && (await verifyToken(secret, bearer))) return null;

  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  if (await verifyToken(secret, cookie)) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
