/**
 * Capture REAL criterion data offline, with no database.
 *
 * src/lib/admin/ingestion-runners.ts already fetches genuine open data for all
 * twelve criteria (INSEE, ARCEP, DVF, Météo France SYNOP, data.culture,
 * data.economie...). It has never been run to completion against the live
 * project — tasket 20260826-1606 is still open and human-gated — so the map has
 * nothing to draw. That tasket needs Supabase console access; this script does
 * not, and it gets real numbers onto the map today.
 *
 * The runners touch the database in exactly two places:
 *   - getCommuneCodes()        -> communes table, for the valid-code reference set
 *   - upsertCriterionValues()  -> criterion_values, the write
 *
 * Both are replaced here with bun's mock.module, so NOTHING in src/ changes and
 * the production ingestion path is untouched. The reference set comes from
 * geo.api.gouv.fr instead (~34,900 communes, comfortably over the 30,000 guard),
 * and writes are captured to JSON.
 *
 * SCORING IS NATIONAL, ON PURPOSE. Values are fetched and scored across all of
 * France exactly as the real pipeline does, and only then filtered to the target
 * département. A Loire commune scoring 30 therefore means "30th percentile in
 * France", which is what the real database would hold — not "30th percentile
 * within Loire", which would look better on the map and mean something else.
 * The download is large at capture time; the fixture that ships is small.
 *
 * Usage:
 *   bun run scripts/fixture/capture-real.ts --dept 42                 # all criteria
 *   bun run scripts/fixture/capture-real.ts --dept 42 --only internetSpeed,localTax
 *   bun run scripts/fixture/capture-real.ts --dept 42 --list
 *
 * Output: fixtures-raw/<criterionId>.json  (gitignored, national + filtered)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mock } from 'bun:test';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'fixtures-raw');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const DEPT = arg('dept', '42')!;
const ONLY = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);

interface CriterionRecord {
  commune_code: string;
  criterion_id: string;
  value: number;
  score: number;
  rank_national: number;
  source: string;
  source_date: string;
}

/** Every record any runner tried to write, keyed by criterion. */
const captured = new Map<string, CriterionRecord[]>();

// ── Stub the two database touchpoints ────────────────────────────────────────

let communeCodesCache: string[] | null = null;

/** National commune list from geo.api.gouv.fr, standing in for the communes table. */
async function nationalCommuneCodes(): Promise<string[]> {
  if (communeCodesCache) return communeCodesCache;
  const res = await fetch('https://geo.api.gouv.fr/communes?fields=code&format=json');
  if (!res.ok) throw new Error(`geo.api.gouv.fr communes: HTTP ${res.status}`);
  const rows: { code: string }[] = await res.json();
  communeCodesCache = rows.map((r) => r.code).sort();
  return communeCodesCache;
}

await mock.module(join(ROOT, 'src/lib/admin/supabase.ts'), () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== 'communes') {
        throw new Error(`capture-real: unexpected table "${table}" — only communes is stubbed`);
      }
      // Mirrors the .select('code').order('code').range(from, to) chain in
      // getCommuneCodes(), including its {data, error} result shape.
      const chain = {
        select: () => chain,
        order: () => chain,
        async range(from: number, to: number) {
          const codes = await nationalCommuneCodes();
          return { data: codes.slice(from, to + 1).map((code) => ({ code })), error: null };
        },
      };
      return chain;
    },
  }),
}));

const realScoring = await import(join(ROOT, 'src/lib/admin/scoring.ts'));

await mock.module(join(ROOT, 'src/lib/admin/scoring.ts'), () => ({
  ...realScoring,
  // Capture instead of writing. Everything upstream — fetching, nearest-station
  // mapping, normalizeToScore, calculateRanks — is the untouched real code.
  upsertCriterionValues: async (records: CriterionRecord[]) => {
    const id = records[0]?.criterion_id ?? 'unknown';
    captured.set(id, records);
    return { inserted: records.length, errors: 0, sampleErrors: [] };
  },
}));

// Imported AFTER the mocks so the runners bind to the stubs.
const { ingestionRunners } = await import(join(ROOT, 'src/lib/admin/ingestion-runners.ts'));

// ── Run ──────────────────────────────────────────────────────────────────────

const allIds = Object.keys(ingestionRunners);

if (hasFlag('list')) {
  console.log(allIds.join('\n'));
  process.exit(0);
}

const targets = ONLY ?? allIds;
const unknown = targets.filter((t) => !allIds.includes(t));
if (unknown.length) {
  console.error(`Unknown criteria: ${unknown.join(', ')}\nKnown: ${allIds.join(', ')}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const summary: Record<string, { ok: boolean; national?: number; inDept?: number; error?: string; durationMs: number }> = {};

for (const id of targets) {
  const started = Date.now();
  console.log(`\n━━━ ${id} ━━━`);
  captured.delete(id);

  try {
    await ingestionRunners[id]((m: string) => console.log(`  ${m}`));

    const records = captured.get(id) ?? [];
    const inDept = records.filter((r) => r.commune_code.startsWith(DEPT));

    await writeFile(
      join(OUT_DIR, `${id}.json`),
      JSON.stringify(
        {
          criterionId: id,
          capturedAt: new Date().toISOString(),
          dept: DEPT,
          nationalCount: records.length,
          deptCount: inDept.length,
          source: records[0]?.source ?? null,
          sourceDate: records[0]?.source_date ?? null,
          // Scores/ranks are national; only the rows are filtered.
          records: inDept,
        },
        null,
        0
      )
    );

    summary[id] = { ok: true, national: records.length, inDept: inDept.length, durationMs: Date.now() - started };
    console.log(`  ✓ ${records.length} national, ${inDept.length} in dept ${DEPT}`);
  } catch (e) {
    summary[id] = { ok: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started };
    console.log(`  ✗ ${summary[id].error}`);
  }
}

await writeFile(join(OUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

console.log('\n═══ SUMMARY ═══');
for (const [id, s] of Object.entries(summary)) {
  console.log(
    s.ok
      ? `  ✓ ${id.padEnd(16)} ${String(s.inDept).padStart(4)} communes in ${DEPT}  (${String(s.national).padStart(6)} national, ${(s.durationMs / 1000).toFixed(0)}s)`
      : `  ✗ ${id.padEnd(16)} ${s.error?.slice(0, 90)}`
  );
}
