import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// NOT edge - use Node runtime for longer timeout
// export const runtime = 'edge';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { secret, dept } = body;

  if (secret !== 'archimap-seed-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Direct Supabase client (no cookies needed for seed)
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const deptCode = dept || '34';

  // Get communes for this département
  const { data: communes, error: communeError } = await supabase
    .from('communes')
    .select('code')
    .eq('code_departement', deptCode);

  if (communeError || !communes?.length) {
    return NextResponse.json({
      error: 'No communes found',
      dept: deptCode,
      details: communeError?.message,
    }, { status: 500 });
  }

  // Criteria ranges
  const criteriaRanges: Record<string, { min: number; max: number }> = {
    temperature: { min: 8, max: 16 },
    sunshine: { min: 1600, max: 2800 },
    rainfall: { min: 500, max: 1500 },
    propertyPrice: { min: 800, max: 4500 },
    localTax: { min: 15, max: 55 },
    hospitalAccess: { min: 5, max: 90 },
    publicTransport: { min: 0, max: 100 },
    internetSpeed: { min: 5, max: 500 },
    crimeRate: { min: 1, max: 25 },
    culturalVenues: { min: 0, max: 15 },
    employmentRate: { min: 40, max: 80 },
    medianIncome: { min: 15000, max: 35000 },
  };

  function seededRandom(seed: string, offset: number): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }
    h = ((h + offset) * 2654435761) | 0;
    return ((h >>> 0) % 10000) / 10000;
  }

  // Build all rows
  const rows: {
    commune_code: string;
    criterion_id: string;
    value: number;
    score: number;
    rank_national: number;
    source: string;
    source_date: string;
  }[] = [];

  for (const commune of communes) {
    let idx = 0;
    for (const [criterionId, range] of Object.entries(criteriaRanges)) {
      const rand = seededRandom(commune.code, idx);
      rows.push({
        commune_code: commune.code,
        criterion_id: criterionId,
        value: Math.round((range.min + rand * (range.max - range.min)) * 100) / 100,
        score: Math.round(rand * 100),
        rank_national: Math.floor(rand * 35000) + 1,
        source: 'demo-seed',
        source_date: '2025-01-01',
      });
      idx++;
    }
  }

  // Upsert in batches of 500
  let inserted = 0;
  const BATCH = 500;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('criterion_values').upsert(batch, {
      onConflict: 'commune_code,criterion_id',
    });
    if (error) {
      return NextResponse.json({
        error: 'Upsert failed',
        dept: deptCode,
        details: error.message,
        inserted,
        failedAtBatch: i,
      }, { status: 500 });
    }
    inserted += batch.length;
  }

  return NextResponse.json({
    dept: deptCode,
    communes: communes.length,
    criteria: Object.keys(criteriaRanges).length,
    totalRows: inserted,
  });
}
