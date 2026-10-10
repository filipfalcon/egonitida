import { Option } from 'effect';

export interface Summary {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

// Nearest-rank percentile: the smallest sample at or above the given share of all samples.
const percentile = (sorted: ReadonlyArray<number>, share: number): number =>
  sorted[Math.max(Math.ceil(share * sorted.length) - 1, 0)] ?? Number.NaN;

export const summarize = (samples: ReadonlyArray<number>): Option.Option<Summary> => {
  if (samples.length === 0) {
    return Option.none();
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return Option.some({
    count: sorted.length,
    mean: sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? Number.NaN,
  });
};

/** The time between each moment and the one before it. */
export const gaps = (moments: ReadonlyArray<number>): ReadonlyArray<number> =>
  moments.slice(1).map((moment, index) => moment - (moments[index] ?? moment));
