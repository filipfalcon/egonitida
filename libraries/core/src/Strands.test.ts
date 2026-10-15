import { describe, expect, it } from '@effect/vitest';
import * as Strands from '#src/Strands.ts';

/** Guides of two points each, rooted where `roots` says, its first `scalp` over the scalp and the rest down a ponytail. */
const guides = (
  roots: ReadonlyArray<readonly [number, number, number]>,
  scalp = roots.length,
): Strands.Strands => ({
  points: 2,
  scalp,
  ponytail: roots.length - scalp,
  at: roots.flatMap(([x, y, z]) => [x, y, z, x, y - 0.1, z]),
  width: roots.flatMap(() => [0.00008, 0.00003]),
  stiffness: roots.flatMap(() => [1, 0.2]),
  random: roots.map(() => 0.5),
  bones: ['head'],
  joints: roots.flatMap(() => [0, 0, 0, 0, 0, 0, 0, 0]),
  weights: roots.flatMap(() => [1, 0, 0, 0, 1, 0, 0, 0]),
});

describe('Strands.rootOf', () => {
  it('is the first point of a strand', () => {
    const scalp = guides([
      [0, 1.7, 0],
      [0.1, 1.7, 0],
    ]);

    expect(Strands.rootOf(scalp, 1)).toEqual({ x: 0.1, y: 1.7, z: 0 });
  });
});

describe('Strands.bind', () => {
  const four = guides([
    [0, 1.7, 0],
    [0.1, 1.7, 0],
    [0, 1.7, 0.1],
    [1, 1.7, 1],
  ]);

  it('follows the three guides nearest its root, nearer ones more, its weights adding up to a whole', () => {
    const [bound] = Strands.bind(four, { scalp: 1, ponytail: 0 }, [0.02, 1.7, 0.01]);

    expect([...(bound?.guides ?? [])].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    const weights = bound?.weights ?? [];
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    const byGuide = new Map((bound?.guides ?? []).map((guide, at) => [guide, weights[at] ?? NaN]));
    const ofGuide = (guide: number) => byGuide.get(guide) ?? NaN;
    expect(ofGuide(0)).toBeGreaterThan(ofGuide(1));
    expect(ofGuide(0)).toBeGreaterThan(ofGuide(2));
  });

  it('follows the guide whose root it stands on, alone', () => {
    const [bound] = Strands.bind(four, { scalp: 1, ponytail: 0 }, [0.1, 1.7, 0]);

    expect(bound?.guides[0]).toBe(1);
    expect(bound?.weights[0]).toBeCloseTo(1, 12);
    expect((bound?.weights ?? []).slice(1).every((weight) => weight === 0)).toBe(true);
  });

  it('follows only guides of its own kind: a ponytail strand those down the ponytail, however near a scalp guide is', () => {
    const tied = guides(
      [
        [0, 1.7, 0],
        [0.1, 1.7, 0],
        [0, 1.6, -0.3],
        [0.05, 1.6, -0.3],
      ],
      2,
    );

    const [scalp, ponytail] = Strands.bind(
      tied,
      { scalp: 1, ponytail: 1 },
      [0.01, 1.7, 0, 0.01, 1.7, 0],
    );

    expect([...(scalp?.guides ?? [])].sort((a, b) => a - b)).toEqual([0, 1]);
    expect([...(ponytail?.guides ?? [])].sort((a, b) => a - b)).toEqual([2, 3]);
  });
});
