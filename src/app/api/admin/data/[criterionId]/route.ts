import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { isFixtureMode } from '@/lib/fixture';
import { FIXTURE_HEADER, fixtureValues, fixtureWriteResult } from '@/lib/fixture/admin';

export const runtime = 'nodejs';

/** Parse a positive integer query param, falling back when it is absent or junk. */
function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * GET /api/admin/data/[criterionId] — Paginated values for a criterion
 * Query params: ?page=1&limit=50&search=montpellier
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;
  const { searchParams } = new URL(request.url);
  // Guarded rather than bare parseInt: `?page=abc` used to yield NaN, which
  // became a NaN offset and a PostgREST range error the UI reported as a blank
  // "Aucune donnée" table.
  const page = intParam(searchParams.get('page'), 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = intParam(searchParams.get('limit'), 50, 1, 100);
  const search = searchParams.get('search') ?? '';

  try {
    // Fixture mode short-circuit — see src/lib/fixture/admin.ts. No-op unless
    // ARCHIMAP_FIXTURE=1, so the Supabase path below is unchanged in
    // production. Inside the try so an unbuilt fixture reports the message that
    // tells you to run `bun run fixture:build`.
    if (isFixtureMode()) {
      const { data, total } = await fixtureValues(request, criterionId, { page, limit, search });
      return NextResponse.json(
        { data, total, page, limit, totalPages: Math.ceil(total / limit) },
        { headers: FIXTURE_HEADER }
      );
    }

    const supabase = createAdminClient();
    const offset = (page - 1) * limit;

    let query = supabase
      .from('criterion_values')
      .select('*, communes!inner(nom)', { count: 'exact' })
      .eq('criterion_id', criterionId)
      .order('score', { ascending: false })
      // The commune_code tiebreaker is load-bearing, not cosmetic. `score` is an
      // integer 0-100 spread over tens of thousands of communes, so ties are the
      // rule rather than the exception, and offset pagination over a sort key
      // with ties has no defined order between pages: Postgres is free to return
      // a tied row on page 1 and again on page 2 while another is never returned
      // at all. Adding a unique second key gives the .range() walk one total
      // order. Same bug class as commit dc99aa2 in the ingestion commune walk.
      .order('commune_code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.ilike('communes.nom', `%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/data/[criterionId] — Delete all values for a criterion
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;

  // Fixture mode: refuse, and say so. Unlike the criteria overlay, there is no
  // useful thing to show here — an emptied table looks identical to a broken
  // one, so pretending would teach the operator nothing and cost them the only
  // data the local panel has to display.
  try {
    if (isFixtureMode()) {
      const { total } = await fixtureValues(request, criterionId, {
        page: 1,
        limit: 1,
        search: '',
      });
      return NextResponse.json(
        fixtureWriteResult({ deleted: 0, wouldDelete: total }),
        { headers: FIXTURE_HEADER }
      );
    }

    const supabase = createAdminClient();

    const { count, error } = await supabase
      .from('criterion_values')
      .delete({ count: 'exact' })
      .eq('criterion_id', criterionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: count ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
