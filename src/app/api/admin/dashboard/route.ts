import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/admin/dashboard — Aggregate stats for admin dashboard
 */
export async function GET(request: NextRequest) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  try {
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
