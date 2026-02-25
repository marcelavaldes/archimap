/**
 * Ingestion runner functions for all 12 criteria.
 * Each runner fetches data from a public API/dataset, calculates scores, and upserts to DB.
 */

import { gunzipSync } from 'zlib';
import JSZip from 'jszip';
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

// ═══════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;

      if (response.status === 429) {
        await sleep(Math.pow(2, attempt) * 1000);
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

interface CommunePoint {
  code: string;
  lat: number;
  lon: number;
}

/** Fetch commune centroids from geo.api.gouv.fr */
async function getCommuneCentroids(log: LogFn): Promise<CommunePoint[]> {
  log('  Fetching commune centroids from geo.api.gouv.fr...');
  const res = await fetchWithRetry(
    'https://geo.api.gouv.fr/communes?fields=code,centre&format=json'
  );
  const communes = await res.json();
  const points: CommunePoint[] = [];

  for (const c of communes) {
    if (c.centre?.coordinates) {
      points.push({
        code: c.code,
        lon: c.centre.coordinates[0],
        lat: c.centre.coordinates[1],
      });
    }
  }

  log(`  Got centroids for ${points.length} communes`);
  return points;
}

/** Haversine distance in km */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Station {
  id: string;
  lat: number;
  lon: number;
  value: number;
}

/** Map each commune to the value of its nearest station */
function mapToNearestStation(
  communes: CommunePoint[],
  stations: Station[],
  validCodes: Set<string>
): Map<string, number> {
  const values = new Map<string, number>();

  for (const commune of communes) {
    if (!validCodes.has(commune.code)) continue;

    let minDist = Infinity;
    let nearestValue = 0;

    for (const station of stations) {
      const dist = haversine(commune.lat, commune.lon, station.lat, station.lon);
      if (dist < minDist) {
        minDist = dist;
        nearestValue = station.value;
      }
    }

    if (minDist < Infinity) {
      values.set(commune.code, nearestValue);
    }
  }

  return values;
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

/** Paginate an OpenDataSoft v2.1 API */
async function paginateODS(
  baseUrl: string,
  params: Record<string, string>,
  log: LogFn,
  batchSize = 100,
  delayMs = 50
): Promise<{ results: Record<string, unknown>[]; total: number }> {
  const allResults: Record<string, unknown>[] = [];
  let offset = 0;
  let totalCount = 0;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('limit', batchSize.toString());
    url.searchParams.set('offset', offset.toString());

    const response = await fetchWithRetry(url.toString());
    const data = await response.json();

    if (offset === 0) {
      totalCount = data.total_count;
      log(`  Total records: ${totalCount}`);
    }

    allResults.push(...data.results);
    offset += data.results.length;
    hasMore = offset < totalCount && data.results.length > 0;

    if (offset % 500 === 0 || !hasMore) {
      const pct = Math.round((offset / totalCount) * 100);
      log(`  Progress: ${offset}/${totalCount} (${pct}%)`);
    }

    await sleep(delayMs);
  }

  return { results: allResults, total: totalCount };
}

/** Download a gzipped file and return as text */
async function downloadGzipped(url: string): Promise<string> {
  const res = await fetchWithRetry(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  return gunzipSync(buffer).toString('utf-8');
}

/** Download a ZIP file and extract a specific CSV */
async function downloadZipCSV(url: string, csvPattern?: RegExp): Promise<string> {
  const res = await fetchWithRetry(url);
  const buffer = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const fileNames = Object.keys(zip.files);
  const csvFile = csvPattern
    ? fileNames.find((f) => csvPattern.test(f))
    : fileNames.find((f) => f.endsWith('.csv') || f.endsWith('.CSV'));

  if (!csvFile) throw new Error(`No CSV found in ZIP. Files: ${fileNames.join(', ')}`);

  return await zip.files[csvFile].async('string');
}

// ═══════════════════════════════════════════════════════════════
//  CLIMATE RUNNERS (nearest-station mapping)
// ═══════════════════════════════════════════════════════════════

// --- Temperature ---

async function ingestTemperature(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'temperature';
  const SOURCE = 'Météo France (SYNOP)';
  const HIGHER_IS_BETTER = true; // warmer is "better" for livability

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Fetching temperature data from SYNOP API...');
  const year = new Date().getFullYear() - 1;
  const url = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/donnees-synop-essentielles-omm/records?select=avg(tc) as avg_temp,numer_sta,nom,codegeo,latitude,longitude&group_by=numer_sta,nom,codegeo,latitude,longitude&where=date>="${year}-01-01" AND date<="${year}-12-31" AND tc is not null&limit=100`;

  const res = await fetchWithRetry(url);
  const data = await res.json();
  const stations: Station[] = [];

  for (const r of data.results || []) {
    if (r.avg_temp != null && r.latitude && r.longitude) {
      stations.push({
        id: r.numer_sta,
        lat: r.latitude,
        lon: r.longitude,
        value: Math.round(r.avg_temp * 10) / 10,
      });
    }
  }
  log(`  Got ${stations.length} stations with temperature data for ${year}`);

  log('Step 3: Mapping communes to nearest station...');
  const centroids = await getCommuneCentroids(log);
  const values = mapToNearestStation(centroids, stations, validCodes);
  log(`  Mapped ${values.size} communes`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(values, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: values.size };
}

// --- Rainfall ---

async function ingestRainfall(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'rainfall';
  const SOURCE = 'Météo France (SYNOP)';
  const HIGHER_IS_BETTER = false; // less rain is "better" for livability

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Fetching precipitation data from SYNOP API...');
  const year = new Date().getFullYear() - 1;
  // rr3 = precipitation last 3 hours. Sum over the year for annual total.
  const url = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/donnees-synop-essentielles-omm/records?select=sum(rr3) as total_precip,numer_sta,nom,codegeo,latitude,longitude&group_by=numer_sta,nom,codegeo,latitude,longitude&where=date>="${year}-01-01" AND date<="${year}-12-31" AND rr3 is not null AND rr3>=0&limit=100`;

  const res = await fetchWithRetry(url);
  const data = await res.json();
  const stations: Station[] = [];

  for (const r of data.results || []) {
    if (r.total_precip != null && r.latitude && r.longitude) {
      stations.push({
        id: r.numer_sta,
        lat: r.latitude,
        lon: r.longitude,
        value: Math.round(r.total_precip),
      });
    }
  }
  log(`  Got ${stations.length} stations with precipitation data for ${year}`);

  log('Step 3: Mapping communes to nearest station...');
  const centroids = await getCommuneCentroids(log);
  const values = mapToNearestStation(centroids, stations, validCodes);
  log(`  Mapped ${values.size} communes`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(values, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: values.size };
}

// --- Sunshine ---

async function ingestSunshine(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'sunshine';
  const SOURCE = 'Météo France - Données climatologiques';
  const HIGHER_IS_BETTER = true;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Downloading sunshine data from Météo France...');
  log('  Downloading département files (INST field = sunshine minutes/day)...');

  // Metropolitan départements: 01-19, 2A, 2B, 21-95
  const depts: string[] = [];
  for (let i = 1; i <= 19; i++) depts.push(i.toString().padStart(2, '0'));
  depts.push('2A', '2B');
  for (let i = 21; i <= 95; i++) depts.push(i.toString().padStart(2, '0'));

  const stations: Station[] = [];
  const stationSunshine = new Map<string, { totalMinutes: number; days: number; lat: number; lon: number }>();

  let downloaded = 0;
  let failed = 0;

  // Download in batches of 10
  for (let i = 0; i < depts.length; i += 10) {
    const batch = depts.slice(i, i + 10);
    const promises = batch.map(async (dept) => {
      try {
        const url = `https://object.files.data.gouv.fr/meteofrance/data/synchro_ftp/BASE/QUOT/Q_${dept}_latest-2024-2025_autres-parametres.csv.gz`;
        const text = await downloadGzipped(url);
        const lines = text.trim().split('\n');

        if (lines.length < 2) return;

        const headers = lines[0].split(';');
        const numPosteIdx = headers.indexOf('NUM_POSTE');
        const instIdx = headers.indexOf('INST');
        const latIdx = headers.indexOf('LAT');
        const lonIdx = headers.indexOf('LON');

        if (numPosteIdx === -1 || instIdx === -1) return;

        for (let j = 1; j < lines.length; j++) {
          const cols = lines[j].split(';');
          const poste = cols[numPosteIdx];
          const inst = parseFloat(cols[instIdx]);
          const lat = latIdx >= 0 ? parseFloat(cols[latIdx]) : NaN;
          const lon = lonIdx >= 0 ? parseFloat(cols[lonIdx]) : NaN;

          if (poste && !isNaN(inst) && inst >= 0) {
            const existing = stationSunshine.get(poste);
            if (existing) {
              existing.totalMinutes += inst;
              existing.days++;
            } else if (!isNaN(lat) && !isNaN(lon)) {
              stationSunshine.set(poste, { totalMinutes: inst, days: 1, lat, lon });
            }
          }
        }

        downloaded++;
      } catch {
        failed++;
      }
    });

    await Promise.all(promises);
    log(`  Downloaded ${downloaded + failed}/${depts.length} départements (${failed} failed)`);
  }

  // Calculate annual sunshine hours per station
  for (const [id, data] of stationSunshine) {
    if (data.days >= 30) { // need at least 30 days of data
      // Extrapolate to full year: (totalMinutes / days) * 365 / 60 = hours/year
      const hoursPerYear = Math.round((data.totalMinutes / data.days) * 365 / 60);
      stations.push({ id, lat: data.lat, lon: data.lon, value: hoursPerYear });
    }
  }
  log(`  ${stations.length} stations with sunshine data`);

  log('Step 3: Mapping communes to nearest station...');
  const centroids = await getCommuneCentroids(log);
  const values = mapToNearestStation(centroids, stations, validCodes);
  log(`  Mapped ${values.size} communes`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(values, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: values.size };
}

// ═══════════════════════════════════════════════════════════════
//  STATISTICAL RUNNERS (bulk CSV downloads)
// ═══════════════════════════════════════════════════════════════

// --- Crime Rate ---

async function ingestCrimeRate(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'crimeRate';
  const SOURCE = 'SSMSI - Ministère de l\'Intérieur';
  const HIGHER_IS_BETTER = false;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Finding latest crime dataset URL...');
  // Use data.gouv.fr API to get latest resource
  const datasetRes = await fetchWithRetry(
    'https://www.data.gouv.fr/api/1/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales/'
  );
  const dataset = await datasetRes.json();

  // Find the commune-level CSV (gzipped)
  const csvResource = dataset.resources?.find(
    (r: { title: string; format: string }) =>
      r.title?.toLowerCase().includes('donnee-data.gouv') &&
      r.format?.toLowerCase() === 'csv'
  );

  if (!csvResource?.url) {
    throw new Error('Crime dataset CSV not found on data.gouv.fr');
  }

  log(`  Found: ${csvResource.title}`);
  log('  Downloading gzipped CSV (this may take a moment)...');

  const text = await downloadGzipped(csvResource.url);
  log(`  Downloaded ${(text.length / 1024 / 1024).toFixed(1)} MB`);

  log('  Parsing crime data...');
  const lines = text.split('\n');
  const headers = lines[0].split(';').map((h: string) => h.replace(/"/g, ''));

  const codeIdx = headers.findIndex((h: string) => h.includes('CODGEO'));
  const yearIdx = headers.indexOf('annee');
  const rateIdx = headers.findIndex((h: string) => h.includes('taux_pour_mille'));
  const diffIdx = headers.findIndex((h: string) => h.includes('est_diffuse'));

  if (codeIdx === -1 || rateIdx === -1) {
    throw new Error(`Required columns not found. Headers: ${headers.slice(0, 8).join(', ')}`);
  }

  // Find the latest year in data
  const years = new Set<string>();
  for (let i = 1; i < Math.min(1000, lines.length); i++) {
    const cols = lines[i].split(';').map((c: string) => c.replace(/"/g, ''));
    if (yearIdx >= 0 && cols[yearIdx]) years.add(cols[yearIdx]);
  }
  const latestYear = Array.from(years).sort().pop() || '';
  log(`  Using year: ${latestYear}`);

  // Aggregate total crime rate per commune (sum of all categories)
  const crimeRates = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(';').map((c: string) => c.replace(/"/g, ''));

    const code = cols[codeIdx];
    const year = yearIdx >= 0 ? cols[yearIdx] : latestYear;
    const rate = parseFloat(cols[rateIdx]);
    const isDiffused = diffIdx >= 0 ? cols[diffIdx] === 'diff' : true;

    if (code && year === latestYear && !isNaN(rate) && isDiffused) {
      crimeRates.set(code, (crimeRates.get(code) || 0) + rate);
    }
  }
  log(`  Parsed crime data for ${crimeRates.size} communes`);

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, rate] of crimeRates) {
    if (validCodes.has(code)) {
      filtered.set(code, Math.round(rate * 10) / 10);
    }
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// --- Employment Rate ---

async function ingestEmploymentRate(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'employmentRate';
  const SOURCE = 'INSEE - Recensement de la Population';
  const HIGHER_IS_BETTER = true;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Downloading employment data from INSEE...');
  const url = 'https://www.insee.fr/fr/statistiques/fichier/7632867/base-cc-emploi-pop-active-2021_csv.zip';

  let csvText: string;
  try {
    csvText = await downloadZipCSV(url, /emploi.*pop.*active.*\.csv$/i);
  } catch {
    // Try alternate filename pattern
    log('  First URL failed, trying alternate...');
    const altUrl = 'https://www.insee.fr/fr/statistiques/fichier/7632867/base-cc-emploi-pop-active-2020_csv.zip';
    csvText = await downloadZipCSV(altUrl, /\.csv$/i);
  }

  log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB CSV`);

  log('  Parsing employment data...');
  const lines = csvText.split('\n');
  const headers = lines[0].split(';').map((h) => h.replace(/"/g, '').trim());

  const codeIdx = headers.indexOf('CODGEO');
  // Look for columns like P21_ACTOCC1564 or P20_ACTOCC1564
  const actoccIdx = headers.findIndex((h) => /P\d+_ACTOCC1564/.test(h));
  const popIdx = headers.findIndex((h) => /P\d+_POP1564/.test(h));

  if (codeIdx === -1 || actoccIdx === -1 || popIdx === -1) {
    throw new Error(`Required columns not found. Sample headers: ${headers.slice(0, 10).join(', ')}`);
  }

  log(`  Using columns: ${headers[codeIdx]}, ${headers[actoccIdx]}, ${headers[popIdx]}`);

  const rates = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(';').map((c) => c.replace(/"/g, '').trim());

    const code = cols[codeIdx];
    const employed = parseFloat(cols[actoccIdx]);
    const pop = parseFloat(cols[popIdx]);

    if (code && !isNaN(employed) && !isNaN(pop) && pop > 0) {
      rates.set(code, Math.round((employed / pop) * 1000) / 10);
    }
  }
  log(`  Parsed employment data for ${rates.size} communes`);

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, rate] of rates) {
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

// --- Median Income ---

async function ingestMedianIncome(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'medianIncome';
  const SOURCE = 'INSEE - Filosofi';
  const HIGHER_IS_BETTER = true;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Downloading Filosofi data from INSEE...');
  const url = 'https://www.insee.fr/fr/statistiques/fichier/7756729/base-cc-filosofi-2021-geo2025_csv.zip';

  const csvText = await downloadZipCSV(url, /data\.csv$/i);
  log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB CSV`);

  log('  Parsing median income data...');
  const lines = csvText.split('\n');
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.replace(/"/g, '').trim());

  const geoIdx = headers.indexOf('GEO');
  const geoObjIdx = headers.indexOf('GEO_OBJECT');
  const measureIdx = headers.indexOf('FILOSOFI_MEASURE');
  const valueIdx = headers.indexOf('OBS_VALUE');
  const confIdx = headers.indexOf('CONF_STATUS');

  if (geoIdx === -1 || valueIdx === -1) {
    throw new Error(`Required columns not found. Headers: ${headers.slice(0, 10).join(', ')}`);
  }

  const incomes = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(sep).map((c) => c.replace(/"/g, '').trim());

    const geo = cols[geoIdx];
    const geoObj = geoObjIdx >= 0 ? cols[geoObjIdx] : 'COM';
    const measure = measureIdx >= 0 ? cols[measureIdx] : 'MED_SL';
    const value = parseFloat(cols[valueIdx]);
    const conf = confIdx >= 0 ? cols[confIdx] : 'F';

    if (
      geo &&
      geoObj === 'COM' &&
      measure === 'MED_SL' &&
      conf !== 'C' &&
      !isNaN(value)
    ) {
      incomes.set(geo, Math.round(value));
    }
  }
  log(`  Parsed income data for ${incomes.size} communes`);

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, income] of incomes) {
    if (validCodes.has(code)) filtered.set(code, income);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// ═══════════════════════════════════════════════════════════════
//  INFRASTRUCTURE RUNNERS
// ═══════════════════════════════════════════════════════════════

// --- Hospital Access ---

async function ingestHospitalAccess(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'hospitalAccess';
  const SOURCE = 'INSEE - Base Permanente des Équipements';
  const HIGHER_IS_BETTER = false; // lower distance is better

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Downloading BPE health facilities data...');
  const url = 'https://api.insee.fr/melodi/file/DS_BPE/DS_BPE_2024_CSV_FR';

  let csvText: string;
  try {
    csvText = await downloadZipCSV(url, /data\.csv$/i);
  } catch {
    log('  Melodi file failed, trying alternate source...');
    // Fallback: use the OpenDataSoft mirror
    csvText = '';
  }

  let hospitalCommunes: Set<string>;
  let communeFacilityCount: Map<string, number>;

  if (csvText) {
    log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB CSV`);
    log('  Parsing health facilities (D101 + D106)...');

    const lines = csvText.split('\n');
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map((h) => h.replace(/"/g, '').trim());

    const geoIdx = headers.indexOf('GEO');
    const geoObjIdx = headers.indexOf('GEO_OBJECT');
    const typeIdx = headers.indexOf('FACILITY_TYPE');
    const valueIdx = headers.indexOf('OBS_VALUE');

    communeFacilityCount = new Map();
    hospitalCommunes = new Set();

    const hospitalTypes = new Set(['D101', 'D106', 'D107', 'D108', 'D113']);

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].split(sep).map((c) => c.replace(/"/g, '').trim());

      const geo = cols[geoIdx];
      const geoObj = geoObjIdx >= 0 ? cols[geoObjIdx] : '';
      const facilityType = typeIdx >= 0 ? cols[typeIdx] : '';
      const count = valueIdx >= 0 ? parseFloat(cols[valueIdx]) : 1;

      if (geo && geoObj === 'COM' && hospitalTypes.has(facilityType) && !isNaN(count)) {
        communeFacilityCount.set(geo, (communeFacilityCount.get(geo) || 0) + count);
        hospitalCommunes.add(geo);
      }
    }
  } else {
    // Fallback: use Melodi API per département for key hospital types
    log('  Using Melodi API fallback for hospital data...');
    communeFacilityCount = new Map();
    hospitalCommunes = new Set();

    const depts: string[] = [];
    for (let i = 1; i <= 19; i++) depts.push(i.toString().padStart(2, '0'));
    depts.push('2A', '2B');
    for (let i = 21; i <= 95; i++) depts.push(i.toString().padStart(2, '0'));

    for (const dept of depts) {
      try {
        for (const facilityType of ['D101', 'D106']) {
          const apiUrl = `https://api.insee.fr/melodi/data/DS_BPE?GEO=DEP-${dept}&FACILITY_TYPE=${facilityType}`;
          const res = await fetchWithRetry(apiUrl);
          const data = await res.json();

          for (const obs of data.observations || []) {
            const geo = obs.dimensions?.GEO;
            const match = geo?.match(/COM-(\d{5})/);
            if (match) {
              const code = match[1];
              const val = obs.measures?.OBS_VALUE_NIVEAU?.value || 0;
              if (val > 0) {
                communeFacilityCount.set(code, (communeFacilityCount.get(code) || 0) + val);
                hospitalCommunes.add(code);
              }
            }
          }
        }
      } catch {
        // continue
      }
    }
  }

  log(`  Found ${hospitalCommunes.size} communes with health facilities`);

  // Calculate distance to nearest hospital for each commune
  log('Step 3: Calculating distance to nearest health facility...');
  const centroids = await getCommuneCentroids(log);

  // Build hospital locations
  const hospitalCentroids = centroids.filter((c) => hospitalCommunes.has(c.code));
  log(`  ${hospitalCentroids.length} hospital commune locations`);

  const distances = new Map<string, number>();

  for (const commune of centroids) {
    if (!validCodes.has(commune.code)) continue;

    if (hospitalCommunes.has(commune.code)) {
      // This commune has a hospital — distance = 0
      distances.set(commune.code, 0);
    } else {
      // Find nearest hospital commune
      let minDist = Infinity;
      for (const hospital of hospitalCentroids) {
        const dist = haversine(commune.lat, commune.lon, hospital.lat, hospital.lon);
        if (dist < minDist) minDist = dist;
      }
      if (minDist < Infinity) {
        distances.set(commune.code, Math.round(minDist * 10) / 10);
      }
    }
  }
  log(`  Calculated distances for ${distances.size} communes`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(distances, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: distances.size };
}

// --- Public Transport ---

async function ingestPublicTransport(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'publicTransport';
  const SOURCE = 'transport.data.gouv.fr';
  const HIGHER_IS_BETTER = true;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Fetching transport datasets...');
  const res = await fetchWithRetry('https://transport.data.gouv.fr/api/datasets?type=public-transit');
  const datasets = await res.json();
  log(`  Found ${datasets.length} public transit datasets`);

  // Build EPCI-to-transport mapping (count number of networks per EPCI)
  const epciNetworkCount = new Map<string, number>();
  const communeNetworkCount = new Map<string, number>();

  for (const dataset of datasets) {
    const coveredAreas = dataset.covered_area || [];
    for (const area of coveredAreas) {
      if (area.type === 'epci' && area.insee) {
        epciNetworkCount.set(area.insee, (epciNetworkCount.get(area.insee) || 0) + 1);
      }
      if (area.type === 'commune' && area.insee) {
        communeNetworkCount.set(area.insee, (communeNetworkCount.get(area.insee) || 0) + 1);
      }
    }
  }
  log(`  ${epciNetworkCount.size} EPCIs with transport, ${communeNetworkCount.size} communes directly covered`);

  log('Step 3: Mapping communes to their EPCI...');
  const communesRes = await fetchWithRetry(
    'https://geo.api.gouv.fr/communes?fields=code,codeEpci&format=json'
  );
  const communeList = await communesRes.json();

  const values = new Map<string, number>();

  for (const c of communeList) {
    if (!validCodes.has(c.code)) continue;

    // Check direct commune coverage first
    let networks = communeNetworkCount.get(c.code) || 0;

    // Then EPCI coverage
    if (c.codeEpci && epciNetworkCount.has(c.codeEpci)) {
      networks += epciNetworkCount.get(c.codeEpci) || 0;
    }

    values.set(c.code, networks);
  }
  log(`  Mapped ${values.size} communes (${Array.from(values.values()).filter((v) => v > 0).length} with transport)`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(values, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: values.size };
}

// ═══════════════════════════════════════════════════════════════
//  EXISTING RUNNERS (Cultural Venues, Local Tax, Internet Speed, Property Price)
// ═══════════════════════════════════════════════════════════════

// --- Cultural Venues ---

async function ingestCulturalVenues(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'culturalVenues';
  const SOURCE = 'Ministère de la Culture - Basilic';
  const HIGHER_IS_BETTER = true;
  const BASE_URL = 'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/base-des-lieux-et-des-equipements-culturels/records';

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Fetching cultural venues from API...');
  const { results } = await paginateODS(
    BASE_URL,
    { select: 'code_insee,nom,type_equipement_ou_lieu' },
    log
  );

  const venueCounts = new Map<string, number>();
  for (const record of results) {
    const code = record.code_insee as string;
    if (code) {
      venueCounts.set(code, (venueCounts.get(code) || 0) + 1);
    }
  }

  log('Step 3: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const code of validCodes) {
    filtered.set(code, venueCounts.get(code) || 0);
  }
  log(`  ${filtered.size} communes (${venueCounts.size} with venues)`);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

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

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Getting latest year...');
  const yearUrl = `${BASE_URL}?select=exercice&group_by=exercice&order_by=exercice DESC&limit=1`;
  const yearResponse = await fetchWithRetry(yearUrl);
  const yearData = await yearResponse.json();
  const latestYear = yearData.results?.[0]?.exercice || '2023';
  log(`  Using year: ${latestYear}`);

  log('Step 3: Fetching tax data...');
  const { results } = await paginateODS(
    BASE_URL,
    {
      select: 'insee_com,libcom,taux_global_tfb',
      where: `exercice="${latestYear}"`,
      order_by: 'insee_com',
    },
    log
  );

  const taxRates = new Map<string, number>();
  for (const r of results) {
    if (r.insee_com && r.taux_global_tfb != null) {
      taxRates.set(r.insee_com as string, r.taux_global_tfb as number);
    }
  }

  log('Step 4: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, rate] of taxRates) {
    if (validCodes.has(code)) filtered.set(code, rate);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 5: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 6: Upserting to database...');
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
    const vals = lines[i].split(';');
    if (typeIdx !== -1 && vals[typeIdx] !== 'all') continue;

    const code = vals[codeIdx];
    const nbr = parseInt(vals[nbrIdx], 10);
    const thd100 = parseInt(vals[thd100Idx], 10);

    if (code && !isNaN(nbr) && nbr > 0 && !isNaN(thd100)) {
      speeds.set(code, Math.round(((thd100 / nbr) * 100) * 10) / 10);
    }
  }
  log(`  Parsed ${speeds.size} communes`);

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
  const { data: communes, error } = await supabase.from('communes').select('code').order('code');
  if (error) throw new Error(`Error fetching communes: ${error.message}`);
  const communeCodes = communes?.map((r) => r.code) || [];
  log(`  ${communeCodes.length} communes in database`);

  log('Step 2: Fetching property prices from DVF API...');
  log('  WARNING: This fetches per-commune and will take a long time');

  const prices = new Map<string, number>();
  let processed = 0;
  let withData = 0;
  let errors = 0;

  for (const code of communeCodes) {
    try {
      const response = await fetchWithRetry(`${BASE_URL}?code_commune=${code}`);
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
              t.valeur_fonciere > 0 && t.surface_reelle_bati && t.surface_reelle_bati > 0 &&
              (t.type_local === 'Appartement' || t.type_local === 'Maison')
          );

          if (valid.length >= 3) {
            const perSqm = valid
              .map((t: { valeur_fonciere: number; surface_reelle_bati: number }) => t.valeur_fonciere / t.surface_reelle_bati)
              .sort((a: number, b: number) => a - b);
            const mid = Math.floor(perSqm.length / 2);
            const median = perSqm.length % 2 === 0 ? (perSqm[mid - 1] + perSqm[mid]) / 2 : perSqm[mid];
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

  if (prices.size === 0) throw new Error('No price data found');

  log('Step 3: Calculating scores and ranks...');
  const records = buildRecords(prices, CRITERION_ID, SOURCE, HIGHER_IS_BETTER);

  log('Step 4: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: prices.size };
}

// ═══════════════════════════════════════════════════════════════
//  REGISTRY — maps criterion ID to its runner function
// ═══════════════════════════════════════════════════════════════

export const ingestionRunners: Record<string, (log: LogFn) => Promise<IngestionResult>> = {
  // Climate
  sunshine: ingestSunshine,
  temperature: ingestTemperature,
  rainfall: ingestRainfall,
  // Economic
  propertyPrice: ingestPropertyPrice,
  localTax: ingestLocalTax,
  medianIncome: ingestMedianIncome,
  employmentRate: ingestEmploymentRate,
  // Services
  internetSpeed: ingestInternetSpeed,
  hospitalAccess: ingestHospitalAccess,
  publicTransport: ingestPublicTransport,
  culturalVenues: ingestCulturalVenues,
  // Safety
  crimeRate: ingestCrimeRate,
};
