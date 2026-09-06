/**
 * Build the credential-free fixture that backs ARCHIMAP_FIXTURE=1.
 *
 * The app has no committed .env and must never touch a live Supabase project,
 * so /map is unobservable out of the box: every data route 500s on a missing
 * client. This script produces a static stand-in for those routes' payloads —
 * real commune geometry from geo.api.gouv.fr (the same public source
 * scripts/ingest/geo.ts already uses) plus synthetic-but-plausible criterion
 * values — written to public/fixtures/, which is gitignored.
 *
 * Scores are NOT invented directly. Raw values are generated first, then run
 * through the production normalizeToScore(), so the fixture inherits the real
 * ingest semantics: the stored score is already flipped by higherIsBetter, and
 * 100 always means "good". A fixture that hand-wrote scores could disagree with
 * that invariant and would then mask exactly the direction bugs the colour code
 * is written to defend against.
 *
 * Usage: bun run fixture:build
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeToScore } from '../../src/lib/admin/scoring';

// Mirrors DEMO_DEPARTEMENTS in src/app/map/page.tsx.
const DEPARTEMENTS = ['34', '30', '11', '66', '09', '31', '81', '12', '48', '07'];

const OUT = join(process.cwd(), 'public', 'fixtures');
const SEED_SQL = join(process.cwd(), 'supabase', 'migrations', '20260226000100_seed_criteria.sql');

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

  // Split top-level "( ... )" tuples, respecting '' escapes inside strings.
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
    return {
      id: unquote(fields[0]),
      name: unquote(fields[1]),
      nameEn: unquote(fields[2]),
      category: unquote(fields[3]),
      description: unquote(fields[4]),
      unit: unquote(fields[5]),
      source: unquote(fields[6]),
      lastUpdated: unquote(fields[7]),
      higherIsBetter: fields[8].trim() === 'true',
      colorScale: { low: unquote(fields[9]), mid: unquote(fields[10]), high: unquote(fields[11]) },
    };
  });
}

function splitFields(tuple: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  let depth = 0;
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
  if (!t.startsWith("'")) return t;
  return t.slice(1, -1).replace(/''/g, "'");
}

/** Deterministic hash -> [0,1), so a rebuild produces byte-identical output. */
function hash01(...parts: (string | number)[]): number {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * A spatially smooth field, so the choropleth reads like geography rather than
 * static. Without this every criterion looks like the same noise and a weight
 * change produces no visible structure to judge.
 */
function smoothField(lng: number, lat: number, phase: number): number {
  const a = Math.sin(lng * 0.9 + phase * 2.1) * Math.cos(lat * 1.1 - phase * 1.7);
  const b = Math.sin((lng + lat) * 0.55 + phase * 3.3);
  const c = Math.cos(lat * 2.3 + phase * 0.8) * 0.5;
  return (a + b + c) / 2.5; // roughly [-1, 1]
}

interface Centroid { lng: number; lat: number }

/** Cheap centroid: mean of the outer ring vertices. Enough to drive the field. */
function centroidOf(geometry: { type: string; coordinates: unknown }): Centroid {
  const rings: number[][][] =
    geometry.type === 'Polygon'
      ? [(geometry.coordinates as number[][][])[0]]
      : (geometry.coordinates as number[][][][]).map((p) => p[0]);
  let sx = 0, sy = 0, n = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) { sx += x; sy += y; n++; }
  }
  return n ? { lng: sx / n, lat: sy / n } : { lng: 0, lat: 0 };
}

/**
 * Shrink geometry for the browser: round to ~11 m and drop points that round
 * onto their predecessor. Communes render at zoom 7-9 here, where the dropped
 * detail is sub-pixel, and the payload falls by roughly two thirds.
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
    // A ring needs >= 4 positions and must stay closed.
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

/**
 * Per-criterion coverage, deliberately partial and uneven.
 *
 * Real coverage is ~3% (tasket 20260826-1606: the DB was scored against a
 * truncated population and never re-ingested), so "this commune has no value
 * for this criterion" is the common case, not an edge case. A fixture with
 * 100% coverage would make the composite's renormalisation path unreachable
 * and hide the exact behaviour that most needs looking at.
 */
const COVERAGE: Record<string, number> = {
  temperature: 0.97,
  sunshine: 0.95,
  rainfall: 0.93,
  propertyPrice: 0.72,
  localTax: 0.68,
  hospitalAccess: 0.88,
  publicTransport: 0.61,
  internetSpeed: 0.9,
  crimeRate: 0.55,
  culturalVenues: 0.64,
  employmentRate: 0.85,
  medianIncome: 0.82,
};

/** Plausible raw-value ranges, so the detail panel shows sane units. */
const RANGES: Record<string, [number, number]> = {
  temperature: [9, 17],
  sunshine: [1700, 2900],
  rainfall: [450, 1500],
  propertyPrice: [900, 6500],
  localTax: [18, 55],
  hospitalAccess: [4, 65],
  publicTransport: [5, 95],
  internetSpeed: [8, 950],
  crimeRate: [8, 85],
  culturalVenues: [0, 30],
  employmentRate: [48, 78],
  medianIncome: [16000, 34000],
};

async function main() {
  await mkdir(join(OUT, 'geo'), { recursive: true });

  const criteria = await parseCriteriaFromSeed();
  console.log(`Parsed ${criteria.length} criteria from the seed migration.`);

  await writeFile(
    join(OUT, 'criteria.json'),
    JSON.stringify(Object.fromEntries(criteria.map((c) => [c.id, c])), null, 0)
  );

  // --- regions (the no-criterion view) ---
  //
  // geo.api.gouv.fr serves commune contours but silently omits geometry for
  // regions (`?geometry=contour` returns bare {code, nom}), so region outlines
  // come from france-geojson instead — the other public source
  // scripts/ingest/generate-sql.ts already pulls from.
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

  // --- communes per demo département ---
  const centroids = new Map<string, Centroid>();
  const communeMeta = new Map<string, { nom: string; population: number | null; dept: string }>();

  for (const dept of DEPARTEMENTS) {
    console.log(`Fetching communes for département ${dept}...`);
    const res = await fetch(
      `https://geo.api.gouv.fr/departements/${dept}/communes?format=geojson&geometry=contour&fields=code,nom,population`
    );
    if (!res.ok) throw new Error(`département ${dept}: HTTP ${res.status}`);
    const fc = await res.json();

    const features = fc.features.map((f: { properties: { code: string; nom: string; population?: number }; geometry: { type: string; coordinates: unknown } }) => {
      const code = f.properties.code;
      centroids.set(code, centroidOf(f.geometry));
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

  // --- criterion values, scored through the production normalizer ---
  console.log('Generating criterion values...');
  const codes = [...centroids.keys()].sort();

  // scores[communeCode][criterionId] = { value, score, rank }
  const scores: Record<string, Record<string, { value: number; score: number; rank: number }>> = {};
  for (const code of codes) scores[code] = {};

  for (const [ci, crit] of criteria.entries()) {
    const raw = new Map<string, number>();
    const [lo, hi] = RANGES[crit.id] ?? [0, 100];
    const coverage = COVERAGE[crit.id] ?? 0.8;

    for (const code of codes) {
      if (hash01('coverage', crit.id, code) > coverage) continue; // no data here
      const c = centroids.get(code)!;
      const field = smoothField(c.lng, c.lat, ci * 1.37);
      const jitter = (hash01('jitter', crit.id, code) - 0.5) * 0.25;
      const t = Math.max(0, Math.min(1, (field + 1) / 2 + jitter));
      raw.set(code, lo + t * (hi - lo));
    }

    const allValues = [...raw.values()];
    // Rank by the criterion's own direction, matching calculateRanks().
    const ranked = [...raw.entries()].sort((a, b) =>
      crit.higherIsBetter ? b[1] - a[1] : a[1] - b[1]
    );
    const rankOf = new Map<string, number>();
    ranked.forEach(([code], i) => rankOf.set(code, i + 1));

    for (const [code, value] of raw) {
      scores[code][crit.id] = {
        value: Number(value.toFixed(2)),
        score: normalizeToScore(value, allValues, crit.higherIsBetter),
        rank: rankOf.get(code)!,
      };
    }
    console.log(`  ${crit.id}: ${raw.size}/${codes.length} communes (${((raw.size / codes.length) * 100).toFixed(0)}% coverage)`);
  }

  await writeFile(join(OUT, 'scores.json'), JSON.stringify(scores));
  await writeFile(
    join(OUT, 'communes.json'),
    JSON.stringify(Object.fromEntries(communeMeta))
  );
  await writeFile(
    join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        departements: DEPARTEMENTS,
        communeCount: codes.length,
        criteria: criteria.map((c) => c.id),
        note: 'Synthetic criterion values over real geometry. Not real-world data.',
      },
      null,
      2
    )
  );

  console.log(`\nDone. ${codes.length} communes across ${DEPARTEMENTS.length} départements -> public/fixtures/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
