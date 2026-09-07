# Deploying the demo

The public demo runs in **fixture mode**: it serves committed static files and never
contacts Supabase. That is deliberate, and it is what makes it deployable today.

The real pipeline is blocked on tasket `20260826-1606`, which is human-gated — it needs the
Supabase service-role key rotated, migrations applied to the live project, and a full
re-ingest, none of which can be done from this repository. The demo does not wait on any of
that.

## What ships

Committed under `public/fixtures/` (~2.4 MB):

| File | Contents |
|------|----------|
| `geo/communes-42.geojson` | 320 real commune contours for Loire, from `geo.api.gouv.fr` |
| `geo/regions.geojson` | 13 region outlines, for the no-criterion overview |
| `criteria.json` | only the criteria that have real data |
| `scores.json` | real values and **national** percentile scores |
| `communes.json` | name / population / département |
| `manifest.json` | per-criterion source, coverage and resolution — drives the demo banner |

The fixture is committed rather than generated during the build on purpose: a deploy should
not fail because `geo.api.gouv.fr` is having a bad afternoon.

## The one manual step

Set **`ARCHIMAP_FIXTURE=1`** in the Vercel project.

**Scope it to Preview, not Production.** Setting it on Production would put the real
deployment into demo mode, which is exactly the confusion this flag exists to avoid.

    Vercel → Project → Settings → Environment Variables
      Key:          ARCHIMAP_FIXTURE
      Value:        1
      Environments: ☑ Preview   ☐ Production   ☐ Development

Then push the branch; Vercel builds a preview per branch automatically. Redeploy if the
branch was already built before the variable existed — env changes do not retrigger a build.

## Verifying it worked

    curl -s https://<preview-url>/api/criteria | head -c 200

Expect criteria JSON, and an `X-Archimap-Fixture: 1` response header. If you get
*"Your project's URL and Key are required to create a Supabase client!"*, the variable is
not set on that environment.

On `/map` the amber **Démo** banner should be visible at the top. If it is missing, the app
is not in fixture mode — the banner self-detects by fetching `/fixtures/manifest.json`, so
it can never mislabel a live Supabase deployment as a demo.

## What a viewer sees, and what they should be told

- **Loire (42) only.** Not a France-wide map. The PRD's MVP scope is all 35,000 communes,
  which the current architecture cannot serve — `/api/geo` assembles GeoJSON in Postgres per
  request and France is ~50 MB. Splitting geometry out to tiles is tasket `20260826-1610`.
- **Real open data, partial coverage.** Only the criteria listed in the banner have data.
  The rest are named as unavailable and are **not** simulated.
- **Scores are national percentiles.** A commune scoring 30 sits at the 30th percentile in
  France, not within Loire. This matters when reading the map: a département that is
  uniformly middling nationally will look uniformly middling here, and that is correct.
- **Some sources are coarse.** The banner's *Nuances* column is how many distinct values a
  source resolves across the département. Météo France SYNOP resolves 3, because it has 60
  stations for all of France. Anything under 10 is flagged amber.

## Regenerating the fixture

```bash
bun run scripts/fixture/capture-real.ts --dept 42   # slow: national download, real sources
bun run fixture:build                                # assembles public/fixtures/
```

Change the scope in `src/lib/map/region.ts` — one place, read by the map, the fixture
builder and the fixture server. `build-fixture` prunes geometry for départements the config
no longer lists.

## Not this

Do **not** deploy fixture mode to Production as a way of making the site "look finished".
The banner makes it honest for a viewer who reads it; a production URL serving one
département of partially-covered data under no banner would not be.
