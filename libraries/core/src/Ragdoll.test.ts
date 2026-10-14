import { describe, expect, it } from '@effect/vitest';
import * as Ragdoll from '#src/Ragdoll.ts';

/** How far apart two points are. */
const apart = (a: Ragdoll.Point, b: Ragdoll.Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Nothing but the floor, at the ground. */
const open: Ragdoll.Surroundings = { floor: 0, walls: [] };

/** `body` stepped by `plan` for `seconds`, in steps of a sixtieth of a second, among `around`. */
const fallen = <P extends string>(
  plan: Ragdoll.Plan<P>,
  body: Ragdoll.Body,
  seconds: number,
  around: Ragdoll.Surroundings = open,
) => {
  let now = body;
  for (let step = 0; step < Math.round(seconds * 60); step++) {
    now = Ragdoll.step(plan, now, 1 / 60, around);
  }
  return now;
};

/** One stone, a tenth of a metre round. */
const stone = Ragdoll.plan({
  points: { stone: { radius: 0.1, mass: 1 } },
  links: [],
  rigid: [],
  hinges: [],
});

/** A rod: two points held a metre apart. */
const rod = Ragdoll.plan({
  points: { top: { radius: 0.05, mass: 1 }, bottom: { radius: 0.05, mass: 1 } },
  links: [['top', 'bottom']],
  rigid: [],
  hinges: [],
});

/** A leg: a hip, a knee, and an ankle, linked one to the next, a toe held to the ankle, the knee bending only forward, the way the toe points from the ankle. */
const leg = Ragdoll.plan({
  points: {
    hip: { radius: 0.06, mass: 4 },
    knee: { radius: 0.05, mass: 2 },
    ankle: { radius: 0.04, mass: 1 },
    toe: { radius: 0.03, mass: 0.5 },
  },
  links: [
    ['hip', 'knee'],
    ['knee', 'ankle'],
  ],
  rigid: [['ankle', 'toe']],
  hinges: [{ from: 'hip', joint: 'knee', to: 'ankle', toward: ['ankle', 'toe'] }],
});

describe('a ragdoll', () => {
  it('falls under gravity and comes to lie on the floor, as far up as it is round', () => {
    const dropped = Ragdoll.start(stone, { stone: { x: 0, y: 2, z: 0 } });

    const lying = Ragdoll.at(stone, fallen(stone, dropped, 3), 'stone');

    expect(lying.y).toBeCloseTo(0.1, 2);
  });

  it('keeps its points as far apart as they started, linked, however it falls', () => {
    const tipped = Ragdoll.start(
      rod,
      { top: { x: 0, y: 1.5, z: 0 }, bottom: { x: 0.3, y: 0.55, z: 0 } },
      { x: 1, y: 0, z: 0 },
    );

    const lain = fallen(rod, tipped, 2);
    const length = apart(Ragdoll.at(rod, lain, 'top'), Ragdoll.at(rod, lain, 'bottom'));

    expect(length).toBeCloseTo(apart({ x: 0, y: 1.5, z: 0 }, { x: 0.3, y: 0.55, z: 0 }), 2);
  });

  it('keeps the proportions it started with, a longer body falling longer', () => {
    const long = Ragdoll.start(rod, { top: { x: 0, y: 3, z: 0 }, bottom: { x: 0, y: 1, z: 0.1 } });

    const lain = fallen(rod, long, 2);

    expect(apart(Ragdoll.at(rod, lain, 'top'), Ragdoll.at(rod, lain, 'bottom'))).toBeCloseTo(
      apart({ x: 0, y: 3, z: 0 }, { x: 0, y: 1, z: 0.1 }),
      2,
    );
  });

  it('goes the way it was sent, and as far as it was', () => {
    const thrown = Ragdoll.start(stone, { stone: { x: 0, y: 1, z: 0 } }, { x: 3, y: 0, z: 0 });
    const dropped = Ragdoll.start(stone, { stone: { x: 0, y: 1, z: 0 } });

    expect(Ragdoll.at(stone, fallen(stone, thrown, 0.3), 'stone').x).toBeGreaterThan(0.6);
    expect(Ragdoll.at(stone, fallen(stone, dropped, 0.3), 'stone').x).toBeCloseTo(0);
  });

  it('stops against a wall, as far off it as it is round', () => {
    const thrown = Ragdoll.start(stone, { stone: { x: 0, y: 1, z: 0 } }, { x: 6, y: 0, z: 0 });
    const wall = { min: { x: 1, y: 0, z: -5 }, max: { x: 2, y: 3, z: 5 } };

    const stopped = Ragdoll.at(
      stone,
      fallen(stone, thrown, 2, { floor: 0, walls: [wall] }),
      'stone',
    );

    expect(stopped.x).toBeLessThanOrEqual(0.9 + 1e-6);
  });

  it('bends a knee only the way it bends, toward where the toe points', () => {
    // Standing, the knee a little bent forward, the toe ahead, along +z; pushed back at the knee.
    const standing = Ragdoll.start(
      leg,
      {
        hip: { x: 0, y: 1, z: 0 },
        knee: { x: 0, y: 0.55, z: 0.05 },
        ankle: { x: 0, y: 0.1, z: 0 },
        toe: { x: 0, y: 0.05, z: 0.15 },
      },
      { x: 0, y: 0, z: 0 },
    );
    const pushedBack = Ragdoll.pushed(leg, standing, 'knee', { x: 0, y: 0, z: -3 });

    const bent = fallen(leg, pushedBack, 0.2);
    const hip = Ragdoll.at(leg, bent, 'hip');
    const knee = Ragdoll.at(leg, bent, 'knee');
    const ankle = Ragdoll.at(leg, bent, 'ankle');
    const toe = Ragdoll.at(leg, bent, 'toe');
    // How far ahead of the line from hip to ankle the knee stands, the way the toe points.
    const ahead = { x: toe.x - ankle.x, z: toe.z - ankle.z };
    const middle = { x: (hip.x + ankle.x) / 2, z: (hip.z + ankle.z) / 2 };

    expect((knee.x - middle.x) * ahead.x + (knee.z - middle.z) * ahead.z).toBeGreaterThanOrEqual(
      -1e-6,
    );
  });

  it('comes to lie still, and once still, stays as it lies', () => {
    const tipped = Ragdoll.start(
      rod,
      { top: { x: 0, y: 1.5, z: 0 }, bottom: { x: 0.2, y: 0.5, z: 0 } },
      { x: 0.5, y: 0, z: 0 },
    );

    const lain = fallen(rod, tipped, 4);
    const later = fallen(rod, lain, 1);

    expect(Ragdoll.isStill(lain)).toBe(true);
    expect(apart(Ragdoll.at(rod, later, 'top'), Ragdoll.at(rod, lain, 'top'))).toBeLessThan(1e-9);
  });

  it('falls the same each time from the same start, as a replay must', () => {
    const tipped = () =>
      Ragdoll.start(
        rod,
        { top: { x: 0, y: 1.5, z: 0 }, bottom: { x: 0.2, y: 0.5, z: 0 } },
        { x: 0.5, y: 0, z: 0.3 },
      );

    expect(fallen(rod, tipped(), 1.5)).toEqual(fallen(rod, tipped(), 1.5));
  });
});

describe('Ragdoll.mpfb', () => {
  /** A figure made with MPFB standing at the origin facing +z, as its game_engine rig stands, a metre and a half tall. */
  const standing: { readonly [Name in (typeof Ragdoll.mpfb.names)[number]]: Ragdoll.Point } = {
    pelvis: { x: 0, y: 0.94, z: 0 },
    spine_03: { x: 0, y: 1.17, z: 0 },
    neck_01: { x: 0, y: 1.49, z: 0 },
    head: { x: 0, y: 1.6, z: 0.04 },
    thigh_l: { x: 0.09, y: 0.9, z: 0 },
    calf_l: { x: 0.1, y: 0.5, z: 0.02 },
    foot_l: { x: 0.1, y: 0.08, z: -0.02 },
    ball_l: { x: 0.1, y: 0.02, z: 0.12 },
    thigh_r: { x: -0.09, y: 0.9, z: 0 },
    calf_r: { x: -0.1, y: 0.5, z: 0.02 },
    foot_r: { x: -0.1, y: 0.08, z: -0.02 },
    ball_r: { x: -0.1, y: 0.02, z: 0.12 },
    upperarm_l: { x: 0.18, y: 1.4, z: 0 },
    lowerarm_l: { x: 0.3, y: 1.15, z: 0 },
    hand_l: { x: 0.4, y: 0.92, z: 0.02 },
    upperarm_r: { x: -0.18, y: 1.4, z: 0 },
    lowerarm_r: { x: -0.3, y: 1.15, z: 0 },
    hand_r: { x: -0.4, y: 0.92, z: 0.02 },
  };

  it('stands at the bones of the rig MPFB makes for game engines, by their names', () => {
    expect([...Ragdoll.mpfb.names].sort()).toEqual(Object.keys(standing).sort());
  });

  it('falls, sent back by a blow, and comes to lie still on the floor, every point of her above it', () => {
    const struck = Ragdoll.start(Ragdoll.mpfb, standing, { x: 0, y: 0, z: -2 });

    const lain = fallen(Ragdoll.mpfb, struck, 6);

    expect(Ragdoll.isStill(lain)).toBe(true);
    for (const name of Ragdoll.mpfb.names) {
      expect(Ragdoll.at(Ragdoll.mpfb, lain, name).y).toBeGreaterThan(0);
      expect(Ragdoll.at(Ragdoll.mpfb, lain, name).y).toBeLessThan(0.4);
    }
  });
});
