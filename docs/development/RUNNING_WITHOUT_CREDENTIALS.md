# Running the map without credentials

The repo ships no `.env`, and it should not: every data route goes through Supabase, and nothing in
here should reach a live project. The consequence is that a fresh clone renders `/map` as an empty
shell — the page and basemap load fine, and every data call returns 500 with
*"Your project's URL and Key are required to create a Supabase client!"*

That made the map effectively unobservable, so its rendering behaviour was being reasoned about
from source rather than looked at. Fixture mode fixes that.

## Setup

```bash
bun run fixture:build              # once — downloads real geometry, ~25 MB into public/fixtures/
echo "ARCHIMAP_FIXTURE=1" > .env.local
bun run dev
```

`.env.local` and `public/fixtures/` are both gitignored. The fixture contains **no credentials** —
that is the whole point.

## What the fixture is

`scripts/fixture/build-fixture.ts` writes `public/fixtures/`:

| File | Contents |
|------|----------|
| `criteria.json` | the 12 criteria, parsed out of `supabase/migrations/20260226000100_seed_criteria.sql` |
| `geo/regions.geojson` | 13 region outlines (france-geojson) |
| `geo/communes-<dept>.geojson` | real commune contours for the 10 `DEMO_DEPARTEMENTS` (geo.api.gouv.fr) — 3,347 communes |
| `scores.json` | synthetic criterion values and scores |
| `communes.json` | commune name / population / département |
| `manifest.json` | what was generated, when |

Geometry is **real**, from the same public sources `scripts/ingest/` already uses, so the map looks
like France rather than coloured rectangles. Criterion values are **synthetic** — a smooth spatial
field plus deterministic jitter, so the choropleth reads as geography rather than noise and a
weight change produces visible structure.

Scores are not invented directly. Raw values are generated first and then run through the
production `normalizeToScore()`, so the fixture inherits real ingest semantics: `score` is already
flipped by `higher_is_better`, and 100 always means "good". A fixture that hand-wrote scores could
disagree with that invariant and would then hide exactly the direction bugs the colour code exists
to catch.

Coverage is deliberately partial and uneven (54-98% by criterion), mirroring the real database's
patchiness, so the composite's missing-data renormalisation is actually exercised on screen instead
of being unreachable.

## How routes use it

`src/lib/fixture/index.ts` exports `FIXTURE_MODE` (`process.env.ARCHIMAP_FIXTURE === '1'`). Three
routes short-circuit on it before touching Supabase — `/api/criteria`, `/api/geo/[level]` and
`/api/scores` — and the fixture is read over HTTP from the app's own origin rather than the
filesystem, so it works identically under `runtime = 'edge'`.

With the flag unset — the default, including production — none of that code runs, and the Supabase
paths are exactly as they were.

## Screenshots

```bash
node scripts/dev/screenshot-map.mjs --out .screenshots
# --base http://localhost:3000   --scenario single|composite|all
```

Requires an existing Playwright install; it is not a dependency of this repo, and the script says
so if it cannot find one.

**On waiting.** MapLibre tiles ~25 MB of commune GeoJSON in a worker; under software WebGL that
takes ~11-15 s. A fixed sleep photographs an empty map and invites the conclusion that the
choropleth is broken — it is not. `waitForChoropleth()` polls the live map for actually-rendered
features, so a slow machine produces a late screenshot rather than a wrong one.
