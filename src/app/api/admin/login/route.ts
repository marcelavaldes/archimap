import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  SESSION_TTL_SECONDS,
  getAdminPassword,
  getSessionSecret,
  mintToken,
  verifyPassword,
} from '@/lib/admin/session';

export const runtime = 'nodejs';

/**
 * POST /api/admin/login — check the shared password and set a signed session
 * cookie. This is the only place the admin password is read; the cookie carries
 * a minted token, never the password itself.
 */
export async function POST(request: NextRequest) {
  const adminPassword = getAdminPassword();
  if (!adminPassword) {
    return NextResponse.json({ error: 'ADMIN_PASSWORD not configured' }, { status: 500 });
  }

  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'ADMIN_SESSION_SECRET not configured' },
      { status: 500 }
    );
  }

  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof password !== 'string' || !(await verifyPassword(password, adminPassword))) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, await mintToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}
