/**
 * Ingestion runner functions for each API-based criterion.
 * Ported from scripts/ingest/ for inline execution in API routes.
 */

import { createAdminClient } from './supabase';
import {
  normalizeToScore,
  calculateRanks,
  upsertCriterionValues,
  type CriterionRecord,
} from './scoring';

export type LogFn = (message: string) => void;

export interface IngestionResult {
  inserted: number;
  errors: number;
  communes: number;
}

// --- Shared utilities ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;

      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) * 1000;
        await sleep(waitTime);
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await sleep(Math.pow(2, attempt) * 500);
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

async function getCommuneCodes(): Promise<Set<string>> {
  const supabase = createAdminClient();
  const codes = new Set<string>();
  const { data, error } = await supabase.from('communes').select('code');
  if (error) throw new Error(`Error fetching communes: ${error.message}`);
  data?.forEach((row) => codes.add(row.code));
  return codes;
}

function buildRecords(
  values: Map<string, number>,
  criterionId: string,
  source: string,
  higherIsBetter: boolean
): CriterionRecord[] {
  const allValues = Array.from(values.values());
  const ranks = calculateRanks(values, higherIsBetter);
  const sourceDate = new Date().toISOString().split('T')[0];
  const records: CriterionRecord[] = [];

  for (const [code, value] of values) {
    records.push({
      commune_code: code,
      criterion_id: criterionId,
      value,
      score: normalizeToScore(value, allValues, higherIsBetter),
      rank_national: ranks.get(code) || 0,
      source,
      source_date: sourceDate,
    });
  }

  return records;
}

// --- Cultural Venues ---

async function ingestCulturalVenues(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'culturalVenues';
  const SOURCE = 'Ministère de la Culture - Basilic';
  const HIGHER_IS_BETTER = true;
  const BASE_URL = 'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-des-lieux-et-des-equipements-culturels/records';
  const BATCH_SIZE = 100;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Fetching cultural venues from API...');
  const venueCounts = new Map<string, number>();
  let offset = 0;
  let totalCount = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(BASE_URL);
    url.searchParams.set('select', 'code_insee,nom,type_equipement_ou_lieu');
    url.searchParams.set('limit', BATCH_SIZE.toString());
    url.searchParams.set('offset', offset.toString());

    const response = await fetchWithRetry(url.toString());
    const data = await response.json();

    if (offset === 0) {
      totalCount = data.total_count;
      log(`  Total venues to fetch: ${totalCount}`);
    }

    for (const record of data.results) {
      if (record.code_insee) {
        venueCounts.set(record.code_insee, (venueCounts.get(record.code_insee) || 0) + 1);
      }
    }

    offset += data.results.length;
    hasMore = offset < totalCount && data.results.length > 0;

    if (offset % 500 === 0 || !hasMore) {
      const pct = Math.round((offset / totalCount) * 100);
      log(`  Progress: ${offset}/${totalCount} (${pct}%) — ${venueCounts.size} communes with venues`);
    }

    await sleep(50);
  }

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const code of validCodes) {
    filtered.set(code, venueCounts.get(code) || 0);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);
  const nonZero = records.filter((r) => r.value > 0).length;
  log(`  ${nonZero} communes with at least 1 venue`);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// --- Local Tax ---

async function ingestLocalTax(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'localTax';
  const SOURCE = 'DGFiP - Fiscalité Locale';
  const HIGHER_IS_BETTER = false;
  const BASE_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records';
  const BATCH_SIZE = 100;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Fetching tax data from API...');

  // Get latest year
  const yearUrl = `${BASE_URL}?select=exercice&group_by=exercice&order_by=exercice DESC&limit=1`;
  const yearResponse = await fetchWithRetry(yearUrl);
  const yearData = await yearResponse.json();
  const latestYear = yearData.results?.[0]?.exercice || '2023';
  log(`  Using data for year: ${latestYear}`);

  const taxRates = new Map<string, number>();
  let offset = 0;
  let totalCount = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(BASE_URL);
    url.searchParams.set('select', 'insee_com,libcom,taux_global_tfb');
    url.searchParams.set('where', `exercice="${latestYear}"`);
    url.searchParams.set('limit', BATCH_SIZE.toString());
    url.searchParams.set('offset', offset.toString());
    url.searchParams.set('order_by', 'insee_com');

    const response = await fetchWithRetry(url.toString());
    const data = await response.json();

    if (offset === 0) {
      totalCount = data.total_count;
      log(`  Total records to fetch: ${totalCount}`);
    }

    for (const record of data.results) {
      if (record.insee_com && record.taux_global_tfb !== null) {
        taxRates.set(record.insee_com, record.taux_global_tfb);
      }
    }

    offset += data.results.length;
    hasMore = offset < totalCount && data.results.length > 0;

    if (offset % 500 === 0 || !hasMore) {
      const pct = Math.round((offset / totalCount) * 100);
      log(`  Progress: ${offset}/${totalCount} (${pct}%) — ${taxRates.size} communes with data`);
    }

    await sleep(50);
  }

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, rate] of taxRates) {
    if (validCodes.has(code)) filtered.set(code, rate);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// --- Internet Speed ---

async function ingestInternetSpeed(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'internetSpeed';
  const SOURCE = 'ARCEP - Ma Connexion Internet';
  const HIGHER_IS_BETTER = true;
  const CSV_URL = 'https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune/commune_debit.csv';

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Downloading internet speed data from ARCEP...');
  const response = await fetchWithRetry(CSV_URL);
  const csvText = await response.text();
  log(`  Downloaded ${(csvText.length / 1024).toFixed(0)} KB`);

  log('  Parsing CSV...');
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(';');

  const codeIdx = headers.indexOf('code_insee');
  const nbrIdx = headers.indexOf('nbr');
  const thd100Idx = headers.indexOf('elig_thd100');
  const typeIdx = headers.indexOf('type');

  if (codeIdx === -1 || nbrIdx === -1 || thd100Idx === -1) {
    throw new Error('Required columns not found in CSV');
  }

  const speeds = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';');
    if (typeIdx !== -1 && values[typeIdx] !== 'all') continue;

    const code = values[codeIdx];
    const nbr = parseInt(values[nbrIdx], 10);
    const thd100 = parseInt(values[thd100Idx], 10);

    if (code && !isNaN(nbr) && nbr > 0 && !isNaN(thd100)) {
      speeds.set(code, Math.round(((thd100 / nbr) * 100) * 10) / 10);
    }
  }
  log(`  Parsed ${speeds.size} communes from CSV`);

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, speed] of speeds) {
    if (validCodes.has(code)) filtered.set(code, speed);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// --- Property Prices ---

async function ingestPropertyPrice(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'propertyPrice';
  const SOURCE = 'DVF - data.gouv.fr';
  const HIGHER_IS_BETTER = false;
  const BASE_URL = 'http://api.cquest.org/dvf';

  log('Step 1: Fetching commune codes...');
  const supabase = createAdminClient();
  const { data: communes, error } = await supabase
    .from('communes')
    .select('code')
    .order('code');

  if (error) throw new Error(`Error fetching communes: ${error.message}`);
  const communeCodes = communes?.map((r) => r.code) || [];
  log(`  ${communeCodes.length} communes in database`);

  log('Step 2: Fetching property prices from DVF API...');
  log('  Note: This fetches per-commune and may take a while');

  const prices = new Map<string, number>();
  let processed = 0;
  let withData = 0;
  let errors = 0;

  for (const code of communeCodes) {
    try {
      const url = `${BASE_URL}?code_commune=${code}`;
      const response = await fetchWithRetry(url);
      const text = await response.text();

      if (text && text.trim() !== '' && text !== '[]') {
        let transactions;
        try {
          const parsed = JSON.parse(text);
          transactions = parsed.resultats || parsed;
        } catch {
          transactions = [];
        }

        if (Array.isArray(transactions) && transactions.length > 0) {
          const valid = transactions.filter(
            (t: { valeur_fonciere: number; surface_reelle_bati: number | null; type_local: string | null }) =>
              t.valeur_fonciere > 0 &&
              t.surface_reelle_bati &&
              t.surface_reelle_bati > 0 &&
              (t.type_local === 'Appartement' || t.type_local === 'Maison')
          );

          if (valid.length >= 3) {
            const pricesPerSqm = valid
              .map((t: { valeur_fonciere: number; surface_reelle_bati: number }) =>
                t.valeur_fonciere / t.surface_reelle_bati
              )
              .sort((a: number, b: number) => a - b);

            const mid = Math.floor(pricesPerSqm.length / 2);
            const median = pricesPerSqm.length % 2 === 0
              ? (pricesPerSqm[mid - 1] + pricesPerSqm[mid]) / 2
              : pricesPerSqm[mid];

            prices.set(code, Math.round(median));
            withData++;
          }
        }
      }
    } catch {
      errors++;
    }

    processed++;

    if (processed % 100 === 0 || processed === communeCodes.length) {
      const pct = Math.round((processed / communeCodes.length) * 100);
      log(`  Progress: ${processed}/${communeCodes.length} (${pct}%) — ${withData} with prices, ${errors} errors`);
    }

    await sleep(150);
  }

  log(`  Found prices for ${prices.size} communes`);

  if (prices.size === 0) {
    throw new Error('No price data found');
  }

  log('Step 3: Calculating scores and ranks...');
  const records = buildRecords(prices, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 4: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: prices.size };
}

// --- Registry ---

export const ingestionRunners: Record<string, (log: LogFn) => Promise<IngestionResult>> = {
  culturalVenues: ingestCulturalVenues,
  localTax: ingestLocalTax,
  internetSpeed: ingestInternetSpeed,
  propertyPrice: ingestPropertyPrice,
};
