import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { isFixtureMode } from '@/lib/fixture';

export const runtime = 'nodejs';

/**
 * GET /api/admin/session — "am I logged in, and what am I looking at?"
 *
 * The admin layout has to answer that on every page load, and it used to do so
 * by calling /api/admin/dashboard and checking `res.ok`. That endpoint runs four
 * COUNT(*) queries and a full scan of the criterion_coverage view, so every
 * navigation into the panel paid for an aggregate nobody read — twice on the
 * dashboard itself, since the page then fetches it again for real.
 *
 * This does the same job with no database access at all: middleware and
 * verifyAdmin have already decided, and reaching the body means yes.
 *
 * It also reports whether fixture mode is on, which is the only way the client
 * can know — the flag is server-side, and the panel must say out loud when its
 * numbers come from the fixture and its writes go nowhere.
 */
export async function GET(request: NextRequest) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  return NextResponse.json(
    { authenticated: true, fixture: isFixtureMode() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
