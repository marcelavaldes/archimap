/**
 * Fixture-mode backing for the admin panel.
 *
 * The public map only ever reads, so its fixture is three static files. The
 * admin panel reads *and* writes, which raises a question the map never had to
 * answer: what should "save" do when there is no database?
 *
 * The answer here is: change what you see, and say plainly that it went
 * nowhere. Every mutation is applied to a process-lifetime overlay so the UI
 * actually responds — a toggle flips, an edit shows up in the list, a new
 * criterion appears — and every mutating response carries `persisted: false`
 * plus a human-readable `fixtureNote`, which the admin layout renders as a
 * standing banner. The failure mode being avoided is the one where a screen
 * looks like it saved, the developer believes the write path works, and the
 * first time anyone finds out otherwise is in production.
 *
 * The overlay lives in module scope, so it is per dev-server process and is
 * lost on restart or on a hot recompile of this file. That is deliberate: it is
 * a lens over the fixture, not a database.
 */
import {
  loadFixture,
  type FixtureAdminCriterion,
  type FixtureCommunes,
  type FixtureScores,
} from '.';

/** Header every fixture-backed admin response carries, mirroring the public routes. */
export const FIXTURE_HEADER = { 'X-Archimap-Fixture': '1', 'Cache-Control': 'no-store' };

/** Shape of the `criterion_coverage` view, as the admin routes hand it out. */
export interface FixtureCoverage {
  criterion_id: string;
  name: string;
  enabled: boolean;
  communes_with_data: number;
  total_communes: number;
  coverage_percent: number;
  oldest_data: string | null;
  newest_data: string | null;
}

/** One row of `criterion_values` joined to its commune, as the data screen wants it. */
export interface FixtureValueRow {
  id: string;
  commune_code: string;
  criterion_id: string;
  value: number;
  score: number;
  rank_national: number;
  source_date: string | null;
  communes: { nom: string };
}

// ─────────────────────────────────────────────────────────────────────────────
//  The write overlay
// ─────────────────────────────────────────────────────────────────────────────

/** Column patches applied over the fixture row, by criterion id. */
const patches = new Map<string, Partial<FixtureAdminCriterion>>();
/** Criteria created in this process; they exist nowhere on disk. */
const created = new Map<string, FixtureAdminCriterion>();
/** Criteria deleted in this process. */
const deleted = new Set<string>();

/** Human-readable note attached to every fixture-mode write response. */
export const NOT_PERSISTED =
  'Mode fixture : modification appliquée en mémoire uniquement, rien n’a été écrit en base. ' +
  'Elle disparaîtra au redémarrage du serveur.';

export function fixtureWriteResult<T extends object>(body: T): T & {
  fixture: true;
  persisted: false;
  fixtureNote: string;
} {
  return { ...body, fixture: true, persisted: false, fixtureNote: NOT_PERSISTED };
}

export function patchCriterion(id: string, patch: Partial<FixtureAdminCriterion>): void {
  if (created.has(id)) {
    created.set(id, { ...created.get(id)!, ...patch });
    return;
  }
  patches.set(id, { ...(patches.get(id) ?? {}), ...patch });
}

export function createCriterion(row: FixtureAdminCriterion): void {
  deleted.delete(row.id);
  created.set(row.id, row);
}

export function deleteCriterion(id: string): void {
  created.delete(id);
  patches.delete(id);
  deleted.add(id);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reads
// ─────────────────────────────────────────────────────────────────────────────

interface FixtureBundle {
  criteria: FixtureAdminCriterion[];
  communes: FixtureCommunes;
  scores: FixtureScores;
}

/**
 * Parsed fixture, memoised for the process.
 *
 * scores.json is ~1.7 MB and every admin screen touches it; re-parsing per
 * request turned the dashboard into a visible stall. The files are static
 * build output, so there is nothing to invalidate.
 */
let bundle: Promise<FixtureBundle> | null = null;

function loadBundle(request: Request): Promise<FixtureBundle> {
  bundle ??= (async () => {
    const [criteria, communes, scores] = await Promise.all([
      loadFixture<FixtureAdminCriterion[]>(request, 'admin-criteria.json'),
      loadFixture<FixtureCommunes>(request, 'communes.json'),
      loadFixture<FixtureScores>(request, 'scores.json'),
    ]);
    return { criteria, communes, scores };
  })().catch((err) => {
    // Do not memoise a failure — a missing fixture is fixed by running
    // `bun run fixture:build`, and the next request should see that.
    bundle = null;
    throw err;
  });
  return bundle;
}

/** Every criterion, overlay applied, in display_order. */
export async function fixtureCriteria(request: Request): Promise<FixtureAdminCriterion[]> {
  const { criteria } = await loadBundle(request);
  const rows = criteria
    .filter((c) => !deleted.has(c.id))
    .map((c) => ({ ...c, ...(patches.get(c.id) ?? {}) }));
  rows.push(...created.values());
  return rows.sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id));
}

export async function fixtureCriterion(
  request: Request,
  id: string
): Promise<FixtureAdminCriterion | null> {
  return (await fixtureCriteria(request)).find((c) => c.id === id) ?? null;
}

/**
 * The `criterion_coverage` view, recomputed from the fixture's own scores.
 *
 * Counting rather than storing a number matters: the fixture's coverage is
 * deliberately partial and uneven (54-98%), and if these figures were baked in
 * they could drift away from the values the map is actually colouring, which
 * would make the dashboard a decoration instead of a check.
 *
 * `oldest_data` / `newest_data` come from the criterion's own `last_updated`.
 * The fixture writes all of a criterion's values in one pass, which is exactly
 * what a single ingest run produces, so both ends of the range are that date.
 */
export async function fixtureCoverage(request: Request): Promise<FixtureCoverage[]> {
  const { communes, scores } = await loadBundle(request);
  const criteria = await fixtureCriteria(request);
  const totalCommunes = Object.keys(communes).length;

  const counts = new Map<string, number>();
  for (const entries of Object.values(scores)) {
    for (const criterionId of Object.keys(entries)) {
      counts.set(criterionId, (counts.get(criterionId) ?? 0) + 1);
    }
  }

  return criteria.map((c) => {
    const withData = counts.get(c.id) ?? 0;
    return {
      criterion_id: c.id,
      name: c.name,
      enabled: c.enabled,
      communes_with_data: withData,
      total_communes: totalCommunes,
      coverage_percent: totalCommunes
        ? Math.round((withData / totalCommunes) * 10000) / 100
        : 0,
      oldest_data: withData ? c.last_updated : null,
      newest_data: withData ? c.last_updated : null,
    };
  });
}

/** Total number of criterion_values rows the fixture stands for. */
export async function fixtureValueCount(request: Request): Promise<number> {
  const { scores } = await loadBundle(request);
  let n = 0;
  for (const entries of Object.values(scores)) n += Object.keys(entries).length;
  return n;
}

export async function fixtureCommuneCount(request: Request): Promise<number> {
  return Object.keys((await loadBundle(request)).communes).length;
}

/**
 * One page of a criterion's values, matching what the real route returns.
 *
 * The sort is `score DESC, commune_code ASC`. The tiebreaker is not cosmetic:
 * scores are integers 0-100 over thousands of communes, so ties are the rule,
 * and an offset page walk over a non-unique sort key has no defined row order —
 * the same defect as commit dc99aa2. Sorting here the way the SQL route now
 * sorts keeps the fixture an honest stand-in rather than a kinder one.
 */
export async function fixtureValues(
  request: Request,
  criterionId: string,
  { page, limit, search }: { page: number; limit: number; search: string }
): Promise<{ data: FixtureValueRow[]; total: number }> {
  const { communes, scores } = await loadBundle(request);
  const criterion = await fixtureCriterion(request, criterionId);
  const needle = search.trim().toLowerCase();

  const rows: FixtureValueRow[] = [];
  for (const [code, entries] of Object.entries(scores)) {
    const entry = entries[criterionId];
    if (!entry) continue;
    const nom = communes[code]?.nom ?? code;
    if (needle && !nom.toLowerCase().includes(needle)) continue;
    rows.push({
      id: `${criterionId}:${code}`,
      commune_code: code,
      criterion_id: criterionId,
      value: entry.value,
      score: entry.score,
      rank_national: entry.rank,
      source_date: criterion?.last_updated ?? null,
      communes: { nom },
    });
  }

  rows.sort((a, b) => b.score - a.score || a.commune_code.localeCompare(b.commune_code));

  const offset = (page - 1) * limit;
  return { data: rows.slice(offset, offset + limit), total: rows.length };
}
