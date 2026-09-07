/**
 * Credential-free fixture mode.
 *
 * The repo ships no .env, every data route goes through Supabase, and nothing
 * here may contact a live project — so by default /map renders its shell and
 * basemap while every API call 500s on "Your project's URL and Key are
 * required". That makes the map impossible to look at, which is how visual
 * regressions get reasoned about from source instead of observed. The admin
 * panel was worse still: it needs ADMIN_PASSWORD and ADMIN_SESSION_SECRET on
 * top of Supabase, so a fresh clone could not even reach its login form.
 *
 * With ARCHIMAP_FIXTURE=1 the read routes short-circuit to static files under
 * public/fixtures/ (built by `bun run fixture:build`, gitignored). The Supabase
 * code paths are untouched and unreachable in this mode; with the flag unset —
 * the default, including production — nothing below runs at all.
 *
 * Fixture files are read over HTTP from the app's own origin rather than the
 * filesystem so this works identically under `runtime = 'edge'` routes, which
 * have no fs access.
 */

/**
 * Is fixture mode on?
 *
 * A function rather than a module-level const so it is evaluated per call. That
 * matters for the admin auth path (src/lib/admin/session.ts), where a test has
 * to be able to flip the flag and prove that with it unset the fail-closed
 * behaviour is byte-for-byte what it was — a const frozen at import time makes
 * that assertion impossible to write.
 *
 * `process.env.ARCHIMAP_FIXTURE` is referenced statically, not through a
 * computed key, so the Next.js bundler can still inline it into the Edge
 * middleware bundle.
 */
export function isFixtureMode(): boolean {
  return process.env.ARCHIMAP_FIXTURE === '1';
}

/**
 * May fixture mode stand in for the admin credentials?
 *
 * Fixture mode substitutes ADMIN_PASSWORD and ADMIN_SESSION_SECRET so the admin
 * screens can be opened locally with no secrets — see FIXTURE_ADMIN_PASSWORD in
 * src/lib/admin/session.ts. Those substitutes are published in this repo, so
 * this is the one part of fixture mode that could weaken a real deployment, and
 * it carries a second lock: NODE_ENV. A production build refuses the substitute
 * even if ARCHIMAP_FIXTURE somehow leaks into its environment, and falls back to
 * the existing "500, say which variable is missing" behaviour.
 *
 * Deliberately narrower than isFixtureMode(): serving synthetic geometry from a
 * production build is merely wrong, whereas accepting a published password there
 * would be a hole. Only the credential substitution needs the extra lock.
 */
export function isFixtureAdminAllowed(): boolean {
  return isFixtureMode() && process.env.NODE_ENV !== 'production';
}

/**
 * Départements the fixture covers. Re-exported from the map's region config so
 * there is exactly one list; a mismatch here would serve empty
 * FeatureCollections and render a blank map with no error.
 */
export { DEMO_REGION } from '@/lib/map/region';

export class FixtureMissingError extends Error {
  constructor(path: string) {
    super(
      `Fixture file "${path}" is missing. ARCHIMAP_FIXTURE=1 is set but the ` +
        `fixture has not been built — run: bun run fixture:build`
    );
    this.name = 'FixtureMissingError';
  }
}

/** Load a JSON file from public/fixtures/ relative to the request's own origin. */
export async function loadFixture<T>(request: Request, path: string): Promise<T> {
  const url = new URL(`/fixtures/${path}`, new URL(request.url).origin);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new FixtureMissingError(path);
  return (await res.json()) as T;
}

export interface FixtureScoreEntry {
  value: number;
  score: number;
  rank: number;
}

/** scores.json: commune code -> criterion id -> value/score/rank. */
export type FixtureScores = Record<string, Record<string, FixtureScoreEntry>>;

/** communes.json: commune code -> name, population, département. */
export type FixtureCommunes = Record<
  string,
  { nom: string; population: number | null; dept: string }
>;

/**
 * admin-criteria.json: the `criteria` table as the admin API returns it —
 * snake_case DB columns, not the camelCase projection /api/criteria serves.
 *
 * The admin screens edit raw rows (enabled, display_order, ingestion_type,
 * api_config), none of which survive that projection, so the fixture carries
 * both shapes rather than trying to reconstruct one from the other.
 */
export interface FixtureAdminCriterion {
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
