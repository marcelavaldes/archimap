import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { isFixtureMode } from '@/lib/fixture';
import { FIXTURE_HEADER, fixtureCoverage, fixtureCriteria } from '@/lib/fixture/admin';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ingestion/status — Status of API-type criteria
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
        criteria
          .filter((c) => c.ingestion_type === 'api')
          .map((c) => ({
            id: c.id,
            name: c.name,
            ingestion_type: c.ingestion_type,
            api_config: c.api_config,
            last_updated: c.last_updated,
            coverage: byId.get(c.id) ?? null,
          })),
        { headers: FIXTURE_HEADER }
      );
    }

    const supabase = createAdminClient();

    // Get criteria with ingestion_type = 'api'
    const { data: criteria, error } = await supabase
      .from('criteria')
      .select('id, name, ingestion_type, api_config, last_updated')
      .eq('ingestion_type', 'api')
      .order('display_order');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get coverage for each
    const { data: coverage } = await supabase
      .from('criterion_coverage')
      .select('*');

    const coverageMap = new Map(
      (coverage ?? []).map(c => [c.criterion_id, c])
    );

    const result = (criteria ?? []).map(c => ({
      ...c,
      coverage: coverageMap.get(c.id) ?? null,
    }));

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
