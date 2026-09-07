import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isFixtureMode, loadFixture } from '@/lib/fixture';

export const runtime = 'nodejs';

/**
 * GET /api/criteria — Public endpoint returning enabled criteria (cached 5min)
 */
export async function GET(request: Request) {
  // Fixture mode short-circuit — see src/lib/fixture/index.ts. No-op unless
  // ARCHIMAP_FIXTURE=1, so the Supabase path below is unchanged in production.
  if (isFixtureMode()) {
    const criteria = await loadFixture<Record<string, CriterionResponse>>(request, 'criteria.json');
    return NextResponse.json(criteria, {
      headers: { 'Cache-Control': 'no-store', 'X-Archimap-Fixture': '1' },
    });
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('criteria')
      .select('*')
      .eq('enabled', true)
      .order('display_order');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform DB rows to Criterion shape expected by frontend
    const criteria: Record<string, CriterionResponse> = {};
    for (const row of data ?? []) {
      criteria[row.id] = {
        id: row.id,
        name: row.name,
        nameEn: row.name_en,
        category: row.category,
        description: row.description,
        unit: row.unit,
        source: row.source,
        lastUpdated: row.last_updated ?? '',
        higherIsBetter: row.higher_is_better,
        colorScale: {
          low: row.color_scale_low,
          mid: row.color_scale_mid,
          high: row.color_scale_high,
        },
      };
    }

    return NextResponse.json(criteria, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

interface CriterionResponse {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  description: string;
  unit: string;
  source: string;
  lastUpdated: string;
  higherIsBetter: boolean;
  colorScale: { low: string; mid: string; high: string };
}
