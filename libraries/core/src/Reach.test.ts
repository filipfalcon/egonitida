import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Joint from '#src/Joint.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import * as Reach from '#src/Reach.ts';
import type * as Shape from '#src/Shape.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

/** How far apart two points are. */
const apart = (
  a: { x: number; y: number; z: number } | undefined,
  b: { x: number; y: number; z: number },
) => (a === undefined ? Infinity : Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));

/** A bone of the leg, standing at `y`, `z`, turned as it was made no way. */
const bone = (parent: string | undefined, y: number, z = 0): Shape.Bone => ({
  parent: Option.fromNullishOr(parent),
  at: { x: 0, y, z },
  turn: Quaternion.identity,
});

/** A leg standing as a model was made, facing +z: a hip a metre up, a knee half a metre below it, an ankle on the ground, and the foot ahead of it, its subtalar joint and its ball. */
const leg: Shape.Bones = {
  thigh: bone(undefined, 1),
  calf: bone('thigh', 0.5),
  foot: bone('calf', 0),
  subtalar: bone('foot', 0, 0.05),
  ball: bone('subtalar', 0, 0.15),
};

/** A motion about `axis`, within `range` degrees, at rest as made. */
const motion = (
  axis: { x: number; y: number; z: number },
  range: readonly [number, number],
): Joint.Motion => ({ axis, range: [degrees(range[0]), degrees(range[1])], rest: 0 });

/** A joint of `kind` with `motions`, turned in the order they are named, and the flesh weighing `mass`, if any. */
const joint = (
  kind: Joint.Kind,
  motions: Readonly<Record<string, Joint.Motion>>,
  mass = 0,
): Joint.Joint => ({
  kind,
  motions,
  order: Object.keys(motions),
  depends: [],
  follows: [],
  measures: {},
  flesh: mass === 0 ? Option.none() : Option.some({ radius: 0.1, length: 0.2, mass }),
});

/** A hinge flexing about `axis`, within `range` degrees, its flesh weighing `mass`. */
const hinge = (
  axis: { x: number; y: number; z: number },
  range: readonly [number, number],
  mass = 0,
) => joint('Hinge', { flex: motion(axis, range) }, mass);

/** A hip flexing the leg forward, abducting it, and rotating it, its flesh weighing `mass`. */
const hipOf = (mass = 0) =>
  joint(
    'Ball',
    {
      flex: motion({ x: -1, y: 0, z: 0 }, [-20, 120]),
      abduct: motion({ x: 0, y: 0, z: 1 }, [-30, 45]),
      rotate: motion({ x: 0, y: 1, z: 0 }, [-40, 45]),
    },
    mass,
  );

const joints: Joint.Joints = {
  thigh: hipOf(),
  calf: hinge({ x: 1, y: 0, z: 0 }, [-5, 140]),
  foot: joint('Hinge', { dorsiflex: motion({ x: -1, y: 0, z: 0 }, [-50, 20]) }),
  subtalar: joint('Hinge', { invert: motion({ x: 0, y: 0, z: 1 }, [-15, 30]) }),
};

describe('Reach.limb', () => {
  it('stops a foot asked beyond her reach at full stretch, along the line to it, saying how far short', () => {
    const reached = Reach.limb(leg, joints, Pose.rest, {
      root: 'thigh',
      end: 'foot',
      to: { x: 0, y: 1, z: 2 },
    });

    const placed = Pose.place(leg, joints, reached.pose);
    expect(apart(placed['foot']?.at, { x: 0, y: 1, z: 1 })).toBeLessThan(1e-9);
    expect(reached.short).toBeCloseTo(1, 9);
  });

  it('puts a foot it can reach on the point, the knee bending toward where it is asked', () => {
    const to = { x: 0.1, y: 0.3, z: 0.5 };

    const swivel = { x: 0, y: 0.5, z: 2 };

    const reached = Reach.limb(leg, joints, Pose.rest, { root: 'thigh', end: 'foot', to, swivel });

    const placed = Pose.place(leg, joints, reached.pose);
    expect(apart(placed['foot']?.at, to)).toBeLessThan(1e-9);
    expect(reached.short).toBeLessThan(1e-9);
    // The knee off the line from the hip to the foot on the side the swivel lies.
    const hip = { x: 0, y: 1, z: 0 };
    const line = { x: to.x - hip.x, y: to.y - hip.y, z: to.z - hip.z };
    const off = (point: { x: number; y: number; z: number }) => {
      const from = { x: point.x - hip.x, y: point.y - hip.y, z: point.z - hip.z };
      const along =
        (from.x * line.x + from.y * line.y + from.z * line.z) /
        (line.x * line.x + line.y * line.y + line.z * line.z);
      return { x: from.x - line.x * along, y: from.y - line.y * along, z: from.z - line.z * along };
    };
    const knee = off(placed['calf']?.at ?? hip);
    const side = off(swivel);
    expect(knee.x * side.x + knee.y * side.y + knee.z * side.z).toBeGreaterThan(0);
    expect(reached.pose.turns['calf']?.['flex'] ?? 0).toBeGreaterThan(0);
  });

  it('turns the ankle and the subtalar joint to face the instep as asked, within their limits, saying how far short', () => {
    // The instep faces up as the foot stands; asked to face ahead, the toes would point straight down.
    const reached = Reach.limb(leg, joints, Pose.rest, {
      root: 'thigh',
      end: 'foot',
      to: { x: 0, y: 0, z: 0 },
      facing: {
        bone: 'subtalar',
        normal: { x: 0, y: 1, z: 0 },
        toward: { x: 0, y: 0, z: 1 },
        turning: ['foot', 'subtalar'],
      },
    });

    // The toes pointed down as far as they go.
    expect(reached.pose.turns['foot']?.['dorsiflex']).toBeCloseTo(degrees(-50), 9);
    expect(reached.facingShort).toBeCloseTo(degrees(40), 6);
  });

  it('gives the same pose for the same targets, every time', () => {
    const ask = () =>
      Reach.limb(leg, joints, Pose.rest, {
        root: 'thigh',
        end: 'foot',
        to: { x: 0.2, y: 0.4, z: 0.3 },
        swivel: { x: 0.3, y: 0.6, z: 1 },
      });

    expect(ask()).toEqual(ask());
  });
});

/** A trunk standing up the y axis, facing +z: a pelvis, a lumbar and a thoracic segment, two of the neck, the head, and an eye. */
const trunk: Shape.Bones = {
  pelvis: bone(undefined, 1),
  spine_01: bone('pelvis', 1.1),
  spine_02: bone('spine_01', 1.3),
  neck_01: bone('spine_02', 1.5),
  neck_02: bone('neck_01', 1.55),
  head: bone('neck_02', 1.6),
  eye: bone('head', 1.7, 0.08),
};

/** The trunk's joints: the lumbar spine bending far and hardly turning, the thoracic spine turning, the neck turning half at each of its joints, and an eye looking 35° either way, 30° up and 45° down. */
/** A segment of the spine flexing forward, bending to her left, and turning to her left, within ranges in degrees. */
const segment = (
  flex: readonly [number, number],
  bend: readonly [number, number],
  turn: readonly [number, number],
) =>
  joint('Ball', {
    flex: motion({ x: 1, y: 0, z: 0 }, flex),
    bend: motion({ x: 0, y: 0, z: -1 }, bend),
    turn: motion({ x: 0, y: 1, z: 0 }, turn),
  });

const spinal: Joint.Joints = {
  spine_01: segment([-10, 30], [-10, 10], [-2, 2]),
  spine_02: segment([-10, 20], [-15, 15], [-20, 20]),
  neck_01: segment([-30, 25], [-20, 20], [-37.5, 37.5]),
  neck_02: segment([-5, 5], [-5, 5], [-37.5, 37.5]),
  eye: joint('Ball', {
    out: motion({ x: 0, y: 1, z: 0 }, [-35, 35]),
    up: motion({ x: -1, y: 0, z: 0 }, [-45, 30]),
  }),
};

describe('Reach.spine', () => {
  it('spreads a turn and a bend over the spine as far as each segment turns and bends', () => {
    const reached = Reach.spine(spinal, Pose.rest, {
      joints: ['spine_01', 'spine_02'],
      motions: { turn: degrees(11), flex: degrees(25) },
    });

    expect(reached.pose.turns['spine_01']?.['turn']).toBeCloseTo(degrees(1), 9);
    expect(reached.pose.turns['spine_02']?.['turn']).toBeCloseTo(degrees(10), 9);
    expect(reached.pose.turns['spine_01']?.['flex']).toBeCloseTo(degrees(15), 9);
    expect(reached.pose.turns['spine_02']?.['flex']).toBeCloseTo(degrees(10), 9);
    expect(reached.short['turn']).toBeCloseTo(0, 12);
    expect(reached.short['flex']).toBeCloseTo(0, 12);
  });

  it('turns every segment as far as it turns, and says how far short, for a turn beyond them all', () => {
    const reached = Reach.spine(spinal, Pose.rest, {
      joints: ['spine_01', 'spine_02'],
      motions: { turn: degrees(-30) },
    });

    expect(reached.pose.turns['spine_01']?.['turn']).toBeCloseTo(degrees(-2), 9);
    expect(reached.pose.turns['spine_02']?.['turn']).toBeCloseTo(degrees(-20), 9);
    expect(reached.short['turn']).toBeCloseTo(degrees(8), 9);
  });
});

describe('Reach.look', () => {
  const ask = (at: { x: number; y: number; z: number }) => ({
    at,
    eyes: ['eye'],
    forward: { x: 0, y: 0, z: 1 },
    neck: ['neck_01', 'neck_02'],
  });

  it('looks with the eyes alone at what lies within their reach', () => {
    const reached = Reach.look(trunk, spinal, Pose.rest, ask({ x: 0.5, y: 1.7, z: 1.5 }));

    expect(reached.pose.turns['neck_01']?.['turn'] ?? 0).toBeCloseTo(0, 9);
    expect(reached.short).toBeLessThan(1e-6);
  });

  it('turns the eyes as far as they go, and the neck the rest, half at each of its joints', () => {
    const away = degrees(60);
    const reached = Reach.look(
      trunk,
      spinal,
      Pose.rest,
      ask({ x: 2 * Math.sin(away), y: 1.7, z: 0.08 + 2 * Math.cos(away) }),
    );

    const first = reached.pose.turns['neck_01']?.['turn'] ?? 0;
    const second = reached.pose.turns['neck_02']?.['turn'] ?? 0;
    expect(first).toBeGreaterThan(degrees(10));
    expect(first).toBeCloseTo(second, 9);
    // As far as they go, but for how far the head's turn carries them aside.
    expect(reached.pose.turns['eye']?.['out'] ?? 0).toBeGreaterThan(degrees(33));
    expect(reached.short).toBeLessThan(1e-3);
  });
});

describe('Reach.balance', () => {
  /** A pelvis on two legs, each a hip, a knee, and an ankle, the pelvis and each segment of flesh. */
  const standing: Shape.Bones = {
    pelvis: bone(undefined, 1),
    thigh_l: { ...bone('pelvis', 0.95), at: { x: 0.1, y: 0.95, z: 0 } },
    calf_l: { ...bone('thigh_l', 0.5), at: { x: 0.1, y: 0.5, z: 0 } },
    foot_l: { ...bone('calf_l', 0), at: { x: 0.1, y: 0, z: 0 } },
    thigh_r: { ...bone('pelvis', 0.95), at: { x: -0.1, y: 0.95, z: 0 } },
    calf_r: { ...bone('thigh_r', 0.5), at: { x: -0.1, y: 0.5, z: 0 } },
    foot_r: { ...bone('calf_r', 0), at: { x: -0.1, y: 0, z: 0 } },
  };
  const legs: Joint.Joints = {
    pelvis: joint('Free', {}, 12),
    thigh_l: hipOf(7),
    calf_l: {
      ...hinge({ x: 1, y: 0, z: 0 }, [-5, 140]),
      flesh: Option.some({ radius: 0.05, length: 0.2, mass: 3 }),
    },
    thigh_r: hipOf(7),
    calf_r: {
      ...hinge({ x: 1, y: 0, z: 0 }, [-5, 140]),
      flesh: Option.some({ radius: 0.05, length: 0.2, mass: 3 }),
    },
  };

  it('stands her centre of mass over the foot she stands on, that foot staying where it stood', () => {
    const balanced = Reach.balance(standing, legs, Pose.rest, {
      stance: { root: 'thigh_l', end: 'foot_l' },
    });

    const placed = Pose.place(standing, legs, balanced);
    const centre = Pose.centreOfMass(standing, legs, balanced);
    expect(apart(placed['foot_l']?.at, { x: 0.1, y: 0, z: 0 })).toBeLessThan(1e-6);
    expect(Option.map(centre, ({ x, z }) => Math.hypot(x - 0.1, z))).toEqual(
      Option.some(expect.closeTo(0, 3)),
    );
  });
});
