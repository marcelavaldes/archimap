import { describe, expect, test } from 'bun:test';
import { compositeScore } from './composite';
import { compositeColor, interpolateColor } from './colors';
import type { Criterion } from '@/types/criteria';

describe('compositeScore weighting', () => {
  test('weights the mean, not just the average', () => {
    const scores = { climate: 100, cost: 0 };

    expect(compositeScore(scores, { climate: 1, cost: 1 }).score).toBe(50);
    expect(compositeScore(scores, { climate: 3, cost: 1 }).score).toBe(75);
    expect(compositeScore(scores, { climate: 1, cost: 3 }).score).toBe(25);
  });

  test('weights need not sum to 1 — only their ratio matters', () => {
    const scores = { a: 80, b: 20 };
    const small = compositeScore(scores, { a: 1, b: 1 }).score;
    const large = compositeScore(scores, { a: 500, b: 500 }).score;
    expect(small).toBe(50);
    expect(large).toBe(50);
  });

  test('a zero-weight criterion is excluded entirely, not counted as present', () => {
    const result = compositeScore({ a: 100, b: 0 }, { a: 1, b: 0 });
    expect(result.score).toBe(100);
    expect(result.weightedCount).toBe(1);
    expect(result.presentCount).toBe(1);
    expect(result.coverage).toBe(1);
  });

  test('all weights zero yields no score rather than a fake 0', () => {
    expect(compositeScore({ a: 100 }, { a: 0, b: 0 }).score).toBeNull();
  });
});

describe('compositeScore missing data', () => {
  // The chosen policy: renormalise over the criteria a commune actually has,
  // and report how much of the requested weight that covered. See the comment
  // on compositeScore for why neutral-50 substitution was rejected.
  test('renormalises over present criteria rather than substituting a neutral 50', () => {
    // Only `a` has data. Neutral-50 substitution would give (100+50)/2 = 75.
    const result = compositeScore({ a: 100 }, { a: 1, b: 1 });
    expect(result.score).toBe(100);
    expect(result.coverage).toBe(0.5);
    expect(result.presentCount).toBe(1);
    expect(result.weightedCount).toBe(2);
  });

  test('coverage reflects weight, not criterion count', () => {
    // `b` is missing but carried 3 of the 4 total weight — coverage is 0.25,
    // even though 1 of 2 criteria was present.
    const result = compositeScore({ a: 60 }, { a: 1, b: 3 });
    expect(result.coverage).toBe(0.25);
    expect(result.presentCount).toBe(1);
  });

  test('a commune with no weighted data at all scores null, not 0', () => {
    const result = compositeScore({ other: 90 }, { a: 1, b: 1 });
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
  });

  test('undefined score map is handled like an empty one', () => {
    expect(compositeScore(undefined, { a: 1 }).score).toBeNull();
  });

  test('NaN scores are treated as missing, not propagated', () => {
    const result = compositeScore({ a: NaN, b: 40 }, { a: 1, b: 1 });
    expect(result.score).toBe(40);
    expect(result.presentCount).toBe(1);
  });
});

describe('composite colour direction invariant', () => {
  // The composite is a weighted mean of scores that ingest already flipped by
  // higherIsBetter, so it is in 100-is-good space and has no raw-value
  // ordering to recover. It therefore gets its own good-to-bad ramp and must
  // never be routed through interpolateColor(), whose re-inversion exists to
  // undo a flip the composite never had.
  test('100 is the good end of the ramp and 0 the bad end', () => {
    expect(compositeColor(100)).toBe('#1a9850'); // green
    expect(compositeColor(0)).toBe('#a50026'); // dark red
  });

  test('the ramp is monotonic from bad to good', () => {
    const greenness = [0, 25, 50, 75, 100].map((s) => {
      const hex = compositeColor(s);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      return g - r; // rises as the ramp moves from red toward green
    });
    for (let i = 1; i < greenness.length; i++) {
      expect(greenness[i]).toBeGreaterThan(greenness[i - 1]);
    }
  });

  test('regression: routing a composite through interpolateColor would flip it', () => {
    // This is the trap the separate ramp exists to avoid. A lower-is-better
    // criterion's palette is authored in raw-value order, so interpolateColor
    // sends score 100 (good) to colorScale.low. Feeding a composite — which
    // has no raw-value order — through that path inverts it.
    const lowerIsBetter: Criterion = {
      id: 'x', name: 'x', nameEn: 'x', category: 'cost', description: '',
      unit: '', source: '', lastUpdated: '', higherIsBetter: false,
      colorScale: { low: '#00ff00', mid: '#ffff00', high: '#ff0000' },
    };

    // A perfect composite (100) is green on its own ramp...
    expect(compositeColor(100)).toBe('#1a9850');
    // ...and interpolateColor happens to agree here only because this
    // palette's `low` is green. Its *mechanism* is the inversion, which is
    // wrong for a composite:
    expect(interpolateColor(100, lowerIsBetter)).toBe('#00ff00');

    // Flip the palette to raw-order red-low (a higher-is-better criterion) and
    // the divergence is explicit: the same composite score would render red.
    const higherIsBetter: Criterion = {
      ...lowerIsBetter,
      higherIsBetter: false,
      colorScale: { low: '#ff0000', mid: '#ffff00', high: '#00ff00' },
    };
    expect(interpolateColor(100, higherIsBetter)).toBe('#ff0000'); // wrong for a composite
    expect(compositeColor(100)).toBe('#1a9850'); // right
  });
});
