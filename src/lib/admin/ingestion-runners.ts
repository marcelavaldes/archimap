/**
 * Ingestion runner functions for all 12 criteria.
 * Each runner fetches data from a public API/dataset, calculates scores, and upserts to DB.
 */

import { gunzipSync } from 'zlib';
import JSZip from 'jszip';
import { createAdminClient } from './supabase';
import {
  percentileBounds,
  scoreFromBounds,
  calculateRanks,
  upsertCriterionValues,
  assertSufficientCommuneCount,
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

  assertSufficientCommuneCount(codes.size);

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

/** One point a commune can take a climate value from: a station, or a grid cell. */
interface SourcePoint {
  id: string;
  lat: number;
  lon: number;
  value: number;
}

/** What a nearest-source mapping actually resolved to. */
interface NearestMapping {
  values: Map<string, number>;
  /**
   * How many distinct source points actually supplied a value. This — not the
   * number of communes written — is the criterion's real spatial resolution.
   */
  distinctSources: number;
  /** Communes left without a value because nothing was within maxDistanceKm. */
  unmapped: number;
  medianDistanceKm: number;
  p95DistanceKm: number;
}

/**
 * Map each commune centroid to the value of the nearest source point.
 *
 * Two things changed from the brute-force version this replaces.
 *
 * It is bucketed rather than O(communes × sources). The old loop was written
 * for the 60 SYNOP stations, where 2.1 million haversine calls costs nothing;
 * the SAFRAN grid has 9,892 cells, which would have made it 345 million. Source
 * points are indexed into square lat/lon buckets and the search expands ring by
 * ring out of the commune's own bucket. Correctness rests on one bound: a point
 * outside the rings already searched has to cross that many whole buckets to
 * reach us, so it is at least `(ring - 1) × kmPerRing` away. kmPerRing is
 * computed at the highest absolute latitude present in the data, where a degree
 * of longitude is shortest, so the bound can only ever under-promise. Expansion
 * stops once the best candidate found is nearer than the bound, which makes the
 * result identical to the exhaustive scan, not an approximation of it.
 *
 * And it takes a maximum distance. Nearest-anything has no natural floor for
 * quality: uncapped, a Guadeloupe commune silently inherits the climate of
 * whichever metropolitan grid cell happens to be least far away, 6,000 km off.
 * Past maxDistanceKm the commune gets no value at all — the honest outcome —
 * and the count comes back in `unmapped` rather than disappearing.
 */
function mapToNearestSource(
  communes: CommunePoint[],
  sources: SourcePoint[],
  validCodes: Set<string>,
  maxDistanceKm: number
): NearestMapping {
  const values = new Map<string, number>();
  const used = new Set<string>();
  const distances: number[] = [];
  let unmapped = 0;

  if (sources.length === 0) {
    return { values, distinctSources: 0, unmapped: communes.length, medianDistanceKm: 0, p95DistanceKm: 0 };
  }

  // Aim for ~2 sources per bucket over the ~300 deg² that France spans, so the
  // index adapts to a 228-station set and a 9,892-cell grid alike.
  const bucketDeg = Math.min(2, Math.max(0.1, Math.sqrt(600 / sources.length)));

  let maxAbsLat = 0;
  for (const s of sources) maxAbsLat = Math.max(maxAbsLat, Math.abs(s.lat));
  for (const c of communes) maxAbsLat = Math.max(maxAbsLat, Math.abs(c.lat));
  // The least a bucket can be worth in km — a degree of longitude at the
  // highest latitude in play. Used as the per-ring clearance guarantee.
  const kmPerRing = Math.max(
    1,
    bucketDeg * 111.32 * Math.cos((Math.min(maxAbsLat, 85) * Math.PI) / 180)
  );
  const maxRing = Math.ceil(maxDistanceKm / kmPerRing) + 1;

  const bucketKey = (bx: number, by: number) => `${bx}:${by}`;
  const index = new Map<string, SourcePoint[]>();
  for (const s of sources) {
    const k = bucketKey(Math.floor(s.lon / bucketDeg), Math.floor(s.lat / bucketDeg));
    const bucket = index.get(k);
    if (bucket) bucket.push(s);
    else index.set(k, [s]);
  }

  for (const commune of communes) {
    if (!validCodes.has(commune.code)) continue;

    const cx = Math.floor(commune.lon / bucketDeg);
    const cy = Math.floor(commune.lat / bucketDeg);

    let best: SourcePoint | null = null;
    let bestDist = Infinity;

    for (let ring = 0; ring <= maxRing; ring++) {
      // Everything still unsearched is at least this far away.
      if (best && bestDist <= (ring - 1) * kmPerRing) break;

      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          // Only the shell of the square — the interior was covered by earlier rings.
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const bucket = index.get(bucketKey(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const s of bucket) {
            const d = haversine(commune.lat, commune.lon, s.lat, s.lon);
            if (d < bestDist) {
              bestDist = d;
              best = s;
            }
          }
        }
      }
    }

    if (!best || bestDist > maxDistanceKm) {
      unmapped++;
      continue;
    }

    values.set(commune.code, best.value);
    used.add(best.id);
    distances.push(bestDist);
  }

  distances.sort((a, b) => a - b);
  const quantile = (q: number) =>
    distances.length ? distances[Math.min(distances.length - 1, Math.floor(distances.length * q))] : 0;

  return {
    values,
    distinctSources: used.size,
    unmapped,
    medianDistanceKm: Math.round(quantile(0.5) * 10) / 10,
    p95DistanceKm: Math.round(quantile(0.95) * 10) / 10,
  };
}

/**
 * Log what a climate criterion's spatial resolution actually is.
 *
 * A criterion that writes 34,900 rows looks fully resolved whatever it was
 * built from. The number that matters is how many distinct source points those
 * rows came from: under the old SYNOP mapping that was 60 for the whole
 * country, which is why the Loire's 320 communes shared three values and the
 * map drew three flat blobs while every count on the admin page looked healthy.
 * Printing it — with the distance communes actually sit from their source —
 * puts the real figure in front of whoever runs the ingest instead of leaving
 * it to be discovered from the shape of the map.
 */
function logResolution(log: LogFn, mapping: NearestMapping): void {
  log(
    `  Mapped ${mapping.values.size} communes onto ${mapping.distinctSources} distinct source points`
  );
  log(
    `  Commune-to-source distance: median ${mapping.medianDistanceKm} km, p95 ${mapping.p95DistanceKm} km`
  );
  if (mapping.unmapped > 0) {
    log(`  ${mapping.unmapped} communes left unmapped (nothing within range)`);
  }
}

function buildRecords(
  values: Map<string, number>,
  criterionId: string,
  source: string,
  higherIsBetter: boolean,
  log?: LogFn
): CriterionRecord[] {
  const allValues = Array.from(values.values());
  log?.(`  Scoring against a reference set of ${allValues.length} communes`);
  // Hoisted out of the loop: the percentile clip is a property of the whole
  // population, not of the value being scored. Calling normalizeToScore per
  // commune re-sorted all ~35,000 values 35,000 times — O(N^2 log N), roughly
  // eight minutes of pure CPU, which is why a full national ingest never
  // finished. One sort now.
  const bounds = percentileBounds(allValues);
  const ranks = calculateRanks(values, higherIsBetter);
  const sourceDate = new Date().toISOString().split('T')[0];
  const records: CriterionRecord[] = [];

  for (const [code, value] of values) {
    records.push({
      commune_code: code,
      criterion_id: criterionId,
      value,
      score: scoreFromBounds(value, bounds, higherIsBetter),
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
//  CLIMATE RUNNERS
// ═══════════════════════════════════════════════════════════════

/*
 * All three climate criteria used to come off the SYNOP dataset: 60 stations
 * for the whole of France, each one spread over its nearest communes. Across
 * the Loire's 320 communes that produced three distinct values. The numbers
 * were plausible and the map was a lie — neighbouring communes matched because
 * they shared a station 80 km away, and nothing in the pipeline said so.
 *
 * Temperature and rainfall now come off SAFRAN/SIM2, Météo France's operational
 * 8 km reanalysis: 9,892 cells over metropolitan France, ~165× the sampling,
 * and altitude is handled by the analysis rather than ignored — which is what
 * the Pilat and the Forez need. The interpolation is Météo France's own, from
 * far more input than we have; ours is only the last 8 km hop from cell to
 * commune centroid.
 *
 * Sunshine gets no such upgrade, and the comment on ingestSunshine says why.
 */

const METEOFRANCE_BUCKET = 'https://object.files.data.gouv.fr/meteofrance';

/**
 * List the keys under a prefix of Météo France's public data.gouv.fr bucket.
 *
 * Météo France names these archives after a ROLLING window. ingestSunshine used
 * to hardcode `Q_${dept}_latest-2024-2025_autres-parametres.csv.gz`; the window
 * has since rolled to `latest-2025-2026`, so all 96 département downloads
 * returned 404, each one was swallowed by a bare `catch {}`, and the criterion
 * reported success having produced zero stations and zero communes. The bucket
 * is publicly listable, so ask it what the current window is called instead of
 * guessing — the next roll then costs nothing.
 */
async function listBucketKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let marker = '';

  for (let page = 0; page < 50; page++) {
    const url =
      `${METEOFRANCE_BUCKET}?prefix=${encodeURIComponent(prefix)}&max-keys=1000` +
      (marker ? `&marker=${encodeURIComponent(marker)}` : '');
    const xml = await (await fetchWithRetry(url)).text();
    const pageKeys = Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g), (m) => m[1]);
    keys.push(...pageKeys);
    if (pageKeys.length === 0 || !/<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)) break;
    marker = pageKeys[pageKeys.length - 1];
  }

  return keys;
}

/** One SAFRAN grid cell, annualised. */
interface SafranCell {
  key: string;
  lat: number;
  lon: number;
  meanTempC: number;
  totalRainMm: number;
}

interface SafranAnnual {
  year: number;
  cells: SafranCell[];
}

/**
 * SAFRAN cells are within ~5.7 km of any point inside the covered domain, so
 * 20 km is slack for coastal and island centroids without being enough to let
 * an overseas commune reach the mainland. SAFRAN is metropolitan-only; DOM
 * communes are meant to fall out here rather than be handed Brittany's weather.
 */
const SAFRAN_MAX_KM = 20;

/**
 * Temperature and rainfall come out of the same 25 MB file and the admin page
 * can run them back to back, so parse it once per process. The cached value is
 * the ~9,900-cell annual aggregate, not the 86 MB of text it came from.
 */
let safranAnnualCache: Promise<SafranAnnual> | null = null;

function getSafranAnnual(log: LogFn): Promise<SafranAnnual> {
  if (!safranAnnualCache) safranAnnualCache = loadSafranAnnual(log);
  return safranAnnualCache;
}

async function loadSafranAnnual(log: LogFn): Promise<SafranAnnual> {
  const keys = await listBucketKeys('data/synchro_ftp/REF_CC/SIM_MENS/');
  const archive = keys.find((k) => /MENS_SIM2_latest-[\d-]+\.csv\.gz$/.test(k));
  if (!archive) {
    throw new Error(
      `No MENS_SIM2_latest-*.csv.gz under data/synchro_ftp/REF_CC/SIM_MENS/ (saw ${keys.length} keys)`
    );
  }
  log(`  Archive: ${archive.split('/').pop()}`);

  // The grid is defined in Lambert II étendu, but Météo France ships the
  // WGS84 equivalent of every node alongside it. Reading their table beats
  // reimplementing the projection and getting the datum shift subtly wrong.
  const coordCsv = await (
    await fetchWithRetry(
      `${METEOFRANCE_BUCKET}/data/synchro_ftp/REF_CC/SIM/coordonnees_grille_safran_lambert-2-etendu.csv`
    )
  ).text();

  const coords = new Map<string, { lat: number; lon: number }>();
  const coordLines = coordCsv.trim().split('\n');
  for (let i = 1; i < coordLines.length; i++) {
    const c = coordLines[i].split(';');
    if (c.length < 4) continue;
    // LAMBX (hm);LAMBY (hm);LAT_DG;LON_DG — decimal comma, French style.
    const lat = parseFloat(c[2].replace(',', '.'));
    const lon = parseFloat(c[3].replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      coords.set(`${c[0].trim()},${c[1].trim()}`, { lat, lon });
    }
  }
  if (coords.size === 0) throw new Error('SAFRAN grid coordinate table is empty');
  log(`  ${coords.size} SAFRAN grid cells (8 km mesh, metropolitan France)`);

  const text = await downloadGzipped(`${METEOFRANCE_BUCKET}/${archive}`);

  const headerEnd = text.indexOf('\n');
  const header = text.slice(0, headerEnd).trim().split(';');
  const iX = header.indexOf('LAMBX');
  const iY = header.indexOf('LAMBY');
  const iDate = header.indexOf('DATE');
  const iTemp = header.indexOf('T');
  const iRain = header.indexOf('PRETOTM');
  if (iX < 0 || iY < 0 || iDate < 0 || iTemp < 0 || iRain < 0) {
    throw new Error(`Unexpected SIM2 monthly columns: ${header.slice(0, 8).join(';')}`);
  }

  interface Accumulator {
    tempSum: number;
    tempMonths: number;
    rainSum: number;
    rainMonths: number;
  }
  const byYear = new Map<number, Map<string, Accumulator>>();

  // Walked by index rather than split('\n'): the archive is ~86 MB and 760,000
  // lines decompressed, and materialising every line at once is pure waste when
  // only one year of them survives the filter.
  for (let pos = headerEnd + 1; pos < text.length; ) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end);
    pos = end + 1;
    if (!line) continue;

    const c = line.split(';');
    const yyyymm = c[iDate];
    if (!yyyymm || yyyymm.length < 6) continue;
    const year = Number(yyyymm.slice(0, 4));
    if (!Number.isFinite(year)) continue;

    let cells = byYear.get(year);
    if (!cells) byYear.set(year, (cells = new Map()));
    const cellKey = `${c[iX]},${c[iY]}`;
    let acc = cells.get(cellKey);
    if (!acc) cells.set(cellKey, (acc = { tempSum: 0, tempMonths: 0, rainSum: 0, rainMonths: 0 }));

    const temp = parseFloat(c[iTemp]);
    const rain = parseFloat(c[iRain]);
    if (Number.isFinite(temp)) {
      acc.tempSum += temp;
      acc.tempMonths++;
    }
    if (Number.isFinite(rain)) {
      acc.rainSum += rain;
      acc.rainMonths++;
    }
  }

  // The most recent calendar year the archive covers in full. Deriving it from
  // the data rather than from `new Date()` is what stops this breaking every
  // January, and it waits rather than half-counting when a month is published
  // late — a partial year would understate rainfall for the whole country.
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    const complete = [...byYear.get(year)!.entries()].filter(
      ([, a]) => a.tempMonths === 12 && a.rainMonths === 12
    );
    if (complete.length < coords.size * 0.9) continue;

    const cells: SafranCell[] = [];
    for (const [key, acc] of complete) {
      const at = coords.get(key);
      if (!at) continue;
      cells.push({
        key,
        lat: at.lat,
        lon: at.lon,
        meanTempC: Math.round((acc.tempSum / 12) * 10) / 10,
        totalRainMm: Math.round(acc.rainSum),
      });
    }
    if (cells.length === 0) continue;

    log(`  ${cells.length} cells with a complete ${year}`);
    return { year, cells };
  }

  throw new Error('No complete calendar year in the SIM2 monthly archive');
}

// --- Temperature ---

async function ingestTemperature(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'temperature';
  const HIGHER_IS_BETTER = true; // warmer is "better" for livability

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Loading the SAFRAN/SIM2 8 km reanalysis...');
  const safran = await getSafranAnnual(log);
  const source = `Météo France — réanalyse SAFRAN/SIM2, maille 8 km (${safran.year})`;
  // Mean of the twelve monthly means, which is the annual mean the criterion
  // claims to hold ("Température moyenne annuelle en degrés Celsius").
  const cells: SourcePoint[] = safran.cells.map((c) => ({
    id: c.key,
    lat: c.lat,
    lon: c.lon,
    value: c.meanTempC,
  }));
  log(`  ${cells.length} cells with a mean ${safran.year} temperature`);

  log('Step 3: Mapping communes to their SAFRAN cell...');
  const centroids = await getCommuneCentroids(log);
  const mapping = mapToNearestSource(centroids, cells, validCodes, SAFRAN_MAX_KM);
  logResolution(log, mapping);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(mapping.values, CRITERION_ID, source, HIGHER_IS_BETTER, log);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: mapping.values.size };
}

// --- Rainfall ---

async function ingestRainfall(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'rainfall';
  const HIGHER_IS_BETTER = false; // less rain is "better" for livability

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Loading the SAFRAN/SIM2 8 km reanalysis...');
  const safran = await getSafranAnnual(log);
  const source = `Météo France — réanalyse SAFRAN/SIM2, maille 8 km (${safran.year})`;
  // PRETOTM is the month's total precipitation in mm, rain and snow-water
  // together, so the twelve sum straight to the annual total.
  const cells: SourcePoint[] = safran.cells.map((c) => ({
    id: c.key,
    lat: c.lat,
    lon: c.lon,
    value: c.totalRainMm,
  }));
  log(`  ${cells.length} cells with a complete ${safran.year} precipitation total`);

  log('Step 3: Mapping communes to their SAFRAN cell...');
  const centroids = await getCommuneCentroids(log);
  const mapping = mapToNearestSource(centroids, cells, validCodes, SAFRAN_MAX_KM);
  logResolution(log, mapping);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(mapping.values, CRITERION_ID, source, HIGHER_IS_BETTER, log);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: mapping.values.size };
}

// --- Sunshine ---

/**
 * How far a commune may sit from the heliograph it borrows its value from.
 *
 * Deliberately generous, because with ~190 usable stations for the whole
 * country there is no tighter number that keeps rural France covered — the
 * empty quarters of the Massif Central and the southern Alps genuinely have no
 * nearer instrument. It exists to stop the absurd cases (an overseas commune
 * reaching a mainland station), not to pretend the rest are close.
 */
const SUNSHINE_MAX_KM = 150;

/**
 * Sunshine is the one climate criterion with no gridded source, and it stays
 * visibly coarser than the other two. That is the data, not a bug.
 *
 * SAFRAN carries shortwave radiation (SSI), not sunshine duration. Converting
 * one to the other needs locally-fitted Ångström–Prescott coefficients, which
 * would be a model output wearing a measurement's units — exactly the invented
 * precision the rest of this pipeline refuses to ship. So sunshine comes off
 * real heliographs, and heliographs are expensive: of the ~2,300 stations
 * filing monthly climatological records, only ~230 measure insolation at all
 * and ~190 have a complete year of it. The Loire has exactly one. Communes here
 * are typically tens of kilometres from their source, not the ~4 km of the
 * SAFRAN runners, and logResolution() prints the real figure on every run so
 * the number is never inferred from the map.
 *
 * The two things this must not do, both of which the previous version did:
 *
 *  - Guess the archive's filename. It hardcoded a rolling window that had since
 *    rolled, so all 96 downloads 404'd and the criterion produced nothing while
 *    reporting success. Names come from the bucket listing now, and enough
 *    failures raise instead of being swallowed.
 *  - Extrapolate a year from a handful of days. It scaled any station with ≥30
 *    days by 365/n, so a station reporting only June came out near 3,000 h/yr
 *    and one reporting only December near 700 — pure seasonal artefact dressed
 *    as climate. Only stations with twelve complete months count.
 */
async function ingestSunshine(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'sunshine';
  const HIGHER_IS_BETTER = true;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Locating the current MENSQ monthly archives...');
  // MENS is the main network, MENS_COMP the complementary stations. Both are
  // read: the département list is whatever the bucket holds, which is also how
  // Corsica gets picked up — it files as `20`, not the `2A`/`2B` the old
  // hardcoded list asked for and never received.
  const keys = [
    ...(await listBucketKeys('data/synchro_ftp/BASE/MENS/')),
    ...(await listBucketKeys('data/synchro_ftp/BASE/MENS_COMP/')),
  ].filter((k) => /\/MENSQ(-COMP)?_[^/]+_latest-[\d-]+\.csv\.gz$/.test(k));

  if (keys.length === 0) {
    throw new Error('No MENSQ_*_latest-*.csv.gz found — the Météo France archive layout has changed');
  }
  log(`  ${keys.length} département archives to read`);

  interface StationYear {
    minutes: number;
    months: number;
    lat: number;
    lon: number;
  }
  const byYear = new Map<number, Map<string, StationYear>>();
  let failed = 0;

  for (let i = 0; i < keys.length; i += 12) {
    await Promise.all(
      keys.slice(i, i + 12).map(async (key) => {
        try {
          const text = await downloadGzipped(`${METEOFRANCE_BUCKET}/${key}`);
          const lines = text.trim().split('\n');
          if (lines.length < 2) return;

          const headers = lines[0].split(';');
          const iPoste = headers.indexOf('NUM_POSTE');
          const iMonth = headers.indexOf('AAAAMM');
          const iInst = headers.indexOf('INST');
          const iDays = headers.indexOf('NBINST');
          const iLat = headers.indexOf('LAT');
          const iLon = headers.indexOf('LON');
          // Most complementary stations are rain gauges with no INST column at
          // all. Nothing to take from them here; the file is simply skipped.
          if (iPoste < 0 || iMonth < 0 || iInst < 0 || iLat < 0 || iLon < 0) return;

          for (let j = 1; j < lines.length; j++) {
            const cols = lines[j].split(';');
            const minutes = parseFloat(cols[iInst]);
            const lat = parseFloat(cols[iLat]);
            const lon = parseFloat(cols[iLon]);
            if (!Number.isFinite(minutes) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            // NBINST is how many days of the month the heliograph actually
            // reported. A month measured on four days would drag the annual
            // total down as though the sun had not shone on the other 27.
            if (iDays >= 0) {
              const days = parseFloat(cols[iDays]);
              if (!Number.isFinite(days) || days < 25) continue;
            }

            const yyyymm = cols[iMonth];
            if (!yyyymm || yyyymm.length < 6) continue;
            const year = Number(yyyymm.slice(0, 4));
            if (!Number.isFinite(year)) continue;

            let stations = byYear.get(year);
            if (!stations) byYear.set(year, (stations = new Map()));
            const poste = cols[iPoste];
            const acc = stations.get(poste);
            if (acc) {
              acc.minutes += minutes;
              acc.months++;
            } else {
              stations.set(poste, { minutes, months: 1, lat, lon });
            }
          }
        } catch {
          failed++;
        }
      })
    );
  }

  // A source that has moved is a failure, not an empty result. The previous
  // version's bare `catch {}` is how 96 dead URLs became a green run.
  if (failed > keys.length / 10) {
    throw new Error(
      `${failed} of ${keys.length} MENSQ archives failed to download — the Météo France source has probably moved`
    );
  }
  if (failed > 0) log(`  ${failed} of ${keys.length} archives could not be read`);

  let year = 0;
  let stations: SourcePoint[] = [];
  for (const candidate of [...byYear.keys()].sort((a, b) => b - a)) {
    const complete = [...byYear.get(candidate)!.entries()].filter(([, s]) => s.months === 12);
    if (complete.length < 50) continue;
    year = candidate;
    stations = complete.map(([id, s]) => ({
      id,
      lat: s.lat,
      lon: s.lon,
      // INST is the month's insolation in minutes; twelve of them make the year.
      value: Math.round(s.minutes / 60),
    }));
    break;
  }

  if (stations.length === 0) {
    throw new Error('No year with twelve complete months of INST in the MENSQ archives');
  }
  log(`  ${stations.length} stations with a complete ${year} insolation record`);
  const source = `Météo France — données climatologiques mensuelles, ${stations.length} postes héliographiques (${year})`;

  log('Step 3: Mapping communes to nearest station...');
  const centroids = await getCommuneCentroids(log);
  const mapping = mapToNearestSource(centroids, stations, validCodes, SUNSHINE_MAX_KM);
  logResolution(log, mapping);

  log('Step 4: Calculating scores and ranks...');
  const records = buildRecords(mapping.values, CRITERION_ID, source, HIGHER_IS_BETTER, log);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: mapping.values.size };
}

// ═══════════════════════════════════════════════════════════════
//  STATISTICAL RUNNERS (bulk CSV downloads)
// ═══════════════════════════════════════════════════════════════

// --- Crime Rate ---

/**
 * SSMSI "bases statistiques communales de la délinquance enregistrée".
 *
 * PROVENANCE — verified 2026-09-07
 *   data.gouv.fr dataset  621df2954fa5a3b5a023e23c
 *     slug: bases-statistiques-communale-departementale-et-regionale-de-la-
 *           delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales
 *   resource picked       donnee-data.gouv-2025-geographie2026-produit-le2026-06-25.csv.gz
 *   contents              2016-2025, 34,920 communes x 15 indicators x 10 years
 *   geography             commune codes as of 1 January 2026
 *   cadence               republished twice a year (January and July editions)
 *
 * WHY THE OLD MATCHER FOUND NOTHING ("Crime dataset CSV not found"): it required
 * `format === 'csv'`, and the communal file is published as `csv.gz`. The only
 * plain-csv resources in the dataset are the DEP and REG aggregates, whose
 * titles do not contain "donnee-data.gouv", so no resource matched at all. The
 * discriminator that actually holds is the file name — the communal file is
 * `donnee-data.gouv-…`, the others are `donnee-dep-data.gouv-…`,
 * `donnee-reg-data.gouv-…` and `donnee-comm-data.gouv-parquet-…`.
 *
 * TWO FORMAT TRAPS, both of which produce plausible-looking garbage rather than
 * an error:
 *   1. Decimal comma. taux_pour_mille is written "15,2654561"; parseFloat()
 *      stops at the comma and returns 15. Every rate truncated to its integer
 *      part. Parsed with frenchDecimal() now.
 *   2. The geography column is CODGEO_2026, not CODGEO — the suffix tracks the
 *      geography vintage and moves every year, so match on the prefix.
 *
 * THE SUPPRESSION PROBLEM, AND WHAT THIS DOES ABOUT IT. SSMSI withholds a
 * commune-level count whenever it is small enough to identify someone
 * (est_diffuse = "ndiff", with nombre and taux_pour_mille both "NA"). For 2025
 * that is 251,145 of 523,800 commune-indicator cells — 48% of the file. Summing
 * only the published rates leaves 25,301 of 34,920 communes on exactly 0.0‰,
 * i.e. presented as the safest places in France, when in fact their numbers
 * were withheld. So for a withheld cell we substitute complement_info_taux,
 * which SSMSI publishes for exactly this purpose: the rate over the pooled
 * non-diffused communes of the same département for that indicator.
 *
 * That substitution is an imputation, not a measurement — every suppressed
 * commune in a département shares the same substituted component — and it is
 * the honest trade here: it moves the national distribution from "median 0.0‰"
 * to median 24.7‰, p5 8.3‰, p95 52.3‰, which is the right order of magnitude
 * for recorded delinquency, and it stops rural France from being painted as
 * crime-free by a confidentiality rule.
 *
 * KNOWN GAPS, both inherent to the source:
 *   - The value is the sum of 15 indicator rates whose denominators are not
 *     identical — "Cambriolages de logement" is per 1,000 dwellings, the other
 *     fourteen per 1,000 inhabitants. That is how SSMSI publishes them and how
 *     its own departmental atlases add them up, but it makes the total an index
 *     rather than a strict per-1,000-inhabitant rate.
 *   - The three "stupéfiants" indicators count mis en cause where the offence
 *     was recorded, not where the offender lives, so a small commune on a
 *     motorway can spike on one gendarmerie operation. Trelins (42313, 682
 *     inhabitants) records 226 drug offences in 2025 and comes out at 365.5‰,
 *     the worst in the Loire. That is the source telling the truth about
 *     recorded offences, not a parse error — the 2nd/98th percentile clip in
 *     scoring.ts keeps it from dragging the whole scale.
 */
async function ingestCrimeRate(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'crimeRate';
  const SOURCE = 'SSMSI - Ministère de l\'Intérieur';
  const HIGHER_IS_BETTER = false;
  const DATASET_ID = '621df2954fa5a3b5a023e23c';

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Finding the commune-level crime file on data.gouv.fr...');
  const resource = await findDataGouvResource(
    DATASET_ID,
    (fileName) => fileName.startsWith('donnee-data.gouv-') && fileName.endsWith('.csv.gz')
  );
  log(`  Found: ${resource.fileName} (${resource.format})`);

  log('Step 3: Streaming the gzipped CSV (~40 MB, 5.2M rows)...');
  // year -> commune -> summed rate over the 15 indicators.
  const byYear = new Map<string, Map<string, number>>();
  let header: string[] | null = null;
  let codeIdx = -1;
  let yearIdx = -1;
  let rateIdx = -1;
  let diffIdx = -1;
  let complementIdx = -1;
  let dataRows = 0;
  let imputedCells = 0;

  await streamGzippedRows(resource.url, ';', (cells) => {
    if (header === null) {
      header = cells;
      codeIdx = header.findIndex((h) => h.startsWith('CODGEO'));
      yearIdx = header.indexOf('annee');
      rateIdx = header.indexOf('taux_pour_mille');
      diffIdx = header.indexOf('est_diffuse');
      complementIdx = header.indexOf('complement_info_taux');
      if (codeIdx === -1 || yearIdx === -1 || rateIdx === -1) {
        throw new Error(`Required columns not found. Headers: ${header.join(', ')}`);
      }
      return;
    }

    const code = cells[codeIdx];
    const year = cells[yearIdx];
    if (!code || !year) return;
    dataRows++;

    let bucket = byYear.get(year);
    if (!bucket) {
      bucket = new Map<string, number>();
      byYear.set(year, bucket);
    }

    let rate = frenchDecimal(cells[rateIdx]);
    if (rate === null && complementIdx >= 0 && (diffIdx === -1 || cells[diffIdx] === 'ndiff')) {
      rate = frenchDecimal(cells[complementIdx]);
      if (rate !== null) imputedCells++;
    }

    // A commune whose every cell is unusable still gets an entry at 0 rather
    // than vanishing from the map — the .get() ?? 0 below keeps it present.
    bucket.set(code, (bucket.get(code) ?? 0) + (rate ?? 0));
  });

  const years = Array.from(byYear.keys()).sort();
  const latestYear = years[years.length - 1];
  if (!latestYear) throw new Error('Crime file parsed but no rows were usable');
  const totals = byYear.get(latestYear)!;
  log(`  Parsed ${dataRows} rows, years ${years[0]}-${latestYear}`);
  log(`  Using ${latestYear}: ${totals.size} communes, ${imputedCells} withheld cells imputed`);

  log('Step 4: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, total] of totals) {
    if (validCodes.has(code)) filtered.set(code, Math.round(total * 10) / 10);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 5: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 6: Upserting to database...');
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
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// ───────────────────────────────────────────────────────────────
//  OPEN-DATA HELPERS
//  Shared by the four runners whose upstream sources moved or changed shape
//  during 2026 — crimeRate, medianIncome, localTax, culturalVenues. They live
//  here, next to their callers, rather than in SHARED UTILITIES above, because
//  nothing else in this file needs them.
// ───────────────────────────────────────────────────────────────

/**
 * Walk a delimited document row by row, honouring RFC-4180 double quotes
 * (a quoted field may contain the separator, a newline, or a doubled `""`).
 *
 * The `line.split(sep)` the older runners use silently corrupts any file whose
 * text fields can contain the separator. Measured on the Basilic cultural base
 * (86,372 lines): 10,485 of them carry a `;` inside a quoted address or venue
 * name, and naive splitting drops 137 venues outright while mis-columning
 * thousands more. The INSEE Filosofi export quotes every single field.
 *
 * Callback-based on purpose. These files run to 57 MB and 1.1M rows and
 * materialising them as an array of arrays costs more memory than the rest of
 * the ingest put together.
 *
 * A leading UTF-8 BOM is stripped: the OpenDataSoft CSV export emits one, and
 * it would otherwise glue itself to the first header name.
 */
function forEachDelimitedRow(
  text: string,
  sep: string,
  onRow: (cells: string[]) => void
): void {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const len = text.length;
  let pos = 0;
  let cells: string[] = [];

  const emit = () => {
    // Skip the empty row a trailing newline produces, but keep a genuine
    // all-empty row that had separators in it.
    if (cells.length > 1 || cells[0] !== '') onRow(cells);
    cells = [];
  };

  while (pos <= len) {
    let value: string;

    if (pos < len && text[pos] === '"') {
      // Quoted: scan quote to quote with indexOf rather than character by
      // character — char-wise concatenation over 57 MB is seconds of CPU.
      let cursor = pos + 1;
      let chunkStart = cursor;
      let out = '';
      for (;;) {
        const quote = text.indexOf('"', cursor);
        if (quote === -1) {
          // Unterminated quote: take the remainder rather than losing the row.
          out += text.slice(chunkStart);
          cursor = len;
          break;
        }
        if (text[quote + 1] === '"') {
          out += text.slice(chunkStart, quote + 1);
          cursor = quote + 2;
          chunkStart = cursor;
          continue;
        }
        out += text.slice(chunkStart, quote);
        cursor = quote + 1;
        break;
      }
      value = out;
      pos = cursor;
      // Anything between the closing quote and the next delimiter is padding.
      while (pos < len && text[pos] !== sep && text[pos] !== '\n' && text[pos] !== '\r') pos++;
    } else {
      let end = pos;
      while (end < len && text[end] !== sep && text[end] !== '\n' && text[end] !== '\r') end++;
      value = text.slice(pos, end);
      pos = end;
    }

    cells.push(value);

    if (pos >= len) {
      emit();
      break;
    }
    if (text[pos] === sep) {
      pos++;
      continue;
    }
    pos += text[pos] === '\r' && text[pos + 1] === '\n' ? 2 : 1;
    emit();
  }
}

/**
 * Stream a gzipped CSV row by row without ever holding the whole file.
 *
 * downloadGzipped() above returns the decompressed body as one string, which is
 * fine for the tens-of-MB files it was written for. The SSMSI communal crime
 * base is 40 MB gzipped and ~500 MB of text in 5,238,000 rows; turning that
 * into a string and then .split('\n') needs several GB and dies. Streaming runs
 * the same pass in about 25 s at ~250 MB RSS.
 *
 * Chunks are cut at the last newline before parsing, which is safe here because
 * the SSMSI file has no newline inside a quoted field (row count matches line
 * count exactly). A source that did would need the parser fed continuously.
 */
async function streamGzippedRows(
  url: string,
  sep: string,
  onRow: (cells: string[]) => void
): Promise<void> {
  const res = await fetchWithRetry(url);
  if (!res.body) throw new Error(`No response body for ${url}`);

  const reader = res.body
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream('utf-8'))
    .getReader();

  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lastBreak = buffer.lastIndexOf('\n');
    if (lastBreak === -1) continue;
    forEachDelimitedRow(buffer.slice(0, lastBreak + 1), sep, onRow);
    buffer = buffer.slice(lastBreak + 1);
  }
  if (buffer.trim()) forEachDelimitedRow(buffer, sep, onRow);
}

interface DataGouvResource {
  title: string;
  format: string;
  url: string;
  fileName: string;
}

/**
 * Resolve one resource of a data.gouv.fr dataset by looking at its file name.
 *
 * Two reasons this is a lookup and not a pinned URL. data.gouv.fr mints a fresh
 * static.data.gouv.fr path on every republication (SSMSI republishes twice a
 * year), so a pinned URL rots within months. And the `format` field is
 * publisher-declared and unreliable — matching on it is what made the crime
 * runner find nothing — whereas the file name is stable and descriptive.
 *
 * The error message lists what the dataset actually holds, so the next person
 * to hit a rename can see the new name without opening a browser.
 */
async function findDataGouvResource(
  datasetId: string,
  matches: (fileName: string, resource: { title?: string; format?: string }) => boolean
): Promise<DataGouvResource> {
  const res = await fetchWithRetry(`https://www.data.gouv.fr/api/1/datasets/${datasetId}/`);
  const dataset = await res.json();
  const resources: { title?: string; format?: string; url?: string }[] = dataset.resources ?? [];

  for (const resource of resources) {
    if (!resource.url) continue;
    const fileName = decodeURIComponent(resource.url.split('?')[0].split('/').pop() || '');
    if (matches(fileName, resource)) {
      return {
        title: resource.title ?? fileName,
        format: resource.format ?? '',
        url: resource.url,
        fileName,
      };
    }
  }

  const inventory = resources
    .map((r) => `${r.format ?? '?'}:${(r.url ?? '').split('/').pop()}`)
    .join(', ');
  throw new Error(
    `No matching resource in data.gouv.fr dataset ${datasetId}. Available: ${inventory.slice(0, 600)}`
  );
}

/**
 * Legal populations per commune from geo.api.gouv.fr — the denominator for any
 * "per N inhabitants" criterion.
 *
 * Twelve communes have a legal population of zero (the villages français
 * détruits of the Verdun battlefield, kept as communes with no inhabitants).
 * They are dropped here rather than dividing by zero downstream.
 */
async function getCommunePopulations(log: LogFn): Promise<Map<string, number>> {
  log('  Fetching commune populations from geo.api.gouv.fr...');
  const res = await fetchWithRetry(
    'https://geo.api.gouv.fr/communes?fields=code,population&format=json'
  );
  const rows: { code?: string; population?: number }[] = await res.json();

  const populations = new Map<string, number>();
  for (const row of rows) {
    if (row.code && typeof row.population === 'number' && row.population > 0) {
      populations.set(row.code, row.population);
    }
  }
  log(`  Got populations for ${populations.size} communes`);
  return populations;
}

/**
 * Parse a French-formatted decimal. Returns null for the "NA" that INSEE and
 * SSMSI use for a withheld or absent value.
 *
 * This is not pedantry: SSMSI writes taux_pour_mille as "15,2654561", and
 * parseFloat() stops at the comma and returns 15. Every rate in the crime
 * ingest was being truncated to its integer part.
 */
function frenchDecimal(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'NA' || trimmed === 'N/A') return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

// --- Median Income ---

/**
 * INSEE Filosofi — médiane du niveau de vie, i.e. revenu disponible par unité
 * de consommation, per commune.
 *
 * PROVENANCE — verified 2026-09-07
 *   INSEE Melodi dataset  DS_FILOSOFI_CC
 *   catalogue entry       https://api.insee.fr/melodi/catalog/DS_FILOSOFI_CC
 *   file, 2023 millésime  https://api.insee.fr/melodi/file/DS_FILOSOFI_CC/DS_FILOSOFI_CC_2023_CSV_FR
 *                         (zip, 5.3 MB -> DS_FILOSOFI_CC_2023_data.csv, 57 MB)
 *   selection             GEO_OBJECT = COM, FILOSOFI_MEASURE = MED_SL
 *   geography             commune codes as of 1 January 2026
 *   published             2026-05, corrected 2026-08-06
 *
 * WHAT WAS ACTUALLY BROKEN — the reported error was "Required columns not
 * found. Headers: COD_VAR, LIB_VAR, COD_MOD, LIB_MOD", and the cause is a
 * one-character regex hole: the runner asked downloadZipCSV for /data\.csv$/,
 * and "DS_FILOSOFI_CC_metadata.csv" *ends with* "data.csv". JSZip handed back
 * the variable dictionary instead of the observations. The pattern is anchored
 * on the underscore now — /_data\.csv$/ — which "metadata.csv" cannot match.
 *
 * It was also pinned to base-cc-filosofi-2021, two millésimes stale, on a
 * www.insee.fr/fr/statistiques/fichier/ path that INSEE does not keep stable.
 * The file URL now comes from the Melodi catalogue so a new millésime is picked
 * up on its own; PINNED_FILE below is the fallback if the catalogue moves.
 *
 * KNOWN GAPS, all upstream and all real:
 *   - Filosofi covers metropolitan France and La Réunion only. Guadeloupe,
 *     Martinique, Guyane, Mayotte and the COM have no median income at all —
 *     that is roughly 200 communes with no value, by design.
 *   - 3,960 communes carry CONF_STATUS = 'C' (secret statistique: too few tax
 *     households to publish) and are skipped. 30,794 communes get a value.
 *   - Nine communes are folded into a neighbour by INSEE and have no row of
 *     their own: 15031/15035/15047/15171 into 15141, 85165/85212 into 85084,
 *     09304 into 09042.
 *   - Millésime 2023 is Filosofi 2, a methodology change. Its values are NOT
 *     comparable with millésimes 2012-2021, so never mix them in one ingest.
 */
async function ingestMedianIncome(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'medianIncome';
  const SOURCE = 'INSEE - Filosofi';
  const HIGHER_IS_BETTER = true;
  const MELODI_CATALOG = 'https://api.insee.fr/melodi/catalog/DS_FILOSOFI_CC';
  const PINNED_FILE = 'https://api.insee.fr/melodi/file/DS_FILOSOFI_CC/DS_FILOSOFI_CC_2023_CSV_FR';

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Resolving the latest Filosofi millésime from INSEE Melodi...');
  let fileUrl = PINNED_FILE;
  let millesime = '2023';
  try {
    const catalogRes = await fetchWithRetry(MELODI_CATALOG);
    const catalog = await catalogRes.json();
    const products: { id?: string; format?: string; accessURL?: string }[] = catalog.product ?? [];
    // The dataset ships both a CSV zip and an XLSX; only the CSV is machine-readable.
    const csv = products.find((p) => p.format === 'CSV' && typeof p.accessURL === 'string');
    if (csv?.accessURL) {
      fileUrl = csv.accessURL;
      millesime = /_(\d{4})_CSV/.exec(csv.id ?? '')?.[1] ?? millesime;
    }
  } catch (error) {
    log(
      `  Melodi catalogue unavailable (${error instanceof Error ? error.message : String(error)});` +
        ` falling back to the pinned ${millesime} file`
    );
  }
  log(`  Millésime ${millesime}: ${fileUrl}`);

  log('Step 3: Downloading and unzipping the Filosofi export...');
  // /_data\.csv$/ and not /data\.csv$/ — see the header comment; the loose
  // pattern matched DS_FILOSOFI_CC_<year>_metadata.csv, the variable dictionary.
  const csvText = await downloadZipCSV(fileUrl, /_data\.csv$/i);
  log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB CSV`);

  log('  Parsing median income (GEO_OBJECT=COM, FILOSOFI_MEASURE=MED_SL)...');
  const incomes = new Map<string, number>();
  let header: string[] | null = null;
  let geoIdx = -1;
  let geoObjIdx = -1;
  let measureIdx = -1;
  let valueIdx = -1;
  let confIdx = -1;
  let periodIdx = -1;
  let suppressed = 0;
  const periods = new Set<string>();

  // Every field in the 2023 export is double-quoted, so this cannot be split
  // on ';' the way the 2021 file was.
  forEachDelimitedRow(csvText, ';', (cells) => {
    if (header === null) {
      header = cells;
      geoIdx = header.indexOf('GEO');
      geoObjIdx = header.indexOf('GEO_OBJECT');
      measureIdx = header.indexOf('FILOSOFI_MEASURE');
      valueIdx = header.indexOf('OBS_VALUE');
      confIdx = header.indexOf('CONF_STATUS');
      periodIdx = header.indexOf('TIME_PERIOD');
      if (geoIdx === -1 || valueIdx === -1 || measureIdx === -1 || geoObjIdx === -1) {
        throw new Error(`Required columns not found. Headers: ${header.slice(0, 10).join(', ')}`);
      }
      return;
    }

    if (cells[geoObjIdx] !== 'COM' || cells[measureIdx] !== 'MED_SL') return;

    const geo = cells[geoIdx];
    if (!geo) return;
    if (periodIdx >= 0 && cells[periodIdx]) periods.add(cells[periodIdx]);

    // CONF_STATUS 'C' is secret statistique: the row exists but OBS_VALUE is
    // deliberately empty. Counting these separately keeps the coverage gap
    // visible in the log instead of hiding inside "communes matched".
    if (confIdx >= 0 && cells[confIdx] === 'C') {
      suppressed++;
      return;
    }

    const value = Number(cells[valueIdx]);
    if (!Number.isFinite(value) || value <= 0) return;
    incomes.set(geo, Math.round(value));
  });

  log(
    `  Parsed ${incomes.size} communes (${suppressed} withheld as secret statistique)` +
      `, TIME_PERIOD ${Array.from(periods).sort().join('/')}`
  );

  log('Step 4: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, income] of incomes) {
    if (validCodes.has(code)) filtered.set(code, income);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 5: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 6: Upserting to database...');
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
  const records = buildRecords(distances, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

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
  const records = buildRecords(values, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: values.size };
}

// ═══════════════════════════════════════════════════════════════
//  EXISTING RUNNERS (Cultural Venues, Local Tax, Internet Speed, Property Price)
// ═══════════════════════════════════════════════════════════════

// --- Cultural Venues ---

/**
 * Fold a Paris/Lyon/Marseille arrondissement municipal onto its parent commune.
 *
 * Basilic codes venues in the three PLM cities by arrondissement — 75101-75120,
 * 69381-69389, 13201-13216 — while geo.api.gouv.fr and the communes table use
 * the whole-commune codes 75056, 69123 and 13055. Without this fold France's
 * three largest cities come out of the ingest with *zero* cultural venues:
 * Paris' 3,767 entries all sit on codes that no commune row matches. Measured
 * after folding: Paris 17.91, Lyon 10.59, Marseille 4.73 venues per 10,000.
 *
 * The three ranges are fixed INSEE conventions, not data we can look up here —
 * geo.api.gouv.fr's /communes collection does not carry arrondissements.
 */
function foldArrondissementToCommune(code: string): string {
  const n = Number(code);
  if (!Number.isInteger(n)) return code;
  if (n >= 75101 && n <= 75120) return '75056';
  if (n >= 69381 && n <= 69389) return '69123';
  if (n >= 13201 && n <= 13216) return '13055';
  return code;
}

/**
 * Basilic — base des lieux et équipements culturels (DEPS, ministère de la
 * Culture) — counted per 10,000 inhabitants.
 *
 * PROVENANCE — verified 2026-09-07
 *   data.gouv.fr dataset  61777ddaa9101d073e5506cd
 *     slug: base-des-lieux-et-equipements-culturels-basilic
 *   resource picked       base-des-lieux-et-des-equipements-culturels.csv
 *                         (49 MB, 86,366 venues, 22,084 communes, published 2026-02-18)
 *   denominator           geo.api.gouv.fr populations légales
 *
 * WHY THE OLD CALL RETURNED "Failed to parse JSON": data.culture.gouv.fr has
 * been retired. Every path on that host — /api/explore/v2.1/... included — now
 * answers 301 to culture.data.gouv.fr, which is a JavaScript front-end onto
 * data.gouv.fr with no OpenDataSoft API behind it (neither /api/explore nor
 * /api/1 exists there; both return the SPA shell). paginateODS() was handed a
 * "Moved Permanently" HTML body and died on JSON.parse. There is no ODS
 * endpoint to migrate to — the base is distributed as a flat CSV on
 * data.gouv.fr now, so we download and count it ourselves.
 *
 * WHY A QUOTE-AWARE PARSER: 10,485 of the 86,372 lines carry a `;` inside a
 * quoted address or venue name. Splitting on `;` loses 137 venues outright and
 * mis-columns thousands more.
 *
 * KNOWN SKEW — read this before trusting the map colour. 62% of Basilic is the
 * "Patrimoine" domain (protected monuments), which is how a commune of 23
 * inhabitants ends up with 64 entries: Le Mont-Saint-Michel (50353) lands at
 * 27,826 venues per 10,000 inhabitants against a national median of 9.6. The
 * 2nd/98th percentile clip in scoring.ts absorbs the tail, but the distribution
 * stays strongly right-skewed and the median commune scores around 7/100.
 * Dropping domains to flatten it would change what the criterion means — its
 * seeded description is "nombre d'équipements culturels pour 10000 habitants",
 * and Basilic is the official inventory — so the full base is kept and the
 * skew documented rather than quietly engineered away.
 *
 * A commune with no venue is recorded as 0, not as missing: "no cultural
 * facility" is a fact about the commune, not a hole in the data.
 */
async function ingestCulturalVenues(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'culturalVenues';
  const SOURCE = 'Ministère de la Culture - Basilic';
  const HIGHER_IS_BETTER = true;
  const DATASET_ID = '61777ddaa9101d073e5506cd';

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Finding the Basilic CSV on data.gouv.fr...');
  const resource = await findDataGouvResource(
    DATASET_ID,
    (fileName) => fileName.endsWith('.csv') && fileName.includes('equipements-culturels')
  );
  log(`  Found: ${resource.fileName}`);

  log('Step 3: Downloading the venue list (~49 MB)...');
  const res = await fetchWithRetry(resource.url);
  const csvText = await res.text();
  log(`  Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)} MB CSV`);

  const venueCounts = new Map<string, number>();
  let header: string[] | null = null;
  let codeIdx = -1;
  let venues = 0;

  forEachDelimitedRow(csvText, ';', (cells) => {
    if (header === null) {
      header = cells;
      codeIdx = header.indexOf('code_insee');
      if (codeIdx === -1) {
        throw new Error(`code_insee column not found. Headers: ${header.slice(0, 10).join(', ')}`);
      }
      return;
    }
    const code = foldArrondissementToCommune(cells[codeIdx]);
    if (!code) return;
    venues++;
    venueCounts.set(code, (venueCounts.get(code) ?? 0) + 1);
  });
  log(`  ${venues} venues across ${venueCounts.size} communes`);

  log('Step 4: Fetching the population denominator...');
  const populations = await getCommunePopulations(log);

  log('Step 5: Computing venues per 10,000 inhabitants...');
  const values = new Map<string, number>();
  let missingPopulation = 0;
  for (const code of validCodes) {
    const population = populations.get(code);
    if (!population) {
      // No legal population (the twelve destroyed Verdun communes, or a code
      // geo.api does not carry): a per-capita rate is undefined, so skip
      // rather than emit a fabricated zero.
      missingPopulation++;
      continue;
    }
    const per10k = ((venueCounts.get(code) ?? 0) / population) * 10000;
    values.set(code, Math.round(per10k * 100) / 100);
  }
  log(`  ${values.size} communes scored, ${missingPopulation} skipped for want of a population`);

  log('Step 6: Calculating scores and ranks...');
  const records = buildRecords(values, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 7: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: values.size };
}

// --- Local Tax ---

/**
 * DGFiP "fiscalité locale des particuliers" — taux global de taxe foncière sur
 * les propriétés bâties (TFPB), per commune.
 *
 * PROVENANCE — verified 2026-09-07
 *   portal    data.economie.gouv.fr (OpenDataSoft Explore v2.1)
 *   dataset   fiscalite-locale-des-particuliers   (174,668 rows, several exercices)
 *   exercice  2025, discovered at run time — 34,874 communes
 *   field     taux_global_tfb — the all-in rate: commune share + intercommunal
 *             share + the special/GEMAPI add-ons, which is what a household
 *             actually pays on the base foncière bâtie
 *
 * WHY IT RETURNED "HTTP 400: Bad Request" — and it is NOT a stale dataset id or
 * a typo in the query, both of which still work exactly as written.
 * OpenDataSoft caps the /records endpoint at offset + limit <= 10000. With
 * ~34,900 communes per exercice, paginateODS() walks past that on its 101st
 * page, asks for offset 10000 + limit 100, and the API answers
 *   InvalidRESTParameterError: "Invalid value for sum of offset + limit API
 *   parameter: 10100 was found but <= 10000 is expected."
 * The offset walk can therefore never complete on this dataset, at any page
 * size. /exports/csv has no such cap and streams the whole selection in one
 * request (624 KB for the three columns we need), so that is what we use.
 * Do not "fix" this by going back to /records and paginateODS.
 *
 * The latest-exercice probe still uses /records deliberately: it is a group_by
 * that returns a single row, comfortably inside the cap.
 *
 * KNOWN GAP: ~90 communes present in geo.api.gouv.fr have no row for the
 * exercice — chiefly the collectivités d'outre-mer, which are outside the DGFiP
 * fiscalité locale perimeter.
 */
async function ingestLocalTax(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'localTax';
  const SOURCE = 'DGFiP - Fiscalité Locale';
  const HIGHER_IS_BETTER = false;
  const DATASET = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers';

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Getting latest year...');
  const yearUrl = `${DATASET}/records?select=exercice&group_by=exercice&order_by=exercice DESC&limit=1`;
  const yearResponse = await fetchWithRetry(yearUrl);
  const yearData = await yearResponse.json();
  const latestYear = yearData.results?.[0]?.exercice || '2025';
  log(`  Using exercice: ${latestYear}`);

  log('Step 3: Exporting tax rates (CSV export, not /records — see above)...');
  const exportUrl = new URL(`${DATASET}/exports/csv`);
  exportUrl.searchParams.set('select', 'insee_com,taux_global_tfb');
  exportUrl.searchParams.set('where', `exercice="${latestYear}"`);
  exportUrl.searchParams.set('delimiter', ';');
  const exportRes = await fetchWithRetry(exportUrl.toString());
  const csvText = await exportRes.text();
  log(`  Downloaded ${(csvText.length / 1024).toFixed(0)} KB CSV`);

  const taxRates = new Map<string, number>();
  let header: string[] | null = null;
  let codeIdx = -1;
  let rateIdx = -1;

  forEachDelimitedRow(csvText, ';', (cells) => {
    if (header === null) {
      header = cells;
      codeIdx = header.indexOf('insee_com');
      rateIdx = header.indexOf('taux_global_tfb');
      if (codeIdx === -1 || rateIdx === -1) {
        throw new Error(`Required columns not found. Headers: ${header.join(', ')}`);
      }
      return;
    }
    const code = cells[codeIdx];
    const rate = Number(cells[rateIdx]);
    // A rate of exactly 0 is a real answer for a handful of communes; only a
    // blank or non-numeric cell means "no data".
    if (code && cells[rateIdx] !== '' && Number.isFinite(rate)) {
      taxRates.set(code, rate);
    }
  });
  log(`  Parsed ${taxRates.size} communes`);

  log('Step 4: Filtering to valid communes...');
  const filtered = new Map<string, number>();
  for (const [code, rate] of taxRates) {
    if (validCodes.has(code)) filtered.set(code, rate);
  }
  log(`  ${filtered.size} communes matched`);

  log('Step 5: Calculating scores and ranks...');
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

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
  const records = buildRecords(filtered, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 5: Upserting to database...');
  const result = await upsertCriterionValues(records);
  log(`  Inserted: ${result.inserted}, Errors: ${result.errors}`);

  return { inserted: result.inserted, errors: result.errors, communes: filtered.size };
}

// --- Property Prices ---

/**
 * DVF — "Demandes de valeurs foncières" — is DGFiP's open register of every
 * property transaction passed before a notaire, republished by Etalab in a
 * geocoded CSV form. This criterion used to read it through api.cquest.org one
 * commune at a time: 34,969 HTTP requests, which is why it shipped with its own
 * "will take a long time" warning and why it had never once produced a row.
 * Etalab publishes the same register in bulk, and that is what we read now:
 *
 *   https://files.data.gouv.fr/geo-dvf/latest/csv/<year>/departements/<dept>.csv.gz
 *
 * ~97 gzipped files per year, 1-3 MB each, so a three-year national pull is
 * under 300 requests and about a minute of wall clock instead of 35k requests
 * that never finished.
 *
 * WHY PER-DÉPARTEMENT AND NOT THE SIBLING `<year>/full.csv.gz`. One request per
 * year is tempting, but full.csv.gz is ~95 MB gzipped and close to a gigabyte
 * of text once inflated. downloadGzipped() — like any gunzipSync().toString() —
 * has to materialise that as a single JavaScript string, which is at or past the
 * engine's maximum string length and would sit in memory whole either way. The
 * département files inflate to 10-30 MB, are folded into per-commune samples
 * immediately and then dropped, so peak memory stays flat however many years we
 * ask for.
 *
 * WHY THREE YEARS AND NOT ONE. A single year leaves thousands of small communes
 * with one or two sales. Measured on the Loire (dept 42): one year prices 254 of
 * its 320 communes, three years price 307. Three years is also the usual window
 * for commune-level €/m² indicators, and it is what makes the national reference
 * population large enough for the percentile scoring to mean anything.
 *
 * KNOWN COVERAGE GAPS — expected, not bugs:
 *   - Bas-Rhin (67), Haut-Rhin (68) and Moselle (57) keep the Alsace-Moselle
 *     "livre foncier" land registry rather than the national fichier immobilier
 *     and are excluded from DVF by law. That is ~1,605 communes with no data
 *     ever; the départements listing simply does not offer those three files.
 *   - Mayotte (976) is likewise outside DVF.
 *   - Communes under MIN_TRANSACTIONS qualifying sales in the window are left
 *     out rather than handed a "median" of one sale.
 * Together that puts the national population near 28-29k of France's 34,969
 * communes — about 86% of the ~33,300 DVF covers at all. A run reporting 34,969
 * here would be the suspicious one.
 */

const DVF_BASE_URL = 'https://files.data.gouv.fr/geo-dvf/latest/csv';

/** Data-sanity band, not a market judgement: real communes span ~400-12,000 €/m². */
const DVF_MIN_PRICE_PER_SQM = 100;
const DVF_MAX_PRICE_PER_SQM = 20000;

/**
 * DVF books Paris, Lyon and Marseille by arrondissement (75101-75120,
 * 69381-69389, 13201-13216). The communes table follows INSEE's official commune
 * list, which knows only the parent commune (75056, 69123, 13055), so without
 * this fold the three largest cities in France would silently end up with no
 * price at all — a gap that reads as a rendering bug on the map rather than as a
 * join that never matched. Corsican codes (2A004, 2B033…) coerce to NaN and fall
 * through untouched, which is the intended behaviour.
 */
function dvfParentCommune(code: string): string {
  const n = Number(code);
  if (n >= 75101 && n <= 75120) return '75056';
  if (n >= 69381 && n <= 69389) return '69123';
  if (n >= 13201 && n <= 13216) return '13055';
  return code;
}

/**
 * The most recent published years of the geo-dvf export, newest first, read from
 * the directory listing so the window rolls forward on its own — DVF gains a
 * year folder each April. The computed fallback keeps the ingest alive if that
 * listing's markup ever changes, at the cost of possibly asking for a year that
 * does not exist yet (which then fails harmlessly, one year at a time).
 */
async function latestDvfYears(count: number, log: LogFn): Promise<string[]> {
  try {
    const res = await fetchWithRetry(`${DVF_BASE_URL}/`);
    const html = await res.text();
    const listed = [...new Set(Array.from(html.matchAll(/\/csv\/(\d{4})\//g), (m) => m[1]))]
      .sort()
      .reverse()
      .slice(0, count);
    if (listed.length === count) return listed;
    log(`  Listing offered only ${listed.length} year(s); computing the window instead`);
  } catch (e) {
    log(`  Could not read the year listing (${e instanceof Error ? e.message : e}); computing the window instead`);
  }
  // From April onwards the previous calendar year is the newest complete one.
  const newest = new Date().getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => String(newest - i));
}

/**
 * Which département files a given year actually publishes. Asking the listing
 * rather than generating 01..95 ourselves is the difference between *learning*
 * that Alsace-Moselle is absent and 404ing on the same three files forever —
 * this file already has one runner that 404s on all 96 of its downloads.
 */
async function dvfDepartements(year: string, log: LogFn): Promise<string[]> {
  const res = await fetchWithRetry(`${DVF_BASE_URL}/${year}/departements/`);
  const html = await res.text();
  const depts = [...new Set(Array.from(html.matchAll(/\/(\d{2,3}|2A|2B)\.csv\.gz/g), (m) => m[1]))];
  if (depts.length < 80) {
    throw new Error(`only ${depts.length} département files listed — the export layout has probably changed`);
  }
  log(`  ${year}: ${depts.length} département files published`);
  return depts;
}

interface DvfMutation {
  communeCode: string;
  valeurFonciere: number;
  dwellingSurface: number;
  dwellingCount: number;
  hasNonDwellingLocal: boolean;
  spansCommunes: boolean;
}

interface DvfStats {
  rows: number;
  mutations: number;
  kept: number;
  rejectedMultiCommune: number;
  rejectedMixedUse: number;
  rejectedNotSingleDwelling: number;
  rejectedOutOfBand: number;
  malformedRows: number;
}

/**
 * Fold one département-year CSV into per-commune €/m² samples.
 *
 * THE TRAP THIS AVOIDS. A DVF row is one parcel/lot line, not one sale, and
 * `valeur_fonciere` is the price of the WHOLE sale repeated on every row of it.
 * A flat sold with a cellar and a garage is three rows all carrying the same
 * price. Dividing a row's valeur_fonciere by that row's surface — exactly what
 * the old per-commune implementation did — therefore counted one price three
 * times, and on a two-lot sale doubled the €/m². Everything below is grouped by
 * `id_mutation` first and only then turned into a price.
 *
 * What survives the filter, and why:
 *   - nature_mutation = 'Vente'. Excludes VEFA (off-plan new builds, a different
 *     market), échanges, adjudications and bare building land.
 *   - Exactly one Appartement or Maison in the sale. A €/m² only means something
 *     for a single home; an apartment block sold in one go is a wholesale price
 *     and pulls a commune's median down by hundreds of euros. Measured on the
 *     Loire, allowing multi-dwelling sales moves the median from 1,577 to 1,317.
 *   - No commercial or industrial local in the sale, because a mixed lot cannot
 *     be split into its residential share.
 *   - The whole sale inside one commune, since we attribute it to one.
 *   - "Dépendance" rows (garages, cellars) ride along and are tolerated: they
 *     carry no surface_reelle_bati of their own.
 *   - €/m² inside the sanity band, which drops symbolic 1 € family transfers and
 *     misplaced-decimal entry errors at both ends (~0.3% of sales).
 */
function accumulateDvfPrices(csv: string, out: Map<string, number[]>, stats: DvfStats): void {
  const lines = csv.split('\n');
  if (lines.length < 2) return;

  const header = lines[0].trim().split(',');
  const iMutation = header.indexOf('id_mutation');
  const iNature = header.indexOf('nature_mutation');
  const iValue = header.indexOf('valeur_fonciere');
  const iCommune = header.indexOf('code_commune');
  const iType = header.indexOf('type_local');
  const iSurface = header.indexOf('surface_reelle_bati');
  if (iMutation < 0 || iNature < 0 || iValue < 0 || iCommune < 0 || iType < 0 || iSurface < 0) {
    throw new Error(`DVF CSV is missing expected columns (header starts: ${header.slice(0, 6).join(', ')})`);
  }

  // Scoped to this one file on purpose. A sale does not span two départements in
  // practice, and holding every mutation in France at once is what makes a
  // national pass run out of memory — 3.65M of them across three years.
  const mutations = new Map<string, DvfMutation>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    stats.rows++;

    // The export escapes nothing — commas inside values are substituted at
    // source, which is why the label "Local industriel. commercial ou assimilé"
    // carries a full stop where French writes a comma — so a plain split is
    // correct. The field count is still checked, so a future change to that
    // shows up as skipped rows rather than as silently shifted columns.
    const cols = line.split(',');
    if (cols.length !== header.length) {
      stats.malformedRows++;
      continue;
    }
    if (cols[iNature] !== 'Vente') continue;

    const communeCode = cols[iCommune];
    const valeurFonciere = Number(cols[iValue]);
    if (!communeCode || !(valeurFonciere > 0)) continue;

    const id = cols[iMutation];
    let mutation = mutations.get(id);
    if (!mutation) {
      mutation = {
        communeCode,
        valeurFonciere,
        dwellingSurface: 0,
        dwellingCount: 0,
        hasNonDwellingLocal: false,
        spansCommunes: false,
      };
      mutations.set(id, mutation);
    }
    if (mutation.communeCode !== communeCode) mutation.spansCommunes = true;

    const type = cols[iType];
    if (type === 'Appartement' || type === 'Maison') {
      const surface = Number(cols[iSurface]);
      if (surface > 0) {
        mutation.dwellingSurface += surface;
        mutation.dwellingCount++;
      }
    } else if (type && type !== 'Dépendance') {
      mutation.hasNonDwellingLocal = true;
    }
  }

  for (const mutation of mutations.values()) {
    stats.mutations++;
    if (mutation.spansCommunes) {
      stats.rejectedMultiCommune++;
      continue;
    }
    if (mutation.hasNonDwellingLocal) {
      stats.rejectedMixedUse++;
      continue;
    }
    if (mutation.dwellingCount !== 1 || mutation.dwellingSurface <= 0) {
      stats.rejectedNotSingleDwelling++;
      continue;
    }

    const pricePerSqm = mutation.valeurFonciere / mutation.dwellingSurface;
    if (pricePerSqm < DVF_MIN_PRICE_PER_SQM || pricePerSqm > DVF_MAX_PRICE_PER_SQM) {
      stats.rejectedOutOfBand++;
      continue;
    }

    stats.kept++;
    const code = dvfParentCommune(mutation.communeCode);
    const samples = out.get(code);
    if (samples) samples.push(pricePerSqm);
    else out.set(code, [pricePerSqm]);
  }
}

/** Median of a sample list, without disturbing the caller's array. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function ingestPropertyPrice(log: LogFn): Promise<IngestionResult> {
  const CRITERION_ID = 'propertyPrice';
  const SOURCE = 'DVF - data.gouv.fr (geo-dvf bulk export)';
  const HIGHER_IS_BETTER = false;
  const YEARS_OF_HISTORY = 3;
  /** A median over fewer sales than this is one transaction wearing a disguise. */
  const MIN_TRANSACTIONS = 3;
  const DOWNLOAD_CONCURRENCY = 8;

  log('Step 1: Fetching commune codes...');
  const validCodes = await getCommuneCodes();
  log(`  ${validCodes.size} communes in database`);

  log('Step 2: Resolving the DVF bulk export...');
  const years = await latestDvfYears(YEARS_OF_HISTORY, log);
  log(`  Years: ${years.join(', ')}`);

  log('Step 3: Downloading département files...');
  const samples = new Map<string, number[]>();
  const stats: DvfStats = {
    rows: 0,
    mutations: 0,
    kept: 0,
    rejectedMultiCommune: 0,
    rejectedMixedUse: 0,
    rejectedNotSingleDwelling: 0,
    rejectedOutOfBand: 0,
    malformedRows: 0,
  };
  let downloaded = 0;
  let failed = 0;

  for (const year of years) {
    let depts: string[];
    try {
      depts = await dvfDepartements(year, log);
    } catch (e) {
      // One year missing is survivable — the others still give a national
      // population. All of them missing is not, and the guard below catches it.
      log(`  ${year}: skipped (${e instanceof Error ? e.message : e})`);
      continue;
    }

    for (let i = 0; i < depts.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = depts.slice(i, i + DOWNLOAD_CONCURRENCY);
      await Promise.all(
        batch.map(async (dept) => {
          try {
            const csv = await downloadGzipped(`${DVF_BASE_URL}/${year}/departements/${dept}.csv.gz`);
            // Folded here rather than after the Promise.all so each 10-30 MB
            // string is collectable the moment its file is reduced. The fold is
            // fully synchronous, so the shared Map is never touched by two
            // callbacks at once.
            accumulateDvfPrices(csv, samples, stats);
            downloaded++;
          } catch {
            failed++;
          }
        })
      );
    }
    log(`  ${year}: ${downloaded} files read, ${failed} failed, ${stats.kept} usable sales so far`);
  }

  if (stats.kept === 0) {
    throw new Error('DVF bulk export yielded no usable transactions — the URL or CSV layout has changed');
  }
  log(`  ${stats.rows} rows -> ${stats.mutations} sales -> ${stats.kept} single-dwelling sales`);
  log(
    `  Rejected: ${stats.rejectedNotSingleDwelling} not a single dwelling, ${stats.rejectedMixedUse} mixed-use, ` +
      `${stats.rejectedMultiCommune} spanning communes, ${stats.rejectedOutOfBand} outside the €/m² band, ` +
      `${stats.malformedRows} malformed rows`
  );

  log('Step 4: Taking a median €/m² per commune...');
  const prices = new Map<string, number>();
  let thinSamples = 0;
  let unknownCodes = 0;
  for (const [code, values] of samples) {
    if (values.length < MIN_TRANSACTIONS) {
      thinSamples++;
      continue;
    }
    // DVF still carries codes for communes that have since merged or been
    // renumbered. They are dropped, not guessed at.
    if (!validCodes.has(code)) {
      unknownCodes++;
      continue;
    }
    prices.set(code, Math.round(medianOf(values)));
  }
  log(
    `  ${prices.size} communes priced (${thinSamples} under ${MIN_TRANSACTIONS} sales, ` +
      `${unknownCodes} codes absent from the communes table)`
  );

  if (prices.size === 0) throw new Error('No price data found');

  log('Step 5: Calculating scores and ranks...');
  const records = buildRecords(prices, CRITERION_ID, SOURCE, HIGHER_IS_BETTER, log);

  log('Step 6: Upserting to database...');
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
