import { describe, expect, test } from 'bun:test';
import { normalizeToScore, calculateRanks, assertSufficientCommuneCount, EXPECTED_MIN_COMMUNES } from './scoring';

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
