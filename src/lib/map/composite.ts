/**
 * Weighted composite scoring — the map's "how well does this commune match
 * what I care about" number.
 *
 * DIRECTION INVARIANT — read src/lib/map/colors.ts first.
 *
 * Single-criterion colouring juggles three places that must agree: ingest
 * flips `score` by `higherIsBetter` so 100 always means "good", the per-criterion
 * `colorScale` is authored in RAW-VALUE order, and interpolateColor()
 * re-inverts the score to index that raw-ordered palette.
 *
 * The composite sits OUTSIDE that dance and must stay outside it:
 *
 *  - Its inputs are already-flipped `score` values, so every input is in
 *    100-is-good space regardless of its criterion's raw direction. A weighted
 *    mean of them is therefore also in 100-is-good space.
 *  - It has no `higherIsBetter` of its own — "a bit of temperature and a bit of
 *    rainfall" has no raw direction — and no raw-ordered palette.
 *
 * So the composite MUST NOT be coloured through interpolateColor(): that
 * function's re-inversion exists to undo a flip the composite never had, and
 * applying it would silently reverse the map for any lower-is-better
 * criterion. compositeColor() in colors.ts is its counterpart, authored
 * good-to-bad and mapping 100 -> good directly.
 */

export interface CompositeResult {
  /**
   * 0-100 where 100 is good, or null when no weighted criterion has data for
   * this commune (so the caller can render "no data" rather than a fake 0).
   */
  score: number | null;
  /**
   * Share of the requested weight actually backed by data, 0-1. A commune
   * scored on 2 of 5 weighted criteria is not as trustworthy as one scored on
   * all 5, and the composite alone cannot show that difference.
   */
  coverage: number;
  /** Weighted criteria this commune actually has a score for. */
  presentCount: number;
  /** Weighted criteria in total (weight > 0). */
  weightedCount: number;
}

export const EMPTY_COMPOSITE: CompositeResult = {
  score: null,
  coverage: 0,
  presentCount: 0,
  weightedCount: 0,
};

/**
 * Weighted mean of per-criterion scores, renormalised over the criteria this
 * commune actually has.
 *
 * MISSING DATA. Coverage is partial and uneven by design (real coverage is ~3%
 * — the database was scored against a truncated population and never
 * re-ingested), so "this commune is missing a weighted criterion" is the common
 * case, not an edge case. Three options were available:
 *
 *   1. Exclude the commune entirely -> an almost empty map; the tool stops
 *      being usable long before the data is fixed.
 *   2. Substitute a neutral 50 -> a full-looking map that quietly asserts
 *      average performance on things nobody measured. It lies, and it lies
 *      most about exactly the communes with the least data.
 *   3. Renormalise the weights over what IS present, and report coverage.
 *
 * (3) is what this does. A commune scored only on climate is ranked on climate
 * alone — an honest answer to a narrower question — and `coverage` carries the
 * caveat to the UI instead of burying it.
 */
export function compositeScore(
  scores: Record<string, number> | undefined,
  weights: Record<string, number>
): CompositeResult {
  let totalWeight = 0;
  let presentWeight = 0;
  let weightedSum = 0;
  let presentCount = 0;
  let weightedCount = 0;

  for (const [criterionId, weight] of Object.entries(weights)) {
    if (!(weight > 0)) continue; // also rejects NaN
    totalWeight += weight;
    weightedCount++;

    const score = scores?.[criterionId];
    if (typeof score !== 'number' || Number.isNaN(score)) continue;

    presentWeight += weight;
    weightedSum += weight * score;
    presentCount++;
  }

  if (totalWeight === 0 || presentWeight === 0) {
    return { ...EMPTY_COMPOSITE, weightedCount };
  }

  return {
    score: weightedSum / presentWeight,
    coverage: presentWeight / totalWeight,
    presentCount,
    weightedCount,
  };
}
