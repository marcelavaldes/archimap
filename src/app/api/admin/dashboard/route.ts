import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { isFixtureMode } from '@/lib/fixture';
import {
  FIXTURE_HEADER,
  fixtureCommuneCount,
  fixtureCoverage,
  fixtureCriteria,
  fixtureValueCount,
} from '@/lib/fixture/admin';

export const runtime = 'nodejs';

/**
 * GET /api/admin/dashboard — Aggregate stats for admin dashboard
 */
export async function GET(request: NextRequest) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  try {
    // Fixture mode short-circuit — see src/lib/fixture/admin.ts. No-op unless
    // ARCHIMAP_FIXTURE=1, so the Supabase path below is unchanged in
    // production. Inside the try on purpose: an unbuilt fixture throws
    // FixtureMissingError, whose message is the instruction to run
    // `bun run fixture:build`, and outside the try the framework would swallow
    // it into an anonymous HTML 500.
    if (isFixtureMode()) {
      const [criteria, coverage, totalCommunes, totalValues] = await Promise.all([
        fixtureCriteria(request),
        fixtureCoverage(request),
        fixtureCommuneCount(request),
        fixtureValueCount(request),
      ]);
      return NextResponse.json(
        {
          totalCriteria: criteria.length,
          enabledCriteria: criteria.filter((c) => c.enabled).length,
          totalCommunes,
          totalValues,
          averageCoverage: coverage.length
            ? Math.round(
                (coverage.reduce((sum, c) => sum + c.coverage_percent, 0) / coverage.length) * 100
              ) / 100
            : 0,
          coverage,
        },
        { headers: FIXTURE_HEADER }
      );
    }

    const supabase = createAdminClient();

    // Fetch criteria count
    const { count: totalCriteria } = await supabase
      .from('criteria')
      .select('*', { count: 'exact', head: true });

    const { count: enabledCriteria } = await supabase
      .from('criteria')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', true);

    // Fetch coverage stats
    const { data: coverage } = await supabase
      .from('criterion_coverage')
      .select('*');

    // Fetch total communes
    const { count: totalCommunes } = await supabase
      .from('communes')
      .select('*', { count: 'exact', head: true });

    // Fetch total criterion values
    const { count: totalValues } = await supabase
      .from('criterion_values')
      .select('*', { count: 'exact', head: true });

    // Average coverage
    const avgCoverage = coverage && coverage.length > 0
      ? coverage.reduce((sum, c) => sum + Number(c.coverage_percent || 0), 0) / coverage.length
      : 0;

    return NextResponse.json({
      totalCriteria: totalCriteria ?? 0,
      enabledCriteria: enabledCriteria ?? 0,
      totalCommunes: totalCommunes ?? 0,
      totalValues: totalValues ?? 0,
      averageCoverage: Math.round(avgCoverage * 100) / 100,
      coverage: coverage ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
