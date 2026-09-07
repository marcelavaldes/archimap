/**
 * Build the credential-free fixture that backs ARCHIMAP_FIXTURE=1.
 *
 * The app has no committed .env and must never touch a live Supabase project,
 * so /map is unobservable out of the box: every data route 500s on a missing
 * client. This script produces a static stand-in for those routes' payloads.
 *
 * REAL DATA ONLY. Geometry comes from geo.api.gouv.fr and criterion values come
 * from `fixtures-raw/`, captured by scripts/fixture/capture-real.ts running the
 * production ingestion runners against genuine open data (INSEE, ARCEP, DVF,
 * Météo France, data.culture, data.economie). Nothing here is synthesised.
 *
 * An earlier version of this script generated plausible-looking values from a
 * smooth spatial field. That was fine for exercising the UI and actively
 * harmful for judging the product: a demo whose numbers are invented cannot
 * tell you whether the pipeline works, and it looks exactly like one that can.
 * If a criterion has no captured data it is OMITTED — never filled in.
 *
 * Usage:
 *   bun run scripts/fixture/capture-real.ts --dept 42   # once, slow, network
 *   bun run fixture:build
 */
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEMO_REGION } from '../../src/lib/map/region';

const ROOT = process.cwd();
const OUT = join(ROOT, 'public', 'fixtures');
const RAW = join(ROOT, 'fixtures-raw');
const SEED_SQL = join(ROOT, 'supabase', 'migrations', '20260226000100_seed_criteria.sql');

interface FixtureCriterion {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  description: string;
  unit: string;
  source: string;
  lastUpdated: string;
  higherIsBetter: boolean;
  colorScale: { low: string; mid: string; high: string };
}

/**
 * Parse the criteria straight out of the seed migration rather than duplicating
 * them here, so the fixture cannot drift from what a real database would hold.
 */
async function parseCriteriaFromSeed(): Promise<FixtureCriterion[]> {
  const sql = await readFile(SEED_SQL, 'utf8');
  const body = sql.slice(sql.indexOf('VALUES') + 'VALUES'.length);

  const tuples: string[] = [];
  let depth = 0;
  let current = '';
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "'" && body[i + 1] === "'") { current += "''"; i++; continue; }
      if (ch === "'") inStr = false;
      current += ch;
      continue;
    }
    if (ch === "'") { inStr = true; current += ch; continue; }
    if (ch === '(') { depth++; if (depth === 1) { current = ''; continue; } }
    if (ch === ')') { depth--; if (depth === 0) { tuples.push(current); continue; } }
    if (depth > 0) current += ch;
  }

  return tuples.map((t) => {
    const f = splitFields(t);
    return {
      id: unquote(f[0]), name: unquote(f[1]), nameEn: unquote(f[2]),
      category: unquote(f[3]), description: unquote(f[4]), unit: unquote(f[5]),
      source: unquote(f[6]), lastUpdated: unquote(f[7]),
      higherIsBetter: f[8].trim() === 'true',
      colorScale: { low: unquote(f[9]), mid: unquote(f[10]), high: unquote(f[11]) },
    };
  });
}

function splitFields(tuple: string): string[] {
  const out: string[] = [];
  let cur = '', inStr = false, depth = 0;
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inStr) {
      if (ch === "'" && tuple[i + 1] === "'") { cur += "''"; i++; continue; }
      if (ch === "'") inStr = false;
      cur += ch;
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(f: string): string {
  const t = f.trim();
  return t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : t;
}

/**
 * Shrink geometry for the browser: round to ~11 m and drop points that round
 * onto their predecessor. At the demo's zoom one screen pixel is roughly 60 m,
 * so the discarded detail is well below a pixel, and the payload falls by
 * roughly two thirds.
 */
const PRECISION = 4;
function simplifyGeometry(geometry: { type: string; coordinates: unknown }) {
  const round = (v: number) => Number(v.toFixed(PRECISION));
  const ring = (r: number[][]) => {
    const out: number[][] = [];
    for (const [x, y] of r) {
      const p = [round(x), round(y)];
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    if (out.length < 4) return r.map(([x, y]) => [round(x), round(y)]);
    const first = out[0], final = out[out.length - 1];
    if (first[0] !== final[0] || first[1] !== final[1]) out.push([first[0], first[1]]);
    return out;
  };
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: (geometry.coordinates as number[][][]).map(ring) };
  }
  return {
    type: 'MultiPolygon',
    coordinates: (geometry.coordinates as number[][][][]).map((poly) => poly.map(ring)),
  };
}

interface RawCapture {
  criterionId: string;
  capturedAt: string;
  dept: string;
  nationalCount: number;
  deptCount: number;
  source: string | null;
  sourceDate: string | null;
  records: {
    commune_code: string;
    criterion_id: string;
    value: number;
    score: number;
    rank_national: number;
    source: string;
    source_date: string;
  }[];
}

/** Load every captured criterion, skipping ones that produced nothing usable. */
async function loadCaptures(): Promise<Map<string, RawCapture>> {
  const out = new Map<string, RawCapture>();
  let files: string[];
  try {
    files = (await readdir(RAW)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  } catch {
    throw new Error(
      `No captured data at ${RAW}.\n` +
        `Run this first (slow, needs network):\n` +
        `  bun run scripts/fixture/capture-real.ts --dept ${DEMO_REGION.departements[0]}`
    );
  }

  for (const file of files) {
    const capture: RawCapture = JSON.parse(await readFile(join(RAW, file), 'utf8'));
    if (capture.records.length === 0) continue;

    // A criterion whose every commune scores identically carries no
    // information — it colours the map a single flat shade and reads as
    // working. Treat it as missing rather than shipping a lie by omission.
    const scores = new Set(capture.records.map((r) => r.score));
    if (scores.size <= 1) {
      console.warn(`  ! ${capture.criterionId}: all ${capture.records.length} communes share score ${[...scores][0]} — degenerate, skipping`);
      continue;
    }
    out.set(capture.criterionId, capture);
  }
  return out;
}

async function main() {
  await mkdir(join(OUT, 'geo'), { recursive: true });

  const allCriteria = await parseCriteriaFromSeed();
  console.log(`Parsed ${allCriteria.length} criteria from the seed migration.`);

  const captures = await loadCaptures();
  console.log(`Loaded ${captures.size} criteria with usable real data.`);

  // --- regions (the no-criterion overview) ---
  console.log('Fetching regions...');
  const regionsRes = await fetch(
    'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/regions-version-simplifiee.geojson'
  );
  if (!regionsRes.ok) throw new Error(`regions: HTTP ${regionsRes.status}`);
  const regionsFc = await regionsRes.json();
  const regionFeatures = regionsFc.features.map((f: { properties: { code: string; nom: string }; geometry: { type: string; coordinates: unknown } }) => ({
    type: 'Feature',
    id: f.properties.code,
    properties: { code: f.properties.code, nom: f.properties.nom, level: 'region' },
    geometry: simplifyGeometry(f.geometry),
  }));
  await writeFile(
    join(OUT, 'geo', 'regions.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: regionFeatures })
  );
  console.log(`  ${regionFeatures.length} regions`);

  // --- communes for the demo région ---
  const communeMeta = new Map<string, { nom: string; population: number | null; dept: string }>();

  for (const dept of DEMO_REGION.departements) {
    console.log(`Fetching communes for département ${dept}...`);
    const res = await fetch(
      `https://geo.api.gouv.fr/departements/${dept}/communes?format=geojson&geometry=contour&fields=code,nom,population`
    );
    if (!res.ok) throw new Error(`département ${dept}: HTTP ${res.status}`);
    const fc = await res.json();

    const features = fc.features.map((f: { properties: { code: string; nom: string; population?: number }; geometry: { type: string; coordinates: unknown } }) => {
      const code = f.properties.code;
      communeMeta.set(code, {
        nom: f.properties.nom,
        population: f.properties.population ?? null,
        dept,
      });
      return {
        type: 'Feature',
        id: code,
        properties: {
          code,
          nom: f.properties.nom,
          level: 'commune',
          population: f.properties.population ?? null,
        },
        geometry: simplifyGeometry(f.geometry),
      };
    });

    const json = JSON.stringify({ type: 'FeatureCollection', features });
    await writeFile(join(OUT, 'geo', `communes-${dept}.geojson`), json);
    console.log(`  ${features.length} communes, ${(json.length / 1e6).toFixed(1)} MB`);
  }

  // --- criterion values, straight from the real capture ---
  const scores: Record<string, Record<string, { value: number; score: number; rank: number }>> = {};
  const provenance: Record<string, unknown> = {};
  const shipped: FixtureCriterion[] = [];

  for (const criterion of allCriteria) {
    const capture = captures.get(criterion.id);
    if (!capture) {
      provenance[criterion.id] = { status: 'no-data', reason: 'capture missing, empty, or degenerate' };
      continue;
    }

    let inRegion = 0;
    for (const r of capture.records) {
      if (!communeMeta.has(r.commune_code)) continue; // outside the demo région
      (scores[r.commune_code] ??= {})[criterion.id] = {
        value: r.value,
        score: r.score,
        rank: r.rank_national,
      };
      inRegion++;
    }

    if (inRegion === 0) {
      provenance[criterion.id] = { status: 'no-data', reason: 'no records inside the demo région' };
      continue;
    }

    // The criterion's real source wins over the seed migration's placeholder.
    shipped.push({ ...criterion, source: capture.source ?? criterion.source, lastUpdated: capture.sourceDate ?? criterion.lastUpdated });
    provenance[criterion.id] = {
      status: 'real',
      source: capture.source,
      sourceDate: capture.sourceDate,
      communes: inRegion,
      coverage: Number((inRegion / communeMeta.size).toFixed(3)),
      // Scores are national percentiles: values were fetched and scored across
      // all of France, then filtered here. A score of 30 means 30th percentile
      // nationally, not within the demo région.
      scoredAgainst: capture.nationalCount,
    };
    console.log(`  ${criterion.id}: ${inRegion}/${communeMeta.size} communes (${capture.source})`);
  }

  if (shipped.length === 0) {
    throw new Error('No criteria had usable real data — refusing to build an empty fixture.');
  }

  await writeFile(
    join(OUT, 'criteria.json'),
    JSON.stringify(Object.fromEntries(shipped.map((c) => [c.id, c])))
  );
  await writeFile(join(OUT, 'scores.json'), JSON.stringify(scores));
  await writeFile(join(OUT, 'communes.json'), JSON.stringify(Object.fromEntries(communeMeta)));
  await writeFile(
    join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        region: DEMO_REGION,
        communeCount: communeMeta.size,
        criteriaShipped: shipped.map((c) => c.id),
        criteriaOmitted: allCriteria.filter((c) => !shipped.some((s) => s.id === c.id)).map((c) => c.id),
        provenance,
        note: 'Real open data. Scores are national percentiles; rows filtered to the demo région.',
      },
      null,
      2
    )
  );

  console.log(
    `\nDone. ${communeMeta.size} communes, ${shipped.length}/${allCriteria.length} criteria with real data -> public/fixtures/`
  );
  const omitted = allCriteria.filter((c) => !shipped.some((s) => s.id === c.id));
  if (omitted.length) console.log(`Omitted (no usable data): ${omitted.map((c) => c.id).join(', ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
