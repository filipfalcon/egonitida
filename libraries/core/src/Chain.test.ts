import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Chain from '#src/Chain.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Shape from '#src/Shape.ts';

/** How far apart two points are. */
const apart = (a: Chain.Point | undefined, b: Chain.Point | undefined) =>
  a === undefined || b === undefined ? NaN : Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A head with a ponytail tied behind it, made sticking straight back, three links of a tenth of a metre. */
const head: Shape.Bones = {
  head: { parent: Option.none(), at: { x: 0, y: 1.6, z: 0 }, turn: Quaternion.identity },
  tail_01: {
    parent: Option.some('head'),
    at: { x: 0, y: 1.65, z: -0.1 },
    turn: Quaternion.identity,
  },
  tail_02: {
    parent: Option.some('tail_01'),
    at: { x: 0, y: 1.65, z: -0.2 },
    turn: Quaternion.identity,
  },
  tail_03: {
    parent: Option.some('tail_02'),
    at: { x: 0, y: 1.65, z: -0.3 },
    turn: Quaternion.identity,
  },
};

const ponytail = Chain.plan(head, ['tail_01', 'tail_02', 'tail_03'], {
  stiffness: 0.02,
  limit: Math.PI / 2,
  damping: 0.05,
});

/** The head standing where it was made, turned as `turn` says, `x` aside. */
const pinned = (x = 0, turn = Quaternion.identity) => ({ at: { x, y: 1.6, z: 0 }, turn });

/** `body` stepped `seconds`, in sixtieths, the head pinned as `pin` says at each. */
const swung = (body: Chain.Body, seconds: number, pin: (step: number) => Chain.Pin) => {
  let now = body;
  for (let step = 0; step < Math.round(seconds * 60); step++) {
    now = Chain.step(ponytail, now, 1 / 60, pin(step));
  }
  return now;
};

describe('a chain', () => {
  it('names the bone it hangs from, its first bone’s parent, which its pin is placed by', () => {
    const tied: Shape.Bones = {
      ...head,
      tie: {
        parent: Option.some('head'),
        at: { x: 0, y: 1.65, z: -0.05 },
        turn: Quaternion.identity,
      },
      tail_01: {
        parent: Option.some('tie'),
        at: { x: 0, y: 1.65, z: -0.1 },
        turn: Quaternion.identity,
      },
    };

    expect(ponytail.from).toEqual(Option.some('head'));
    expect(Chain.plan(tied, ['tail_01'], ponytail.options).from).toEqual(Option.some('tie'));
    expect(Chain.plan(head, ['head'], ponytail.options).from).toEqual(Option.none());
  });

  it('starts as it was made, pinned where its first bone is on the bone it hangs from', () => {
    const body = Chain.start(ponytail, pinned());

    expect(apart(Chain.points(ponytail, body)['tail_01'], { x: 0, y: 1.65, z: -0.1 })).toBeLessThan(
      1e-12,
    );
    expect(apart(Chain.points(ponytail, body)['tail_03'], { x: 0, y: 1.65, z: -0.3 })).toBeLessThan(
      1e-12,
    );
  });

  it('hangs down under its weight, its links as long as they were made, its root where it is tied', () => {
    const hanging = swung(Chain.start(ponytail, pinned()), 3, () => pinned());

    const points = Chain.points(ponytail, hanging);
    expect(apart(points['tail_01'], { x: 0, y: 1.65, z: -0.1 })).toBeLessThan(1e-9);
    expect(apart(points['tail_01'], points['tail_02'])).toBeCloseTo(0.1, 6);
    expect(apart(points['tail_02'], points['tail_03'])).toBeCloseTo(0.1, 6);
    expect(points['tail_03']?.y ?? 0).toBeLessThan(1.5);
  });

  it('springs back toward how it hung as made, the stiffer the more', () => {
    const stiff = Chain.plan(head, ['tail_01', 'tail_02', 'tail_03'], {
      stiffness: 1,
      limit: Math.PI,
      damping: 0.05,
    });
    let body = Chain.start(stiff, pinned());
    for (let step = 0; step < 180; step++) {
      body = Chain.step(stiff, body, 1 / 60, pinned());
    }

    expect(Chain.points(stiff, body)['tail_03']?.y ?? 0).toBeGreaterThan(
      Chain.points(
        ponytail,
        swung(Chain.start(ponytail, pinned()), 3, () => pinned()),
      )['tail_03']?.y ?? 0,
    );
  });

  it('swings behind a head that moves, never further from how it hung than its limit', () => {
    const tight = Chain.plan(head, ['tail_01', 'tail_02', 'tail_03'], {
      stiffness: 0.02,
      limit: 0.3,
      damping: 0.05,
    });
    let body = Chain.start(tight, pinned());
    for (let step = 0; step < 30; step++) {
      body = Chain.step(tight, body, 1 / 60, pinned(step * 0.05));
    }

    const points = Chain.points(tight, body);
    // Its second link at most the limit from where it was made, straight back from the first.
    const from = points['tail_01'];
    const to = points['tail_02'];
    const way =
      from === undefined || to === undefined
        ? { x: 0, y: 0, z: 0 }
        : { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const angle = Math.acos(-way.z / Math.hypot(way.x, way.y, way.z));
    expect(angle).toBeLessThanOrEqual(0.3 + 1e-6);
    // Moved aside, it trails behind.
    expect(points['tail_03']?.x ?? 0).toBeLessThan(1.45);
  });

  it('swings the same each time from the same start, as a replay must', () => {
    const run = () =>
      swung(Chain.start(ponytail, pinned()), 1, (step) => pinned(Math.sin(step / 5) * 0.2));

    expect(run()).toEqual(run());
  });
});
