/**
 * Cultural Venues Ingestion Script
 *
 * Source: Ministère de la Culture - Basilic Database
 * API: OpenDataSoft REST API
 *
 * Counts cultural venues per commune and calculates density per 10,000 inhabitants.
 * (higherIsBetter: true - more cultural venues is better)
 *
 * Usage: bun run scripts/ingest/ingest-cultural-venues.ts
 */

import {
  supabase,
  normalizeToScore,
  calculateRanks,
  upsertCriterionValues,
  fetchWithRetry,
  sleep,
  progressBar,
  type CriterionRecord,
} from './lib/utils';

const CRITERION_ID = 'culturalVenues';
const SOURCE = 'Ministère de la Culture - Basilic';
const HIGHER_IS_BETTER = true;

// API configuration
const BASE_URL = 'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-des-lieux-et-des-equipements-culturels/records';
const BATCH_SIZE = 100;

interface CulturalVenueRecord {
  code_insee: string;
  nom: string;
  type_equipement_ou_lieu: string;
}

interface APIResponse {
  total_count: number;
  results: CulturalVenueRecord[];
}

async function getCommuneCodes(): Promise<Set<string>> {
  console.log('Fetching commune codes from database...');

  const codes = new Set<string>();

  const { data, error } = await supabase
    .from('communes')
    .select('code');

  if (error) {
    console.error('Error fetching communes:', error.message);
    return codes;
  }

  data?.forEach((row: { code: string }) => {
    codes.add(row.code);
  });

  return codes;
}

async function fetchCulturalVenues(): Promise<Map<string, number>> {
  console.log('Fetching cultural venues from API...');

  const venueCounts = new Map<string, number>();
  let offset = 0;
  let totalCount = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(BASE_URL);
    url.searchParams.set('select', 'code_insee,nom,type_equipement_ou_lieu');
    url.searchParams.set('limit', BATCH_SIZE.toString());
    url.searchParams.set('offset', offset.toString());

    try {
      const response = await fetchWithRetry(url.toString());
      const data: APIResponse = await response.json();

      if (offset === 0) {
        totalCount = data.total_count;
        console.log(`Total venues to fetch: ${totalCount}`);
      }

      for (const record of data.results) {
        if (record.code_insee) {
          const currentCount = venueCounts.get(record.code_insee) || 0;
          venueCounts.set(record.code_insee, currentCount + 1);
        }
      }

      offset += data.results.length;
      hasMore = offset < totalCount && data.results.length > 0;

      // Progress update
      if (offset % 1000 === 0 || !hasMore) {
        console.log(`  ${progressBar(offset, totalCount)} - ${venueCounts.size} communes with venues`);
      }

      // Rate limiting
      await sleep(100);
    } catch (error) {
      console.error(`Error fetching at offset ${offset}:`, error);
      hasMore = false;
    }
  }

  return venueCounts;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ArchiMap - Cultural Venues (Équipements Culturels)');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Get valid commune codes from database
  console.log('Step 1: Fetching valid commune codes...');
  const validCodes = await getCommuneCodes();
  console.log(`  Found ${validCodes.size} communes in database\n`);

  // Step 2: Fetch cultural venues from API
  console.log('Step 2: Fetching cultural venues from API...');
  const venueCounts = await fetchCulturalVenues();
  console.log(`  Found venues in ${venueCounts.size} communes\n`);

  // Step 3: Filter to valid communes and include zeros for communes without venues
  console.log('Step 3: Filtering to valid communes...');
  const filteredCounts = new Map<string, number>();

  for (const code of validCodes) {
    const count = venueCounts.get(code) || 0;
    filteredCounts.set(code, count);
  }
  console.log(`  Matched ${filteredCounts.size} communes\n`);

  if (filteredCounts.size === 0) {
    console.log('No matching communes found. Exiting.');
    process.exit(1);
  }

  // Step 4: Calculate scores and ranks
  // Note: Using raw counts instead of density (population data not available)
  console.log('Step 4: Calculating scores and ranks...');
  console.log('  Note: Using raw venue counts (population data not available)');
  const allValues = Array.from(filteredCounts.values());
  const ranks = calculateRanks(filteredCounts, HIGHER_IS_BETTER);

  const records: CriterionRecord[] = [];
  const sourceDate = new Date().toISOString().split('T')[0];

  for (const [code, value] of filteredCounts) {
    const score = normalizeToScore(value, allValues, HIGHER_IS_BETTER);
    const rank = ranks.get(code) || 0;

    records.push({
      commune_code: code,
      criterion_id: CRITERION_ID,
      value,
      score,
      rank_national: rank,
      source: SOURCE,
      source_date: sourceDate,
    });
  }

  // Display sample data
  console.log('\n  Sample data (communes with venues, first 5):');
  const withVenues = records.filter((r) => r.value > 0).slice(0, 5);
  withVenues.forEach((r) => {
    console.log(`    ${r.commune_code}: ${r.value} venues → score ${r.score}, rank #${r.rank_national}`);
  });

  // Stats
  const scores = records.map((r) => r.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const nonZeroCount = records.filter((r) => r.value > 0).length;
  console.log(`\n  Score stats: min=${minScore}, max=${maxScore}, avg=${avgScore.toFixed(1)}`);
  console.log(`  Communes with at least 1 venue: ${nonZeroCount}`);

  // Step 5: Upsert to database
  console.log('\nStep 5: Upserting to database...');
  const { inserted, errors } = await upsertCriterionValues(records);

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  COMPLETE`);
  console.log(`  - Inserted: ${inserted} records`);
  console.log(`  - Errors: ${errors}`);
  console.log(`  - Criterion: ${CRITERION_ID}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  // Verify
  const { count } = await supabase
    .from('criterion_values')
    .select('*', { count: 'exact', head: true })
    .eq('criterion_id', CRITERION_ID);

  console.log(`Verification: ${count} total records for ${CRITERION_ID} in database`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
