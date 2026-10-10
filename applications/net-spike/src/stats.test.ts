import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { gaps, summarize } from '#src/stats.ts';

describe('stats', () => {
  it('summarizes samples by count, mean, percentiles, and maximum', () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);

    expect(summarize(samples)).toEqual(
      Option.some({ count: 100, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 }),
    );
  });

  it('summarizes nothing as nothing', () => {
    expect(summarize([])).toEqual(Option.none());
  });

  it('does not depend on the order samples arrived in', () => {
    expect(summarize([3, 1, 2])).toEqual(summarize([1, 2, 3]));
  });

  it('measures the gaps between consecutive moments', () => {
    expect(gaps([10, 43, 77, 110])).toEqual([33, 34, 33]);
    expect(gaps([10])).toEqual([]);
  });
});
