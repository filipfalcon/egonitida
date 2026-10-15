import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Joint from '#src/Joint.ts';
import type * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';
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

/** A head as made, standing 1.6 m up, turned no way. */
const made: Shape.Bones = {
  head: { parent: Option.none(), at: { x: 0, y: 1.6, z: 0 }, turn: Quaternion.identity },
};

/** One guide down the back of the head, four points a decimetre apart, stiff at its root and soft at its tip, carried by the head alone. */
const hanging: Strands.Strands = {
  points: 4,
  scalp: 1,
  ponytail: 0,
  at: [0, 1.7, 0.1, 0, 1.6, 0.1, 0, 1.5, 0.1, 0, 1.4, 0.1],
  width: [0.00008, 0.00006, 0.00004, 0.00003],
  stiffness: [1, 0.6, 0.4, 0.2],
  random: [0.5],
  bones: ['head'],
  joints: Array.from({ length: 16 }, () => 0),
  weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
};

/** How guides swing: springing back a third of the way each tenth of a second at a whole stiffness, losing a little each step. */
const swinging: Strands.Options = { stiffness: 30, damping: 0.02 };

/** The head placed at `at`, turned by `turn`. */
const headAt =
  (at: Ray.Point, turn: Quaternion.Quaternion = Quaternion.identity): Pose.Placer =>
  (name) =>
    name === 'head' ? { at, turn } : undefined;

const still = headAt(made.head?.at ?? { x: 0, y: 0, z: 0 });

/** Point `index` of `values`. */
const pointOf = (values: ReadonlyArray<number>, index: number): Ray.Point => ({
  x: values[index * 3] ?? NaN,
  y: values[index * 3 + 1] ?? NaN,
  z: values[index * 3 + 2] ?? NaN,
});

const apart = (a: Ray.Point, b: Ray.Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** `body` stepped `steps` sixtieths of a second, the head placed by `placing` at each, among `capsules`. */
const stepped = (
  body: Strands.Body,
  steps: number,
  placing: (step: number) => Pose.Placer,
  capsules: ReadonlyArray<Strands.Capsule> = [],
) => {
  let now = body;
  for (let at = 0; at < steps; at++) {
    now = Strands.step(hanging, now, 1 / 60, made, placing(at), capsules, swinging);
  }
  return now;
};

describe('Strands.carried', () => {
  it('is where each point stands as the bones carrying it are placed: as made, where they stand as made', () => {
    const at = Strands.carried(hanging, made, still);

    hanging.at.forEach((value, index) => expect(at[index]).toBeCloseTo(value, 12));
  });

  it('turns and moves with the bone carrying it', () => {
    // The head a decimetre to the right and turned a quarter about +y: the back of the head faces +x.
    const at = Strands.carried(
      hanging,
      made,
      headAt({ x: 0.1, y: 1.6, z: 0 }, Quaternion.about({ x: 0, y: 1, z: 0 }, Math.PI / 2)),
    );

    expect(apart(pointOf(at, 0), { x: 0.2, y: 1.7, z: 0 })).toBeLessThan(1e-12);
  });
});

describe('Strands.step', () => {
  const start = Strands.start(hanging, made, still);

  it('starts as groomed, still', () => {
    expect(start.now).toEqual(Strands.carried(hanging, made, still));
    expect(start.before).toEqual(start.now);
  });

  it('hangs as groomed while the head is still, groomed as it hangs under its weight', () => {
    const settled = stepped(start, 60, () => still);

    for (let point = 0; point < 4; point++) {
      expect(apart(pointOf(settled.now, point), pointOf(start.now, point))).toBeLessThan(1e-9);
    }
  });

  it('keeps its root where the bone carrying it places it', () => {
    const turned = headAt({ x: 0.3, y: 1.6, z: 0 }, Quaternion.about({ x: 0, y: 1, z: 0 }, 1));
    const after = stepped(start, 3, () => turned);

    expect(
      apart(pointOf(after.now, 0), pointOf(Strands.carried(hanging, made, turned), 0)),
    ).toBeLessThan(1e-12);
  });

  it('keeps every link as long as it was made, however the head moves', () => {
    const shaken = stepped(start, 40, (step) =>
      headAt(
        { x: Math.sin(step / 3) * 0.3, y: 1.6, z: 0 },
        Quaternion.about({ x: 1, y: 0, z: 0 }, Math.sin(step / 5)),
      ),
    );

    for (let point = 1; point < 4; point++) {
      expect(apart(pointOf(shaken.now, point), pointOf(shaken.now, point - 1))).toBeCloseTo(0.1, 9);
    }
  });

  it('trails behind its root as the head starts moving fast, its soft tip furthest', () => {
    // The head sweeping a metre a second to the right.
    const sweeping = (step: number) => headAt({ x: (step + 1) / 60, y: 1.6, z: 0 });
    // A twelfth of a second in, before it swings through as a whip does.
    const after = stepped(start, 5, sweeping);
    const carried = Strands.carried(hanging, made, sweeping(4));

    expect(pointOf(after.now, 3).x).toBeLessThan(pointOf(carried, 3).x - 0.01);
    expect(pointOf(carried, 3).x - pointOf(after.now, 3).x).toBeGreaterThan(
      pointOf(carried, 1).x - pointOf(after.now, 1).x,
    );
  });

  it('falls as the head tilts, below where the head alone would carry it', () => {
    // The head bowed forward a quarter turn: carried rigidly, the guide would stick out behind it.
    const bowed = headAt(
      { x: 0, y: 1.6, z: 0 },
      Quaternion.about({ x: 1, y: 0, z: 0 }, Math.PI / 2),
    );
    const settled = stepped(start, 120, () => bowed);
    const carried = Strands.carried(hanging, made, bowed);

    expect(pointOf(settled.now, 3).y).toBeLessThan(pointOf(carried, 3).y - 0.02);
  });

  it('leaves a ponytail’s guide to the bones carrying it, which hang it under its weight already', () => {
    // The same guide, down a ponytail; the head bowed, which here stands for the ponytail's bones swinging.
    const ponytail: Strands.Strands = { ...hanging, scalp: 0, ponytail: 1 };
    const bowed = headAt(
      { x: 0, y: 1.6, z: 0 },
      Quaternion.about({ x: 1, y: 0, z: 0 }, Math.PI / 2),
    );
    let now = Strands.start(ponytail, made, still);
    for (let step = 0; step < 120; step++) {
      now = Strands.step(ponytail, now, 1 / 60, made, bowed, [], swinging);
    }
    const carried = Strands.carried(ponytail, made, bowed);

    expect(apart(pointOf(now.now, 3), pointOf(carried, 3))).toBeLessThan(1e-4);
  });

  it('never passes into a capsule it was groomed outside of, such as her neck', () => {
    // A neck across behind the guide's lower half, going with the head, its surface a centimetre behind the guide; the head darting forward, the guide swinging back into it.
    const forward = (step: number) => Math.min(step + 1, 6) / 30;
    const darting = (step: number) => headAt({ x: 0, y: 1.6, z: forward(step) });
    const neckAt = (step: number): Strands.Capsule => ({
      from: { x: -0.2, y: 1.45, z: forward(step) },
      to: { x: 0.2, y: 1.45, z: forward(step) },
      radius: 0.09,
    });
    const deepest = (withNeck: boolean) => {
      let now = start;
      let nearest = Infinity;
      for (let step = 0; step < 30; step++) {
        now = Strands.step(
          hanging,
          now,
          1 / 60,
          made,
          darting(step),
          withNeck ? [neckAt(step)] : [],
          swinging,
        );
        for (let point = 1; point < 4; point++) {
          const { y, z } = pointOf(now.now, point);
          nearest = Math.min(nearest, Math.hypot(y - 1.45, z - forward(step)));
        }
      }
      return nearest;
    };

    // Free, it swings into where the neck is; with it, it stays out.
    expect(deepest(false)).toBeLessThan(0.09 - 0.005);
    expect(deepest(true)).toBeGreaterThan(0.09 - 1e-9);
  });
});

describe('Strands.capsulesOf', () => {
  it('is the flesh of each bone named that has some, along its own +y from where it stands', () => {
    const joints: Joint.Joints = {
      neck: {
        kind: 'Hinge',
        motions: {},
        order: [],
        depends: [],
        follows: [],
        measures: {},
        flesh: Option.some({ radius: 0.05, length: 0.1, mass: 1 }),
      },
    };
    const [neck] = Strands.capsulesOf(
      joints,
      (name) =>
        name === 'neck'
          ? {
              at: { x: 0, y: 1.5, z: 0 },
              turn: Quaternion.about({ x: 0, y: 0, z: 1 }, Math.PI / 2),
            }
          : undefined,
      ['neck', 'head'],
    );

    expect(neck?.radius).toBe(0.05);
    expect(apart(neck?.to ?? { x: NaN, y: NaN, z: NaN }, { x: -0.1, y: 1.5, z: 0 })).toBeLessThan(
      1e-12,
    );
  });
});
