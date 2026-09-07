# Running the app without credentials

The repo ships no `.env`, and it should not: every data route goes through Supabase, and nothing in
here should reach a live project. The consequence is that a fresh clone renders `/map` as an empty
shell — the page and basemap load fine, and every data call returns 500 with
*"Your project's URL and Key are required to create a Supabase client!"*

That made the map effectively unobservable, so its rendering behaviour was being reasoned about
from source rather than looked at. Fixture mode fixes that.

`/admin` was worse. It needs `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` *before* Supabase is even
reached, so without them the middleware fails closed and a fresh clone got a plain-text 500 instead
of a screen — nothing to look at at all. Fixture mode covers the admin panel too, which is how the
defects fixed alongside this were found.

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
| `criteria.json` | camelCase shape `/api/criteria` serves — **only the criteria that actually have data** |
| `admin-criteria.json` | all 12 rows in raw `criteria`-table shape, for the admin screens. The four columns the public projection drops (`enabled`, `display_order`, `ingestion_type`, `api_config`) are what those screens edit — and a criterion whose source is broken is exactly what an operator needs to see, so this file keeps all of them |
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

`src/lib/fixture/index.ts` exports `isFixtureMode()` (`process.env.ARCHIMAP_FIXTURE === '1'`). Every
read route short-circuits on it before touching Supabase — `/api/criteria`, `/api/geo/[level]`,
`/api/scores`, and everything under `/api/admin/` — and the fixture is read over HTTP from the app's
own origin rather than the filesystem, so it works identically under `runtime = 'edge'`.

It is a function, not a constant, so it is evaluated per call. That is what lets
`tests/admin-fixture-auth.test.ts` flip the flag inside one process and assert that with it unset
the fail-closed behaviour is unchanged — an assertion a module-level const would make unwritable.

With the flag unset — the default, including production — none of that code runs, and the Supabase
paths are exactly as they were.

## Logging into the admin panel

Password: **`dev`**.

`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` have published fixture substitutes (`dev`, and a
signing key spelled out in `src/lib/admin/session.ts`). They are reachable only through
`isFixtureAdminAllowed()`, which needs **both** `ARCHIMAP_FIXTURE=1` **and** a non-production
`NODE_ENV`, and only when the real variable is absent — a configured secret always wins.

The extra `NODE_ENV` lock is deliberate. Serving synthetic geometry from a production build would
merely be wrong; accepting a password published in this repo would be a hole. So the credential
substitution — and only the credential substitution — carries a second lock, and a production build
falls back to the existing "500, name the missing variable" behaviour.

Everything else about login is the real thing: the same handler, the same HMAC, the same cookie, the
same middleware gate. Only the two input strings are swapped, so what you see locally is the
production auth path.

## What writes do

Nothing is persisted, and every screen says so.

- The panel shows a standing amber banner while `ARCHIMAP_FIXTURE=1` — not a toast, because a
  notice that fades is one the next person to look does not see.
- Toggling, editing, creating and deleting a criterion apply to a **process-lifetime in-memory
  overlay**, so the UI actually responds, and the response carries `persisted: false` with a note the
  screen renders. Restarting the dev server discards it.
- A CSV upload is parsed, validated and scored for real — that is the part worth exercising — and
  then not written. The result reports lines read versus 0 written.
- "Tout supprimer" deletes nothing and reports how many rows it *would* have deleted.
- An ingestion run stops before the runner: it would fetch a live open-data API and then fail to
  write. The SSE stream, log console and result banner all run; the banner reads **Dry run**, in
  amber, never "Success".

## Screenshots

```bash
node scripts/dev/screenshot-map.mjs   --out .screenshots   # /map
node scripts/dev/screenshot-admin.mjs --out .screenshots   # /admin, all screens
# --base http://localhost:3000
```

Both require an existing Playwright install; it is not a dependency of this repo, and the scripts
say so if they cannot find one.

`screenshot-admin.mjs` is a check as well as a camera: it logs in through the form, asserts the deep
link kept its URL across the middleware rewrite, asserts the fixture banner is present on every
screen, asserts the toggle both moved and admitted it was not persisted, and exits non-zero on any
console error or page error.

**On waiting.** MapLibre tiles ~25 MB of commune GeoJSON in a worker; under software WebGL that
takes ~11-15 s. A fixed sleep photographs an empty map and invites the conclusion that the
choropleth is broken — it is not. `waitForChoropleth()` polls the live map for actually-rendered
features, so a slow machine produces a late screenshot rather than a wrong one. The admin screens
are lighter but have the same shape of problem: they fetch on mount, so each shot waits for a
selector that only the loaded state renders rather than for a timer.
