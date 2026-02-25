import { createAdminClient } from './supabase';

/**
 * Normalize values to scores using percentile-clipped min-max (2nd-98th percentile).
 * Ported from scripts/ingest/lib/utils.ts for use in API routes.
 */
export function normalizeToScore(
  value: number,
  allValues: number[],
  higherIsBetter: boolean
): number {
  if (allValues.length === 0) return 50;

  const sorted = [...allValues].sort((a, b) => a - b);
  const p2Index = Math.floor(sorted.length * 0.02);
  const p98Index = Math.floor(sorted.length * 0.98);

  const p2 = sorted[p2Index];
  const p98 = sorted[p98Index];

  if (p98 === p2) return 50;

  let score = ((value - p2) / (p98 - p2)) * 100;
  score = Math.max(0, Math.min(100, score));

  return higherIsBetter ? Math.round(score) : Math.round(100 - score);
}

/**
 * Calculate national ranks for values.
 */
export function calculateRanks(
  values: Map<string, number>,
  higherIsBetter: boolean
): Map<string, number> {
  const entries = Array.from(values.entries());

  entries.sort((a, b) => {
    return higherIsBetter ? b[1] - a[1] : a[1] - b[1];
  });

  const ranks = new Map<string, number>();
  entries.forEach(([code], index) => {
    ranks.set(code, index + 1);
  });

  return ranks;
}

export interface CriterionRecord {
  commune_code: string;
  criterion_id: string;
  value: number;
  score: number;
  rank_national: number;
  source: string;
  source_date: string;
}

/**
 * Batch upsert criterion values into database.
 */
export async function upsertCriterionValues(
  records: CriterionRecord[],
  batchSize: number = 500
): Promise<{ inserted: number; errors: number; sampleErrors: string[] }> {
  const supabase = createAdminClient();
  let inserted = 0;
  let errors = 0;
  const sampleErrors: string[] = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const { error } = await supabase.from('criterion_values').upsert(
      batch.map((r) => ({
        commune_code: r.commune_code,
        criterion_id: r.criterion_id,
        value: r.value,
        score: r.score,
        rank_national: r.rank_national,
        source: r.source,
        source_date: r.source_date,
      })),
      { onConflict: 'commune_code,criterion_id' }
    );

    if (error) {
      errors += batch.length;
      if (sampleErrors.length < 5) {
        sampleErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      }
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors, sampleErrors };
}
