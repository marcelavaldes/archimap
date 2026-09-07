import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { isFixtureMode, type FixtureAdminCriterion } from '@/lib/fixture';
import {
  FIXTURE_HEADER,
  createCriterion,
  fixtureCoverage,
  fixtureCriteria,
  fixtureWriteResult,
} from '@/lib/fixture/admin';

export const runtime = 'nodejs';

/** Zero coverage, as the list screen expects it when a criterion has no values. */
const EMPTY_COVERAGE = {
  communes_with_data: 0,
  total_communes: 0,
  coverage_percent: 0,
  oldest_data: null,
  newest_data: null,
};

/**
 * GET /api/admin/criteria — List all criteria with coverage stats
 */
export async function GET(request: NextRequest) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  try {
    // Fixture mode short-circuit — see src/lib/fixture/admin.ts. No-op unless
    // ARCHIMAP_FIXTURE=1, so the Supabase path below is unchanged in
    // production. Inside the try so an unbuilt fixture reports the message that
    // tells you to run `bun run fixture:build`.
    if (isFixtureMode()) {
      const [criteria, coverage] = await Promise.all([
        fixtureCriteria(request),
        fixtureCoverage(request),
      ]);
      const byId = new Map(coverage.map((c) => [c.criterion_id, c]));
      return NextResponse.json(
        criteria.map((c) => ({ ...c, coverage: byId.get(c.id) ?? EMPTY_COVERAGE })),
        { headers: FIXTURE_HEADER }
      );
    }

    const supabase = createAdminClient();

    const { data: criteria, error } = await supabase
      .from('criteria')
      .select('*')
      .order('display_order');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get coverage data
    const { data: coverage } = await supabase
      .from('criterion_coverage')
      .select('*');

    const coverageMap = new Map(
      (coverage ?? []).map(c => [c.criterion_id, c])
    );

    const result = (criteria ?? []).map(c => ({
      ...c,
      coverage: coverageMap.get(c.id) ?? EMPTY_COVERAGE,
    }));

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/criteria — Create a new criterion
 */
export async function POST(request: NextRequest) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    const row = {
      id: body.id,
      name: body.name,
      name_en: body.name_en,
      category: body.category,
      description: body.description,
      unit: body.unit,
      source: body.source,
      last_updated: body.last_updated ?? null,
      higher_is_better: body.higher_is_better ?? true,
      color_scale_low: body.color_scale_low,
      color_scale_mid: body.color_scale_mid,
      color_scale_high: body.color_scale_high,
      enabled: body.enabled ?? true,
      display_order: body.display_order ?? 0,
      ingestion_type: body.ingestion_type ?? 'manual',
      api_config: body.api_config ?? null,
    };

    // Fixture mode: apply to the in-memory overlay and say so. The response is
    // deliberately not a bare 201 echoing the row — that would be
    // indistinguishable from a real insert, which is the exact confusion this
    // whole mode exists to prevent.
    if (isFixtureMode()) {
      if (!row.id || !row.name) {
        return NextResponse.json(
          { error: 'id and name are required' },
          { status: 400, headers: FIXTURE_HEADER }
        );
      }
      const existing = await fixtureCriteria(request);
      if (existing.some((c) => c.id === row.id)) {
        return NextResponse.json(
          { error: `Criterion "${row.id}" already exists` },
          { status: 400, headers: FIXTURE_HEADER }
        );
      }
      createCriterion(row as FixtureAdminCriterion);
      return NextResponse.json(fixtureWriteResult(row), {
        status: 201,
        headers: FIXTURE_HEADER,
      });
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('criteria')
      .insert(row)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
