import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isFixtureMode, loadFixture, type FixtureScores } from '@/lib/fixture';

export const runtime = 'nodejs';

/**
 * GET /api/scores?parent=<dept>&criteria=<id,id,...>
 *
 * Returns { [communeCode]: { [criterionId]: score } } for one département.
 *
 * This exists because the weighted composite needs N criteria per commune,
 * while /api/geo returns exactly one — and re-fetching geometry once per
 * criterion to collect them would move megabytes to carry a few kilobytes of
 * numbers. Scores are split out so the map can load geometry once and then
 * recolour from weights without touching the network at all, which is what
 * makes the sliders feel live.
 *
 * Only `score` is returned (not value/rank): the composite is a weighted mean
 * of scores, and scores are already normalised to the 0-100, 100-is-good space
 * by ingest. Callers wanting raw values use /api/commune/[code].
 */

/** PostgREST caps rows per response; walk pages until one comes back short. */
const PAGE_SIZE = 1000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parent = searchParams.get('parent');
  const criteriaParam = searchParams.get('criteria');

  if (!parent) {
    return NextResponse.json(
      { error: 'Missing "parent" (departement code)' },
      { status: 400 }
    );
  }

  const criterionIds = (criteriaParam ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (criterionIds.length === 0) {
    return NextResponse.json({ error: 'Missing "criteria"' }, { status: 400 });
  }

  // Fixture mode short-circuit — see src/lib/fixture/index.ts.
  if (isFixtureMode()) {
    return serveFixture(request, parent, criterionIds);
  }

  try {
    const supabase = await createClient();

    // 1. Commune codes in this département.
    const codes: string[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from('communes')
        .select('code')
        // Ordering the page walk is required, not cosmetic: PostgREST gives no
        // stable row order without it, so successive ranges can repeat rows and
        // skip others entirely. Same bug class as commit dc99aa2 in the
        // ingestion commune walk.
        .order('code')
        .eq('code_departement', parent)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('Scores: commune page error:', error);
        return NextResponse.json({ error: 'Failed to fetch communes' }, { status: 500 });
      }
      codes.push(...(data ?? []).map((r) => r.code as string));
      if (!data || data.length < PAGE_SIZE) break;
    }

    if (codes.length === 0) {
      return NextResponse.json({}, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }

    // 2. Scores for those communes, chunked to keep the `in` list bounded and
    //    paged within each chunk for the same ordering reason as above.
    const CHUNK = 500;
    const out: Record<string, Record<string, number>> = {};

    for (let i = 0; i < codes.length; i += CHUNK) {
      const chunk = codes.slice(i, i + CHUNK);
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from('criterion_values')
          .select('commune_code, criterion_id, score')
          .order('commune_code')
          .order('criterion_id')
          .in('criterion_id', criterionIds)
          .in('commune_code', chunk)
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) {
          console.error('Scores: value page error:', error);
          return NextResponse.json({ error: 'Failed to fetch scores' }, { status: 500 });
        }
        for (const row of data ?? []) {
          const code = row.commune_code as string;
          (out[code] ??= {})[row.criterion_id as string] = row.score as number;
        }
        if (!data || data.length < PAGE_SIZE) break;
      }
    }

    return NextResponse.json(out, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Scores API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function serveFixture(
  request: NextRequest,
  parent: string,
  criterionIds: string[]
): Promise<NextResponse> {
  let communes: Record<string, { dept: string }>;
  let scores: FixtureScores;
  try {
    [communes, scores] = await Promise.all([
      loadFixture<Record<string, { dept: string }>>(request, 'communes.json'),
      loadFixture<FixtureScores>(request, 'scores.json'),
    ]);
  } catch {
    return NextResponse.json({}, { headers: { 'X-Archimap-Fixture': '1' } });
  }

  const out: Record<string, Record<string, number>> = {};
  for (const [code, meta] of Object.entries(communes)) {
    if (meta.dept !== parent) continue;
    const entries = scores[code];
    if (!entries) continue;
    for (const id of criterionIds) {
      const entry = entries[id];
      if (entry) (out[code] ??= {})[id] = entry.score;
    }
  }

  return NextResponse.json(out, {
    headers: { 'Cache-Control': 'no-store', 'X-Archimap-Fixture': '1' },
  });
}
