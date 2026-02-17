/**
 * Property Prices (Prix Immobilier) Ingestion Script
 *
 * Source: DVF (Demandes de Valeurs Foncières) via api.cquest.org
 * API: REST API by Christian Quest
 *
 * Fetches real estate transactions and calculates median price per m²
 * (higherIsBetter: false - lower price is more affordable)
 *
 * Usage: bun run scripts/ingest/ingest-property-prices.ts
 *
 * Note: This script can be slow as it fetches per-commune data.
 * Consider running for specific departments or limiting to recent data.
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

const CRITERION_ID = 'propertyPrice';
const SOURCE = 'DVF - data.gouv.fr';
const HIGHER_IS_BETTER = false;

// API configuration
const BASE_URL = 'http://api.cquest.org/dvf';

interface DVFTransaction {
  valeur_fonciere: number;
  surface_reelle_bati: number | null;
  type_local: string | null;
  date_mutation: string;
}

interface DVFResponse {
  resultats: DVFTransaction[];
  nb_resultats: number;
}

async function getCommuneCodes(): Promise<string[]> {
  console.log('Fetching commune codes from database...');

  const { data, error } = await supabase
    .from('communes')
    .select('code')
    .order('code');

  if (error) {
    console.error('Error fetching communes:', error.message);
    return [];
  }

  return data?.map((row) => row.code) || [];
}

function calculateMedianPricePerSqm(transactions: DVFTransaction[]): number | null {
  // Filter to valid transactions (apartments and houses with surface)
  const validTransactions = transactions.filter(
    (t) =>
      t.valeur_fonciere > 0 &&
      t.surface_reelle_bati &&
      t.surface_reelle_bati > 0 &&
      (t.type_local === 'Appartement' || t.type_local === 'Maison')
  );

  if (validTransactions.length < 3) {
    // Need at least 3 transactions for reliable median
    return null;
  }

  // Calculate price per m² for each transaction
  const pricesPerSqm = validTransactions.map(
    (t) => t.valeur_fonciere / t.surface_reelle_bati!
  );

  // Sort and get median
  pricesPerSqm.sort((a, b) => a - b);
  const mid = Math.floor(pricesPerSqm.length / 2);

  if (pricesPerSqm.length % 2 === 0) {
    return (pricesPerSqm[mid - 1] + pricesPerSqm[mid]) / 2;
  } else {
    return pricesPerSqm[mid];
  }
}

async function fetchPropertyPrices(
  communeCodes: string[]
): Promise<Map<string, number>> {
  console.log(`Fetching property prices for ${communeCodes.length} communes...`);

  const prices = new Map<string, number>();
  let processed = 0;
  let withData = 0;
  let errors = 0;

  for (const code of communeCodes) {
    try {
      // Note: The API uses code_commune parameter
      const url = `${BASE_URL}?code_commune=${code}`;
      const response = await fetchWithRetry(url);

      // Handle different response types
      const text = await response.text();
      if (!text || text.trim() === '' || text === '[]') {
        // No data for this commune
        processed++;
        continue;
      }

      let data: DVFResponse;
      try {
        data = JSON.parse(text);
      } catch {
        // Sometimes returns array directly
        const arr = JSON.parse(text);
        data = { resultats: arr, nb_resultats: arr.length };
      }

      const transactions = data.resultats || [];

      if (transactions.length > 0) {
        const medianPrice = calculateMedianPricePerSqm(transactions);
        if (medianPrice !== null) {
          prices.set(code, Math.round(medianPrice));
          withData++;
        }
      }
    } catch (error) {
      // Log error but continue
      errors++;
      if (errors <= 10) {
        console.error(`  Error for commune ${code}:`, (error as Error).message);
      } else if (errors === 11) {
        console.error(`  ... suppressing further errors`);
      }
    }

    processed++;

    // Progress update every 50 communes
    if (processed % 50 === 0 || processed === communeCodes.length) {
      console.log(
        `  ${progressBar(processed, communeCodes.length)} - ${withData} with prices, ${errors} errors`
      );
    }

    // Rate limiting - be gentle with the API
    await sleep(200);
  }

  return prices;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ArchiMap - Property Prices (Prix Immobilier)');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Note: This script fetches data per commune and may take');
  console.log('several minutes to complete.\n');

  // Step 1: Get commune codes from database
  console.log('Step 1: Fetching commune codes...');
  const communeCodes = await getCommuneCodes();
  console.log(`  Found ${communeCodes.length} communes\n`);

  // Step 2: Fetch property prices from API
  console.log('Step 2: Fetching property prices from DVF API...');
  const prices = await fetchPropertyPrices(communeCodes);
  console.log(`\n  Found prices for ${prices.size} communes\n`);

  if (prices.size === 0) {
    console.log('No price data found. Exiting.');
    process.exit(1);
  }

  // Step 3: Calculate scores and ranks
  console.log('Step 3: Calculating scores and ranks...');
  const allValues = Array.from(prices.values());
  const ranks = calculateRanks(prices, HIGHER_IS_BETTER);

  const records: CriterionRecord[] = [];
  const sourceDate = new Date().toISOString().split('T')[0];

  for (const [code, value] of prices) {
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
    console.log(
      `    ${r.commune_code}: ${r.value} €/m² → score ${r.score}, rank #${r.rank_national}`
    );
  });

  // Stats
  const values = records.map((r) => r.value);
  const minPrice = Math.min(...values);
  const maxPrice = Math.max(...values);
  const avgPrice = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`\n  Price stats: min=${minPrice}€, max=${maxPrice}€, avg=${Math.round(avgPrice)}€`);

  // Step 4: Upsert to database
  console.log('\nStep 4: Upserting to database...');
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
