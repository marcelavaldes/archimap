# Weighted Composite Map

The map has two modes, chosen from a toggle at the top of the sidebar.

| Mode | Sidebar | Layer | Colouring |
|------|---------|-------|-----------|
| **Un critère** (default) | criterion picker | `communes-fill` | `interpolateColor()`, per-criterion raw-ordered palette |
| **Pondéré** | one weight slider per criterion | `composite-fill` | `compositeColor()`, single good-to-bad ramp |

Composite mode answers the question the single-criterion view cannot: *"where should I live, given
that I care about climate twice as much as cost?"* Weights are set live and the map recolours as
the sliders move.

## Why two modes rather than one

The single-criterion path is correct, load-bearing, and defended by the three-place direction
invariant documented in `src/lib/map/colors.ts`. Folding a composite into it would have put that
invariant at risk for no gain. The modes share the map instance and the `MANAGED_SOURCES` cleanup,
and nothing else.

## The maths

`compositeScore()` in `src/lib/map/composite.ts` is a weighted mean of per-criterion `score`
values, renormalised over the criteria each commune actually has:

```
score    = Σ(wᵢ · sᵢ) / Σ(wᵢ)      over criteria present for this commune
coverage = Σ(wᵢ) present / Σ(wᵢ) total
```

Weights are relative, not shares — they never have to sum to anything. `0` means ignored.

### Direction: why the composite must not reuse `interpolateColor()`

This is the one trap in the feature, and it fails silently.

Single-criterion colouring balances three facts that must agree: ingest already flips `score` by
`higher_is_better` so **100 always means good**; each criterion's `colorScale` is authored in
**raw-value order**; and `interpolateColor()` **re-inverts** the score to recover the raw-value
position that indexes that palette.

A composite sits outside all three. Its inputs are already-flipped scores, so the weighted mean is
in 100-is-good space. It has no `higher_is_better` of its own — "some temperature and some
rainfall" has no raw direction — and no raw-ordered palette. Running it through
`interpolateColor()` would apply an inversion undoing a flip that never happened, reversing the map
for every lower-is-better criterion **with no error**: the map keeps rendering, just backwards.

So the composite has its own ramp — `compositeColor()` in `src/lib/map/colors.ts`, authored
good-to-bad, mapping 100 → green directly, taking no `Criterion` argument at all. The regression is
pinned by `src/lib/map/composite.test.ts`.

## Missing data

Coverage is partial and uneven — real coverage is ~3% (the database was scored against a truncated
population and never re-ingested), so "this commune lacks a weighted criterion" is the *common*
case. Three options were considered:

1. **Exclude the commune** → an almost-empty map; useless long before the data is fixed.
2. **Substitute a neutral 50** → a full-looking map that asserts average performance on things
   nobody measured. It lies, and it lies hardest about the communes with the least data.
3. **Renormalise over what is present, and report coverage.** ← chosen

A commune scored on climate alone is ranked on climate alone — an honest answer to a narrower
question. The caveat is surfaced rather than buried:

- `coverage` is rendered as **fill opacity**, so a commune scored on two of five weighted criteria
  reads as visibly less certain than one scored on all five.
- The legend reports communes scored and mean coverage.
- Communes with no weighted data at all are grey, never coloured — `compositeScore()` returns
  `null`, and `hasComposite` is carried in feature state separately so that an unset value cannot
  be coerced to `0` and painted as "worst possible place".

## Where weights live

In the URL: `?mode=composite&w=temperature:5,propertyPrice:1`.

US-4.1 ("Create Client Profile") wanted saved per-client weightings and was deferred with the rest
of the consultant tier. A query string gets most of that value for none of the cost — a weighting
becomes a link you can send, bookmark or reopen — with no accounts, no persistence, no schema. The
composite is never written back to `criterion_values`: it is a per-viewer lens, not ingested data.

Updates use `history.replaceState`, so dragging a slider does not fill the back button.

## Performance

Geometry is the expensive payload (~25 MB for the ten demo départements) and does not vary with
weights, so composite mode fetches it **once**, in parallel across départements, alongside every
criterion's scores from `/api/scores`. After that a weight change is pure client-side arithmetic
plus `setFeatureState` — **no network at all**, which is what makes the sliders feel live rather
than laggy.

`/api/scores` exists for this: `/api/geo` returns one criterion per request, and re-fetching
geometry twelve times to collect twelve criteria would move megabytes to carry kilobytes of
numbers.

Out-of-order loads are guarded by a generation counter, the same hazard fixed in `39412ff` for
commune fetches.

## Known bounds

`DEMO_DEPARTEMENTS` still caps both modes at ten départements. That is a pre-existing architectural
limit (the current design cannot serve all of France), untouched by this feature.
