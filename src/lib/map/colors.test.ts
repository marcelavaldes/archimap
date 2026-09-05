import { describe, expect, test } from 'bun:test';
import { interpolateColor } from './colors';
import type { Criterion } from '@/types/criteria';

function makeCriterion(higherIsBetter: boolean): Criterion {
  return {
    id: 'test',
    name: 'Test',
    nameEn: 'Test',
    category: 'quality',
    description: '',
    unit: '',
    source: '',
    lastUpdated: '',
    higherIsBetter,
    colorScale: {
      low: '#ff0000',
      mid: '#ffff00',
      high: '#00ff00',
    },
  };
}

describe('interpolateColor direction invariant', () => {
  // Stored scores are already flipped so 100 always means "good" and 0
  // always means "bad" (see normalizeToScore in src/lib/admin/scoring.ts).
  // colorScale is authored in raw-value order (low -> mid -> high), so for a
  // lower-is-better criterion a *good* commune (score 100, i.e. a low raw
  // value) must resolve toward colorScale.low, not colorScale.high.
  test('lower-is-better: a good commune (score 100) resolves toward colorScale.low', () => {
    const criterion = makeCriterion(false);
    expect(interpolateColor(100, criterion)).toBe(criterion.colorScale.low);
  });

  test('lower-is-better: a bad commune (score 0) resolves toward colorScale.high', () => {
    const criterion = makeCriterion(false);
    expect(interpolateColor(0, criterion)).toBe(criterion.colorScale.high);
  });

  test('higher-is-better: a good commune (score 100) resolves toward colorScale.high', () => {
    const criterion = makeCriterion(true);
    expect(interpolateColor(100, criterion)).toBe(criterion.colorScale.high);
  });

  test('higher-is-better: a bad commune (score 0) resolves toward colorScale.low', () => {
    const criterion = makeCriterion(true);
    expect(interpolateColor(0, criterion)).toBe(criterion.colorScale.low);
  });
});
