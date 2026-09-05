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
 *
 * Uses competition ranking (1, 2, 2, 4): communes tied on the raw value
 * share the same rank, and the next distinct value skips ahead accordingly.
 * Assigning tied communes different ranks (the previous `index + 1`
 * behaviour) presented false precision — this is a relocation tool, and two
 * communes with an identical value should not appear as 4th and 5th.
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
  let previousValue: number | null = null;
  let previousRank = 0;
  entries.forEach(([code, value], index) => {
    const rank = value === previousValue ? previousRank : index + 1;
    ranks.set(code, rank);
    previousValue = value;
    previousRank = rank;
  });

  return ranks;
}

/**
 * Metropolitan France + DOM has ~34,900 communes as of 2026; INSEE mergers
 * shift that by a few dozen every January, so this is a floor, not an exact
 * figure. PostgREST caps an unbounded select at 1,000 rows by default — if
 * pagination ever regresses, the fetched count will fall far short of this
 * floor and ingestion must abort rather than silently score against a
 * fraction of the country.
 */
export const EXPECTED_MIN_COMMUNES = 30000;

/**
 * Guard against ingesting against a truncated commune reference set. Shared
 * by both getCommuneCodes() implementations (src/lib/admin/ingestion-runners.ts
 * and scripts/ingest/lib/utils.ts) so the pagination regression this guards
 * against only needs to be tested once.
 */
export function assertSufficientCommuneCount(
  count: number,
  min: number = EXPECTED_MIN_COMMUNES
): void {
  if (count < min) {
    throw new Error(
      `Commune count too low: fetched ${count}, expected at least ${min}. ` +
        `Refusing to ingest against a truncated reference population — check pagination and the communes table.`
    );
  }
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
