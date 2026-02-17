/**
 * Internet Speed Ingestion Script
 *
 * Source: ARCEP - Ma Connexion Internet
 * Data: Commune-level broadband eligibility statistics
 *
 * Calculates percentage of premises with 100+ Mbps connectivity
 * (higherIsBetter: true - faster internet is better)
 *
 * Usage: bun run scripts/ingest/ingest-internet-speed.ts
 */

import {
  supabase,
  normalizeToScore,
  calculateRanks,
  upsertCriterionValues,
  fetchWithRetry,
  type CriterionRecord,
} from './lib/utils';

const CRITERION_ID = 'internetSpeed';
const SOURCE = 'ARCEP - Ma Connexion Internet';
const HIGHER_IS_BETTER = true;

// Data source
const CSV_URL = 'https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune/commune_debit.csv';

interface SpeedRecord {
  code_insee: string;
  nom_com: string;
  nbr: number; // Total premises
  elig_thd100: number; // Premises eligible for 100+ Mbps
}

function parseCSVLine(line: string, headers: string[]): Record<string, string> {
  const values = line.split(';');
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index] || '';
  });
  return record;
}

async function fetchInternetData(): Promise<Map<string, number>> {
  console.log('Downloading internet speed data from ARCEP...');
  console.log(`URL: ${CSV_URL}`);

  const response = await fetchWithRetry(CSV_URL);
  const csvText = await response.text();

  console.log('Parsing CSV data...');

  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(';');

  // Find column indices
  const codeIdx = headers.indexOf('code_insee');
  const nbrIdx = headers.indexOf('nbr');
  const thd100Idx = headers.indexOf('elig_thd100');
  const typeIdx = headers.indexOf('type');

  if (codeIdx === -1 || nbrIdx === -1 || thd100Idx === -1) {
    throw new Error('Required columns not found in CSV');
  }

  const speeds = new Map<string, number>();
  let processed = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';');

    // Only process 'all' type records (not filtered by technology)
    if (typeIdx !== -1 && values[typeIdx] !== 'all') {
      skipped++;
      continue;
    }

    const code = values[codeIdx];
    const nbr = parseInt(values[nbrIdx], 10);
    const thd100 = parseInt(values[thd100Idx], 10);

    if (code && !isNaN(nbr) && nbr > 0 && !isNaN(thd100)) {
      // Calculate percentage of premises with 100+ Mbps
      const percentage = (thd100 / nbr) * 100;
      speeds.set(code, Math.round(percentage * 10) / 10); // Round to 1 decimal
      processed++;
    }
  }

  console.log(`  Processed ${processed} communes (skipped ${skipped} non-'all' records)`);

  return speeds;
}

async function getCommuneCodes(): Promise<Set<string>> {
  console.log('Fetching commune codes from database...');

  const codes = new Set<string>();

  const { data, error } = await supabase.from('communes').select('code');

  if (error) {
    console.error('Error fetching communes:', error.message);
    return codes;
  }

  data?.forEach((row) => codes.add(row.code));
  return codes;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ArchiMap - Internet Speed (Débit Internet)');
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Fetch valid commune codes
  console.log('Step 1: Fetching valid commune codes...');
  const validCodes = await getCommuneCodes();
  console.log(`  Found ${validCodes.size} communes in database\n`);

  // Step 2: Download and parse ARCEP data
  console.log('Step 2: Downloading internet speed data...');
  const speeds = await fetchInternetData();
  console.log(`  Found data for ${speeds.size} communes\n`);

  // Step 3: Filter to valid communes
  console.log('Step 3: Filtering to valid communes...');
  const filteredSpeeds = new Map<string, number>();
  let skipped = 0;

  for (const [code, speed] of speeds) {
    if (validCodes.has(code)) {
      filteredSpeeds.set(code, speed);
    } else {
      skipped++;
    }
  }
  console.log(`  Matched ${filteredSpeeds.size} communes (skipped ${skipped} not in database)\n`);

  if (filteredSpeeds.size === 0) {
    console.log('No matching communes found. Exiting.');
    process.exit(1);
  }

  // Step 4: Calculate scores and ranks
  console.log('Step 4: Calculating scores and ranks...');
  const allValues = Array.from(filteredSpeeds.values());
  const ranks = calculateRanks(filteredSpeeds, HIGHER_IS_BETTER);

  const records: CriterionRecord[] = [];
  const sourceDate = new Date().toISOString().split('T')[0];

  for (const [code, value] of filteredSpeeds) {
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
      `    ${r.commune_code}: ${r.value}% at 100+ Mbps → score ${r.score}, rank #${r.rank_national}`
    );
  });

  // Stats
  const scores = records.map((r) => r.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  const values = records.map((r) => r.value);
  const avgCoverage = values.reduce((a, b) => a + b, 0) / values.length;

  console.log(`\n  Score stats: min=${minScore}, max=${maxScore}, avg=${avgScore.toFixed(1)}`);
  console.log(`  Coverage: avg ${avgCoverage.toFixed(1)}% of premises have 100+ Mbps`);

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
