/**
 * Credential-free fixture mode.
 *
 * The repo ships no .env, every data route goes through Supabase, and nothing
 * here may contact a live project — so by default /map renders its shell and
 * basemap while every API call 500s on "Your project's URL and Key are
 * required". That makes the map impossible to look at, which is how visual
 * regressions get reasoned about from source instead of observed.
 *
 * With ARCHIMAP_FIXTURE=1 the public read routes short-circuit to static files
 * under public/fixtures/ (built by `bun run fixture:build`, gitignored). The
 * Supabase code paths are untouched and unreachable in this mode; with the flag
 * unset — the default, including production — nothing below runs at all.
 *
 * Fixture files are read over HTTP from the app's own origin rather than the
 * filesystem so this works identically under `runtime = 'edge'` routes, which
 * have no fs access.
 */

export const FIXTURE_MODE = process.env.ARCHIMAP_FIXTURE === '1';

/** Departements the fixture covers; mirrors DEMO_DEPARTEMENTS on the map page. */
export const FIXTURE_DEPARTEMENTS = ['34', '30', '11', '66', '09', '31', '81', '12', '48', '07'];

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
