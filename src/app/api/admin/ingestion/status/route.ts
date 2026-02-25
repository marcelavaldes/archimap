import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ingestion/status — Status of API-type criteria
 */
export async function GET(request: NextRequest) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  try {
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
