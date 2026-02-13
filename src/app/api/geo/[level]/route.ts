import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

type AdminLevel = 'regions' | 'departements' | 'communes';

const VALID_LEVELS: AdminLevel[] = ['regions', 'departements', 'communes'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ level: string }> }
) {
  const { level } = await params;

  if (!VALID_LEVELS.includes(level as AdminLevel)) {
    return NextResponse.json(
      { error: `Invalid level. Must be one of: ${VALID_LEVELS.join(', ')}` },
      { status: 400 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const parentCode = searchParams.get('parent');
  const criterionId = searchParams.get('criterion');
  const simplified = searchParams.get('simplified') === 'true';

  try {
    const supabase = await createClient();

    // Call the database function to get GeoJSON
    const { data, error } = await supabase.rpc('get_geojson_by_level', {
      p_level: level.replace(/s$/, ''), // regions -> region
      p_parent_code: parentCode,
    });

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch geographic data' },
        { status: 500 }
      );
    }

    // If criterion is specified, enrich with criterion values
    if (criterionId && data?.features) {
      const codes = data.features.map((f: { id: string }) => f.id);

      const { data: criterionData, error: criterionError } = await supabase
        .from('criterion_values')
        .select('commune_code, value, score, rank_national')
        .eq('criterion_id', criterionId)
        .in('commune_code', codes);

      if (!criterionError && criterionData) {
        const criterionMap = new Map(
          criterionData.map((c) => [c.commune_code, c])
        );

        data.features = data.features.map((feature: { id: string; properties: Record<string, unknown> }) => ({
          ...feature,
          properties: {
            ...feature.properties,
            criterionValue: criterionMap.get(feature.id)?.value,
            criterionScore: criterionMap.get(feature.id)?.score,
            criterionRank: criterionMap.get(feature.id)?.rank_national,
          },
        }));
      }
    }

    // Set cache headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

    return new NextResponse(JSON.stringify(data), { headers });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
