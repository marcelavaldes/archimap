/**
 * Local Tax (Taxe Foncière) Ingestion Script
 *
 * Source: DGFiP Fiscalité Locale via data.economie.gouv.fr
 * API: OpenDataSoft REST API
 *
 * Fetches property tax rates (TFPB) for all French communes and
 * calculates normalized scores (higherIsBetter: false - lower tax is better)
 *
 * Usage: bun run scripts/ingest/ingest-local-tax.ts
 */

import {
  supabase,
  normalizeToScore,
  calculateRanks,
  upsertCriterionValues,
  getCommuneCodes,
  fetchWithRetry,
  sleep,
  progressBar,
  type CriterionRecord,
} from './lib/utils';

const CRITERION_ID = 'localTax';
const SOURCE = 'DGFiP - Fiscalité Locale';
const HIGHER_IS_BETTER = false;

// API configuration
const BASE_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records';
const BATCH_SIZE = 100; // API limit per request

interface TaxRecord {
  insee_com: string;
  libcom: string;
  exercice: string;
  taux_global_tfb: number | null; // Total property tax rate on built properties
}

interface APIResponse {
  total_count: number;
  results: TaxRecord[];
}

async function fetchTaxData(): Promise<Map<string, number>> {
  console.log('Fetching tax data from API...');

  const taxRates = new Map<string, number>();
  let offset = 0;
  let totalCount = 0;

  // Get the most recent year first
  const yearCheckUrl = `${BASE_URL}?select=exercice&group_by=exercice&order_by=exercice DESC&limit=1`;
  const yearResponse = await fetchWithRetry(yearCheckUrl);
  const yearData = await yearResponse.json();
  const latestYear = yearData.results?.[0]?.exercice || '2023';
  console.log(`Using data for year: ${latestYear}`);

  // Fetch all records for the latest year
  let hasMore = true;

  while (hasMore) {
    const url = new URL(BASE_URL);
    url.searchParams.set('select', 'insee_com,libcom,taux_global_tfb');
    url.searchParams.set('where', `exercice="${latestYear}"`);
    url.searchParams.set('limit', BATCH_SIZE.toString());
    url.searchParams.set('offset', offset.toString());
    url.searchParams.set('order_by', 'insee_com');

    try {
      const response = await fetchWithRetry(url.toString());
      const data: APIResponse = await response.json();

      if (offset === 0) {
        totalCount = data.total_count;
        console.log(`Total records to fetch: ${totalCount}`);
      }

      for (const record of data.results) {
        if (record.insee_com && record.taux_global_tfb !== null) {
          // Store the total tax rate
          taxRates.set(record.insee_com, record.taux_global_tfb);
        }
      }

      offset += data.results.length;
      hasMore = offset < totalCount && data.results.length > 0;

      // Progress update
      if (offset % 1000 === 0 || !hasMore) {
        console.log(`  ${progressBar(offset, totalCount)} - ${taxRates.size} communes with data`);
      }

      // Rate limiting
      await sleep(100);
    } catch (error) {
      console.error(`Error fetching at offset ${offset}:`, error);
      hasMore = false;
    }
  }

  return taxRates;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ArchiMap - Local Tax (Taxe Foncière) Ingestion');
  console.log('═══════════════════════════════════════════════════\n');

  // Step 1: Get valid commune codes from database
  console.log('Step 1: Fetching valid commune codes...');
  const validCodes = await getCommuneCodes();
  console.log(`  Found ${validCodes.size} communes in database\n`);

  // Step 2: Fetch tax data from API
  console.log('Step 2: Fetching tax data from API...');
  const taxRates = await fetchTaxData();
  console.log(`  Fetched ${taxRates.size} commune tax rates\n`);

  // Step 3: Filter to valid communes only
  console.log('Step 3: Filtering to valid communes...');
  const filteredRates = new Map<string, number>();
  let skipped = 0;

  for (const [code, rate] of taxRates) {
    if (validCodes.has(code)) {
      filteredRates.set(code, rate);
    } else {
      skipped++;
    }
  }
  console.log(`  Matched ${filteredRates.size} communes (skipped ${skipped} not in database)\n`);

  if (filteredRates.size === 0) {
    console.log('No matching communes found. Exiting.');
    process.exit(1);
  }

  // Step 4: Calculate scores and ranks
  console.log('Step 4: Calculating scores and ranks...');
  const allValues = Array.from(filteredRates.values());
  const ranks = calculateRanks(filteredRates, HIGHER_IS_BETTER);

  const records: CriterionRecord[] = [];
  const sourceDate = new Date().toISOString().split('T')[0];

  for (const [code, value] of filteredRates) {
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
  console.log('\n  Sample data (first 5):');
  records.slice(0, 5).forEach((r) => {
    console.log(`    ${r.commune_code}: ${r.value}% → score ${r.score}, rank #${r.rank_national}`);
  });

  // Stats
  const scores = records.map((r) => r.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`\n  Score stats: min=${minScore}, max=${maxScore}, avg=${avgScore.toFixed(1)}`);

  // Step 5: Upsert to database
  console.log('\nStep 5: Upserting to database...');
  const { inserted, errors } = await upsertCriterionValues(records);

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  COMPLETE`);
  console.log(`  - Inserted: ${inserted} records`);
  console.log(`  - Errors: ${errors}`);
  console.log(`  - Criterion: ${CRITERION_ID}`);
  console.log(`═══════════════════════════════════════════════════\n`);

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
