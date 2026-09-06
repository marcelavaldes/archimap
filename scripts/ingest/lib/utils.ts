/**
 * Shared utilities for criterion ingestion scripts
 */

import { createClient } from '@supabase/supabase-js';

// Supabase client for ingestion scripts
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jquglrlwicryiajgfbel.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.error('Set it with: export SUPABASE_SERVICE_ROLE_KEY=your_key');
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Metropolitan France + DOM has ~34,900 communes as of 2026; INSEE mergers
 * shift that by a few dozen every January, so this is a floor, not an exact
 * figure. PostgREST caps an unbounded select at 1,000 rows by default — if
 * pagination ever regresses, the fetched count will fall far short of this
 * floor and ingestion must abort rather than silently score against a
 * fraction of the country.
 */
export const EXPECTED_MIN_COMMUNES = 30000;

/** Read every row of a paginated PostgREST query by following .range() pages until exhausted. */
async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Normalize values to scores using percentile-clipped min-max (2nd-98th percentile)
 * This handles outliers by clipping extreme values
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

  // Avoid division by zero
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
 * Kept in sync with src/lib/admin/scoring.ts's calculateRanks().
 */
export function calculateRanks(
  values: Map<string, number>,
  higherIsBetter: boolean
): Map<string, number> {
  const entries = Array.from(values.entries());

  // Sort by value (descending if higherIsBetter, ascending otherwise)
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
 * Batch upsert criterion values into database
 */
export async function upsertCriterionValues(
  records: CriterionRecord[],
  batchSize: number = 500
): Promise<{ inserted: number; errors: number }> {
  let inserted = 0;
  let errors = 0;

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
      console.error(`Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }

    // Progress indicator
    if ((i / batchSize) % 10 === 0) {
      console.log(`  Progress: ${i + batch.length}/${records.length}`);
    }
  }

  return { inserted, errors };
}

/**
 * Get all commune codes from database
 */
export async function getCommuneCodes(): Promise<Set<string>> {
  // .order('code') is load-bearing, not cosmetic: offset pagination over an
  // unordered query has no stable row order, so a row can be returned on two
  // pages and another skipped entirely. Ordering by the primary key gives the
  // 35 .range() calls one consistent sequence to walk.
  const rows = await fetchAllRows<{ code: string }>((from, to) =>
    supabase.from('communes').select('code').order('code').range(from, to)
  );

  // Count distinct codes, not rows returned. A duplicate row would otherwise
  // pad the total and let a reference set that is missing communes slip past
  // the guard below.
  const codes = new Set<string>();
  rows.forEach((row) => codes.add(row.code));

  if (codes.size < EXPECTED_MIN_COMMUNES) {
    throw new Error(
      `Commune count too low: fetched ${codes.size} distinct codes, expected at least ${EXPECTED_MIN_COMMUNES}. ` +
        `Refusing to ingest against a truncated reference population — check pagination and the communes table.`
    );
  }

  return codes;
}

/**
 * Fetch with retry for API calls
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      // If rate limited, wait and retry
      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`  Rate limited, waiting ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 500;
        console.log(`  Retry ${attempt}/${maxRetries} after ${waitTime}ms...`);
        await sleep(waitTime);
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format progress bar for console
 */
export function progressBar(current: number, total: number, width: number = 40): string {
  const percentage = current / total;
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${Math.round(percentage * 100)}%`;
}
