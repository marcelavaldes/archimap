import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/admin/criteria — List all criteria with coverage stats
 */
export async function GET(request: NextRequest) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  try {
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
      coverage: coverageMap.get(c.id) ?? {
        communes_with_data: 0,
        total_communes: 0,
        coverage_percent: 0,
        oldest_data: null,
        newest_data: null,
      },
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
  const authError = verifyAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('criteria')
      .insert({
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
      })
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
