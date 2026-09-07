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
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
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
 * The same rows as the `criteria` table actually stores them.
 *
 * /api/criteria projects the table into the camelCase shape the map wants and
 * drops everything the map has no use for; the admin panel edits the raw row,
 * including the four columns that projection discards (enabled, display_order,
 * ingestion_type, api_config). So the fixture emits both shapes from one parse
 * rather than trying to reconstruct the wider one from the narrower.
 */
interface FixtureAdminCriterion {
  id: string;
  name: string;
  name_en: string;
  category: string;
  description: string;
  unit: string;
  source: string;
  last_updated: string | null;
  higher_is_better: boolean;
  color_scale_low: string;
  color_scale_mid: string;
  color_scale_high: string;
  enabled: boolean;
  display_order: number;
  ingestion_type: string;
  api_config: Record<string, string> | null;
}

/**
 * Parse the criteria straight out of the seed migration rather than duplicating
 * them here, so the fixture cannot drift from what a real database would hold.
 */
async function parseCriteriaFromSeed(): Promise<FixtureAdminCriterion[]> {
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
    const fields = splitFields(t);
    const apiConfig = fields[15]?.trim() ?? 'NULL';
    return {
      id: unquote(fields[0]),
      name: unquote(fields[1]),
      name_en: unquote(fields[2]),
      category: unquote(fields[3]),
      description: unquote(fields[4]),
      unit: unquote(fields[5]),
      source: unquote(fields[6]),
      last_updated: fields[7].trim() === 'NULL' ? null : unquote(fields[7]),
      higher_is_better: fields[8].trim() === 'true',
      color_scale_low: unquote(fields[9]),
      color_scale_mid: unquote(fields[10]),
      color_scale_high: unquote(fields[11]),
      enabled: fields[12].trim() === 'true',
      display_order: Number(fields[13].trim()),
      ingestion_type: unquote(fields[14]),
      api_config: apiConfig === 'NULL' ? null : JSON.parse(unquote(apiConfig)),
    };
  });
}

/** The narrower camelCase shape /api/criteria serves to the map. */
function toPublicCriterion(c: FixtureAdminCriterion): FixtureCriterion {
  return {
    id: c.id,
    name: c.name,
    nameEn: c.name_en,
    category: c.category,
    description: c.description,
    unit: c.unit,
    source: c.source,
    lastUpdated: c.last_updated ?? '',
    higherIsBetter: c.higher_is_better,
    colorScale: { low: c.color_scale_low, mid: c.color_scale_mid, high: c.color_scale_high },
  };
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

  // Drop geometry for départements the region config no longer includes.
  // Without this, narrowing the demo scope leaves the previous scope's files
  // behind — 25 MB of Occitanie sitting next to 2 MB of Loire, still served,
  // and silently shipped to a deploy that has no use for them.
  try {
    const stale = (await readdir(join(OUT, 'geo'))).filter((f) => {
      const m = f.match(/^communes-(\w+)\.geojson$/);
      return m && !DEMO_REGION.departements.includes(m[1]);
    });
    for (const f of stale) {
      await rm(join(OUT, 'geo', f));
      console.log(`  pruned stale ${f}`);
    }
  } catch {
    /* first run — nothing to prune */
  }

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
  const shipped: FixtureAdminCriterion[] = [];

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
    // How many genuinely different scores this criterion resolves inside the
    // demo région. A source can be real, complete and still nearly useless at
    // this zoom: SYNOP has 60 weather stations for all of France, so every
    // commune in a département maps to two or three of them and the map paints
    // flat blobs. Recording it lets the UI say so instead of implying
    // per-commune precision the data does not have.
    const distinctScores = new Set(
      capture.records.filter((r) => communeMeta.has(r.commune_code)).map((r) => r.score)
    ).size;

    shipped.push({
      ...criterion,
      source: capture.source ?? criterion.source,
      last_updated: capture.sourceDate ?? criterion.last_updated,
    });
    provenance[criterion.id] = {
      status: 'real',
      source: capture.source,
      sourceDate: capture.sourceDate,
      communes: inRegion,
      distinctScores,
      coverage: Number((inRegion / communeMeta.size).toFixed(3)),
      // Scores are national percentiles: values were fetched and scored across
      // all of France, then filtered here. A score of 30 means 30th percentile
      // nationally, not within the demo région.
      scoredAgainst: capture.nationalCount,
    };
    console.log(
      `  ${criterion.id}: ${inRegion}/${communeMeta.size} communes, ${distinctScores} distinct scores (${capture.source})` +
        (distinctScores < 10 ? '  ← coarse' : '')
    );
  }

  if (shipped.length === 0) {
    throw new Error('No criteria had usable real data — refusing to build an empty fixture.');
  }

  // Public camelCase shape, keyed by id — what /api/criteria serves to the map.
  // Only criteria that actually have data, so the map never renders a slider
  // that cannot move anything.
  await writeFile(
    join(OUT, 'criteria.json'),
    JSON.stringify(Object.fromEntries(shipped.map((c) => [c.id, toPublicCriterion(c)])))
  );

  // Raw-row shape in display_order — what /api/admin/criteria serves. ALL
  // twelve, not just the ones with data: the admin panel manages criteria, and
  // a criterion whose source is broken is exactly what an operator needs to
  // see. Ordered here rather than in the route so the fixture, like the real
  // query's `.order('display_order')`, has one row order.
  await writeFile(
    join(OUT, 'admin-criteria.json'),
    JSON.stringify([...allCriteria].sort((a, b) => a.display_order - b.display_order))
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
