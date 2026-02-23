import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

type AdminLevel = 'regions' | 'departements' | 'communes';

const VALID_LEVELS: AdminLevel[] = ['regions', 'departements', 'communes'];

// GeoJSON types for type safety
interface GeoJSONFeature {
  type: 'Feature';
  id: string;
  properties: Record<string, unknown>;
  geometry: unknown;
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

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
  const bbox = searchParams.get('bbox'); // "minLng,minLat,maxLng,maxLat"

  try {
    const supabase = await createClient();

    let data: GeoJSONFeatureCollection | null = null;

    // For communes with bbox, use optimized viewport function
    if (level === 'communes' && bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);

      if ([minLng, minLat, maxLng, maxLat].some(isNaN)) {
        return NextResponse.json(
          { error: 'Invalid bbox format. Expected: minLng,minLat,maxLng,maxLat' },
          { status: 400 }
        );
      }

      const { data: viewportData, error } = await supabase.rpc('get_communes_in_viewport', {
        min_lng: minLng,
        min_lat: minLat,
        max_lng: maxLng,
        max_lat: maxLat,
        p_criterion: criterionId,
      });

      if (error) {
        console.error('Viewport query error:', error);
        return NextResponse.json(
          { error: 'Failed to fetch communes in viewport' },
          { status: 500 }
        );
      }

      // Transform viewport result to GeoJSON FeatureCollection
      data = {
        type: 'FeatureCollection',
        features: (viewportData || []).map((row: {
          code: string;
          nom: string;
          geometry: unknown;
          criterion_value: number | null;
          criterion_score: number | null;
        }) => ({
          type: 'Feature' as const,
          id: row.code,
          properties: {
            code: row.code,
            nom: row.nom,
            level: 'commune',
            ...(criterionId && {
              criterionValue: row.criterion_value,
              criterionScore: row.criterion_score,
            }),
          },
          geometry: row.geometry,
        })),
      };
    }
    // For communes without bbox, require parent code to prevent timeout
    else if (level === 'communes' && !parentCode) {
      return NextResponse.json(
        { error: 'Communes level requires either "parent" (departement code) or "bbox" parameter to prevent timeout' },
        { status: 400 }
      );
    }
    // Standard path: use get_geojson_by_level function
    else {
      const { data: rpcData, error } = await supabase.rpc('get_geojson_by_level', {
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

      data = rpcData;

      // If criterion is specified, enrich with criterion values
      if (criterionId && data?.features) {
        const codes = data.features.map((f) => f.id);

        // Chunk large arrays to avoid query limits
        const CHUNK_SIZE = 500;
        const criterionMap = new Map<string, { value: number; score: number; rank_national: number }>();

        for (let i = 0; i < codes.length; i += CHUNK_SIZE) {
          const chunk = codes.slice(i, i + CHUNK_SIZE);
          const { data: criterionData, error: criterionError } = await supabase
            .from('criterion_values')
            .select('commune_code, value, score, rank_national')
            .eq('criterion_id', criterionId)
            .in('commune_code', chunk);

          if (!criterionError && criterionData) {
            criterionData.forEach((c) => criterionMap.set(c.commune_code, c));
          }
        }

        data.features = data.features.map((feature) => ({
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
