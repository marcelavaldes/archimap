import { describe, expect, test } from 'bun:test';
import { normalizeToScore, calculateRanks, assertSufficientCommuneCount, EXPECTED_MIN_COMMUNES, percentileBounds, scoreFromBounds } from './scoring';

describe('normalizeToScore', () => {
  // 100 values, 0..99, so p2Index = floor(100*0.02) = 2 -> p2 = 2,
  // p98Index = floor(100*0.98) = 98 -> p98 = 98.
  const reference = Array.from({ length: 100 }, (_, i) => i);

  test('scores the 2nd-percentile value at 0 when higher is better', () => {
    expect(normalizeToScore(2, reference, true)).toBe(0);
  });

  test('scores the 98th-percentile value at 100 when higher is better', () => {
    expect(normalizeToScore(98, reference, true)).toBe(100);
  });

  test('clamps values below the 2nd percentile rather than extrapolating', () => {
    expect(normalizeToScore(-1000, reference, true)).toBe(0);
  });

  test('clamps values above the 98th percentile rather than extrapolating', () => {
    expect(normalizeToScore(1000, reference, true)).toBe(100);
  });

  test('inverts the result when higherIsBetter is false', () => {
    expect(normalizeToScore(2, reference, false)).toBe(100);
    expect(normalizeToScore(98, reference, false)).toBe(0);
  });

  test('returns 50 for a degenerate set where p2 === p98', () => {
    const flat = Array.from({ length: 100 }, () => 42);
    expect(normalizeToScore(42, flat, true)).toBe(50);
    expect(normalizeToScore(42, flat, false)).toBe(50);
  });

  test('returns 50 when allValues is empty', () => {
    expect(normalizeToScore(50, [], true)).toBe(50);
  });

  test('reference-set regression: the same raw value scores differently against a truncated vs. full population', () => {
    // This is the exact shape of the truncation bug fixed in ee697cd: an
    // unpaginated select silently capped the commune fetch at 1,000 rows out
    // of ~35,000, so every score was computed against a 3% slice of France
    // instead of the whole country. A correct percentile-clip implementation
    // MUST be sensitive to the size/shape of the reference population — if a
    // raw value produced the identical score against both population sizes,
    // that would mean the reference set was being ignored entirely.
    const truncated = Array.from({ length: 1000 }, (_, i) => i); // 0..999
    const full = Array.from({ length: 35000 }, (_, i) => i); // 0..34999

    const rawValue = 990;
    const scoreAgainstTruncated = normalizeToScore(rawValue, truncated, true);
    const scoreAgainstFull = normalizeToScore(rawValue, full, true);

    expect(scoreAgainstTruncated).toBe(100); // clipped: 990 is above the truncated set's p98 (980)
    expect(scoreAgainstFull).toBeLessThan(scoreAgainstTruncated);
    expect(scoreAgainstFull).not.toBe(scoreAgainstTruncated);
  });
});

describe('calculateRanks', () => {
  test('ranks descending when higherIsBetter is true, rank 1 is the best', () => {
    const values = new Map([
      ['a', 10],
      ['b', 30],
      ['c', 20],
    ]);
    const ranks = calculateRanks(values, true);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
    expect(ranks.get('a')).toBe(3);
  });

  test('ranks ascending when higherIsBetter is false, rank 1 is still the best commune', () => {
    const values = new Map([
      ['a', 10],
      ['b', 30],
      ['c', 20],
    ]);
    const ranks = calculateRanks(values, false);
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('c')).toBe(2);
    expect(ranks.get('b')).toBe(3);
  });

  test('tied values share a rank (competition ranking), and the next distinct value skips ahead', () => {
    const values = new Map([
      ['a', 30],
      ['b', 30],
      ['c', 20],
      ['d', 10],
    ]);
    const ranks = calculateRanks(values, true);
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(3);
    expect(ranks.get('d')).toBe(4);
  });
});

describe('assertSufficientCommuneCount (pagination guard)', () => {
  test('throws when the commune count falls below the floor', () => {
    expect(() => assertSufficientCommuneCount(1000)).toThrow(/Commune count too low/);
  });

  test('does not throw when the commune count meets the floor', () => {
    expect(() => assertSufficientCommuneCount(EXPECTED_MIN_COMMUNES)).not.toThrow();
    expect(() => assertSufficientCommuneCount(35000)).not.toThrow();
  });
});


describe('batch scoring (percentileBounds + scoreFromBounds)', () => {
  // normalizeToScore sorts the whole reference population on every call, so
  // scoring N rows against an N-row population is O(N^2 log N) — about eight
  // minutes at the ~35,000 communes of a national ingest, which is why a full
  // ingest never completed. The batch path hoists the sort out of the loop.
  // These tests exist to stop the two paths drifting apart: normalizeToScore is
  // now a thin wrapper over the same two functions, and must stay that way.
  const reference = Array.from({ length: 1000 }, (_, i) => i * 3.7);

  test('batch path agrees with normalizeToScore for every sampled value, higher-is-better', () => {
    const bounds = percentileBounds(reference);
    for (const value of reference.filter((_, i) => i % 37 === 0)) {
      expect(scoreFromBounds(value, bounds, true)).toBe(normalizeToScore(value, reference, true));
    }
  });

  test('batch path agrees with normalizeToScore for every sampled value, lower-is-better', () => {
    const bounds = percentileBounds(reference);
    for (const value of reference.filter((_, i) => i % 37 === 0)) {
      expect(scoreFromBounds(value, bounds, false)).toBe(normalizeToScore(value, reference, false));
    }
  });

  test('percentileBounds returns null for an empty population, and scoreFromBounds falls back to 50', () => {
    expect(percentileBounds([])).toBeNull();
    expect(scoreFromBounds(42, null, true)).toBe(50);
  });

  test('a degenerate population (p2 === p98) scores 50 rather than dividing by zero', () => {
    const flat = Array.from({ length: 100 }, () => 7);
    expect(scoreFromBounds(7, percentileBounds(flat), true)).toBe(50);
  });

  test('direction invariant survives the batch path: 100 still means good', () => {
    const bounds = percentileBounds(reference);
    const best = reference[reference.length - 1];
    const worst = reference[0];
    // higher-is-better: the largest raw value is the good one
    expect(scoreFromBounds(best, bounds, true)).toBe(100);
    expect(scoreFromBounds(worst, bounds, true)).toBe(0);
    // lower-is-better: the smallest raw value is the good one, and the stored
    // score is flipped so 100 still means good
    expect(scoreFromBounds(worst, bounds, false)).toBe(100);
    expect(scoreFromBounds(best, bounds, false)).toBe(0);
  });

  test('scoring a full population is not quadratic: 20k rows complete well under a second', () => {
    const population = Array.from({ length: 20000 }, (_, i) => Math.sin(i) * 1000 + i);
    const started = performance.now();
    const bounds = percentileBounds(population);
    for (const value of population) scoreFromBounds(value, bounds, true);
    const elapsed = performance.now() - started;
    // The per-call path would re-sort 20,000 elements 20,000 times here and
    // take minutes. A generous ceiling still catches a regression to that.
    expect(elapsed).toBeLessThan(2000);
  });
});
