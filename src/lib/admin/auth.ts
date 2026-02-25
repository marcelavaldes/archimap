import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/**
 * Verify admin authentication via Bearer token or cookie.
 * Returns null if authenticated, or a 401 NextResponse if not.
 */
export function verifyAdmin(request: NextRequest): NextResponse | null {
  if (!ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: 'ADMIN_PASSWORD not configured' },
      { status: 500 }
    );
  }

  // Check Authorization header
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    if (token === ADMIN_PASSWORD) return null;
  }

  // Check cookie
  const cookie = request.cookies.get('admin_token');
  if (cookie?.value === ADMIN_PASSWORD) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
