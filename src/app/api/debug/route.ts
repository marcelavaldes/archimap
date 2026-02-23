import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

export async function GET() {
  const supabase = await createClient();

  // Count total criterion_values
  const { count: totalCount } = await supabase
    .from('criterion_values')
    .select('*', { count: 'exact', head: true });

  // Get sample rows
  const { data: sample, error: sampleError } = await supabase
    .from('criterion_values')
    .select('commune_code, criterion_id, value, score')
    .limit(5);

  // Get distinct criterion_ids
  const { data: criterionIds } = await supabase
    .from('criterion_values')
    .select('criterion_id')
    .limit(100);

  const uniqueCriteria = [...new Set(criterionIds?.map(r => r.criterion_id) || [])];

  // Get distinct commune_codes (sample)
  const { data: communeCodes } = await supabase
    .from('criterion_values')
    .select('commune_code')
    .limit(20);

  const sampleCommuneCodes = [...new Set(communeCodes?.map(r => r.commune_code) || [])];

  // Check if a specific commune has data
  const testCode = sampleCommuneCodes[0] || '34172';
  const { data: testData, error: testError } = await supabase
    .from('criterion_values')
    .select('criterion_id, value, score, rank_national')
    .eq('commune_code', testCode);

  // Check what the geo endpoint would look for
  const { data: geoSample } = await supabase.rpc('get_geojson_by_level', {
    p_level: 'commune',
    p_parent_code: '34',
  });

  const geoFeatureIds = geoSample?.features?.slice(0, 5).map((f: any) => ({
    id: f.id,
    code: f.properties?.code,
  })) || [];

  // Cross-check: do any geo feature IDs match criterion_values commune_codes?
  const geoIds = geoSample?.features?.map((f: any) => f.id) || [];
  const { data: matchData, error: matchError } = await supabase
    .from('criterion_values')
    .select('commune_code, criterion_id')
    .in('commune_code', geoIds.slice(0, 100))
    .limit(10);

  return NextResponse.json({
    criterion_values_total: totalCount,
    sample_rows: sample,
    sample_error: sampleError,
    unique_criteria: uniqueCriteria,
    sample_commune_codes: sampleCommuneCodes,
    test_commune: testCode,
    test_commune_data: testData,
    test_commune_error: testError,
    geo_feature_id_samples: geoFeatureIds,
    geo_vs_criterion_match: matchData,
    geo_vs_criterion_error: matchError,
  });
}
