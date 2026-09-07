# Running the map without credentials

The repo ships no `.env`, and it should not: every data route goes through Supabase, and nothing in
here should reach a live project. The consequence is that a fresh clone renders `/map` as an empty
shell — the page and basemap load fine, and every data call returns 500 with
*"Your project's URL and Key are required to create a Supabase client!"*

That made the map effectively unobservable, so its rendering behaviour was being reasoned about
from source rather than looked at. Fixture mode fixes that.

## Setup

```bash
echo "ARCHIMAP_FIXTURE=1" > .env.local
bun run dev                        # then open /map
```

`public/fixtures/` is committed, so nothing needs downloading to run the demo locally.
`.env.local` is gitignored and contains **no credentials** — that is the whole point.

To deploy this publicly, see [`DEMO_DEPLOYMENT.md`](./DEMO_DEPLOYMENT.md).

## What the fixture is

`public/fixtures/` (committed, ~2.4 MB) holds **real** data for the demo région:

| File | Contents |
|------|----------|
| `criteria.json` | only the criteria that actually have data |
| `geo/regions.geojson` | 13 region outlines (france-geojson) |
| `geo/communes-<dept>.geojson` | real commune contours for the scope in `src/lib/map/region.ts` (geo.api.gouv.fr) |
| `scores.json` | real values and **national** percentile scores |
| `communes.json` | commune name / population / département |
| `manifest.json` | per-criterion source, coverage and resolution |

### Nothing here is synthesised

An earlier version of the builder generated plausible-looking values from a smooth spatial
field. That was fine for exercising the UI and actively harmful for judging the product: a
demo whose numbers are invented cannot tell you whether the pipeline works, and it looks
exactly like one that can. It was removed.

Values now come from `fixtures-raw/`, captured by `scripts/fixture/capture-real.ts`, which
runs **the production ingestion runners against their real sources** — INSEE, ARCEP, DVF,
Météo France, data.culture, data.economie. A criterion with no usable capture is **omitted**,
and the UI names it as unavailable rather than filling it in.

Two rules the builder enforces, both learned the hard way:

- **A criterion whose communes all share one score is treated as missing.** ARCEP's parse
  returned a constant 100 for every commune in France; that renders as a uniform shade and
  reads as working.
- **Coverage is not usefulness.** `manifest.json` records `distinctScores` — how many
  genuinely different values a source resolves inside the région. Météo France SYNOP covers
  320/320 communes and still resolves only 3 shades, because it has 60 stations for all of
  France. The demo banner shows this per criterion and flags anything under 10.

### Capturing real data

```bash
bun run scripts/fixture/capture-real.ts --dept 42          # all criteria, slow
bun run scripts/fixture/capture-real.ts --dept 42 --only medianIncome,localTax
bun run fixture:build
```

The runners touch the database in exactly two places — the commune reference set and the
upsert. `capture-real.ts` replaces both with bun's `mock.module`, so **nothing in `src/`
changes** and the production ingestion path is untouched. The reference set comes from
geo.api.gouv.fr instead, and writes are captured to gitignored `fixtures-raw/`.

**Scoring stays national.** Values are fetched and scored across all of France exactly as
the real pipeline does, and only then filtered to the demo département. A score of 30 means
"30th percentile in France", not "30th percentile within Loire". The download is large at
capture time; the fixture that ships is small.

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
