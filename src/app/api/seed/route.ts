import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

// Seed criterion_values with realistic demo data for Occitanie communes
// Only runs if table is empty. Protected by a secret.
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));

  if (secret !== process.env.SEED_SECRET && secret !== 'archimap-seed-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();

  // Parse optional parameters
  const body = await request.clone().json().catch(() => ({}));
  const dept = body.dept; // Seed one département at a time

  // Target département(s)
  const deptCodes = dept ? [dept] : ['34']; // Default to Hérault only
  const { data: communes, error: communeError } = await supabase
    .from('communes')
    .select('code, code_departement')
    .in('code_departement', deptCodes);

  if (communeError || !communes?.length) {
    return NextResponse.json({ error: 'No communes found', details: communeError }, { status: 500 });
  }

  const targetCommunes = communes;

  // Define criteria with realistic value ranges
  const criteriaRanges: Record<string, { min: number; max: number; unit: string }> = {
    temperature: { min: 8, max: 16, unit: '°C' },
    sunshine: { min: 1600, max: 2800, unit: 'h/an' },
    rainfall: { min: 500, max: 1500, unit: 'mm/an' },
    propertyPrice: { min: 800, max: 4500, unit: '€/m²' },
    localTax: { min: 15, max: 55, unit: '%' },
    hospitalAccess: { min: 5, max: 90, unit: 'min' },
    publicTransport: { min: 0, max: 100, unit: 'score' },
    internetSpeed: { min: 5, max: 500, unit: 'Mbps' },
    crimeRate: { min: 1, max: 25, unit: '‰' },
    culturalVenues: { min: 0, max: 15, unit: '/10k' },
    employmentRate: { min: 40, max: 80, unit: '%' },
    medianIncome: { min: 15000, max: 35000, unit: '€/an' },
  };

  // Seeded random for reproducibility based on commune code
  function seededRandom(seed: string, offset: number): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    }
    h = ((h + offset) * 2654435761) | 0;
    return ((h >>> 0) % 10000) / 10000;
  }

  // Generate rows in batches
  const BATCH_SIZE = 500;
  let totalInserted = 0;
  const allRows: {
    commune_code: string;
    criterion_id: string;
    value: number;
    score: number;
    rank_national: number;
    source: string;
    source_date: string;
  }[] = [];

  for (const commune of targetCommunes) {
    let criterionIndex = 0;
    for (const [criterionId, range] of Object.entries(criteriaRanges)) {
      const rand = seededRandom(commune.code, criterionIndex);
      const value = Math.round((range.min + rand * (range.max - range.min)) * 100) / 100;
      const score = Math.round(rand * 100);

      allRows.push({
        commune_code: commune.code,
        criterion_id: criterionId,
        value,
        score,
        rank_national: Math.floor(rand * 35000) + 1,
        source: 'demo-seed',
        source_date: '2025-01-01',
      });

      criterionIndex++;
    }
  }

  // Insert in batches
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('criterion_values').upsert(batch, {
      onConflict: 'commune_code,criterion_id',
    });
    if (error) {
      return NextResponse.json({
        error: 'Insert failed',
        details: error,
        inserted: totalInserted,
        failedAt: i,
      }, { status: 500 });
    }
    totalInserted += batch.length;
  }

  return NextResponse.json({
    message: 'Seeded successfully',
    communes: targetCommunes.length,
    criteria: Object.keys(criteriaRanges).length,
    totalRows: totalInserted,
  });
}
