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

/** A joint of `kind` bending about `flex`, within `range` degrees. */
const hinge = (
  flex: { x: number; y: number; z: number },
  range: readonly [number, number],
): Joint.Joint => ({
  kind: 'Hinge',
  axes: { flex, abduct: Option.none(), twist: Option.none() },
  swing: { flex: [degrees(range[0]), degrees(range[1])], abduct: Option.none() },
  twist: Option.none(),
  depends: [],
  follows: Option.none(),
  flesh: Option.none(),
});

/** The leg's joints: a hip bending forward as it grows, every way; a knee bending back; an ankle pointing the toes down as it grows, 20° up to 50° down; and a subtalar joint rolling the foot in and out. */
const joints: Joint.Joints = {
  thigh: {
    kind: 'Ball',
    axes: {
      flex: { x: -1, y: 0, z: 0 },
      abduct: Option.some({ x: 0, y: 0, z: 1 }),
      twist: Option.some({ x: 0, y: 1, z: 0 }),
    },
    swing: { flex: [degrees(-20), degrees(120)], abduct: Option.some([degrees(-30), degrees(45)]) },
    twist: Option.some([degrees(-40), degrees(45)]),
    depends: [],
    follows: Option.none(),
    flesh: Option.none(),
  },
  calf: hinge({ x: 1, y: 0, z: 0 }, [-5, 140]),
  foot: hinge({ x: 1, y: 0, z: 0 }, [-20, 50]),
  subtalar: hinge({ x: 0, y: 0, z: 1 }, [-15, 30]),
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
    expect(reached.pose.turns['calf']?.flex ?? 0).toBeGreaterThan(0);
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

    expect(reached.pose.turns['foot']?.flex).toBeCloseTo(degrees(50), 9);
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

/** A ball joint about x, z, and y, its ranges in degrees: bending, abducting, and twisting. */
const ball = (
  flex: readonly [number, number],
  abduct: readonly [number, number],
  twist: readonly [number, number],
  axes: {
    flex: Joint.Joint['axes']['flex'];
    abduct: Joint.Joint['axes']['flex'];
    twist: Joint.Joint['axes']['flex'];
  } = {
    flex: { x: 1, y: 0, z: 0 },
    abduct: { x: 0, y: 0, z: 1 },
    twist: { x: 0, y: 1, z: 0 },
  },
  mass = 0,
): Joint.Joint => ({
  kind: 'Ball',
  axes: { flex: axes.flex, abduct: Option.some(axes.abduct), twist: Option.some(axes.twist) },
  swing: {
    flex: [degrees(flex[0]), degrees(flex[1])],
    abduct: Option.some([degrees(abduct[0]), degrees(abduct[1])]),
  },
  twist: Option.some([degrees(twist[0]), degrees(twist[1])]),
  depends: [],
  follows: Option.none(),
  flesh: mass === 0 ? Option.none() : Option.some({ radius: 0.1, length: 0.2, mass }),
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
const spinal: Joint.Joints = {
  spine_01: ball([-10, 30], [-10, 10], [-2, 2]),
  spine_02: ball([-10, 20], [-15, 15], [-20, 20]),
  neck_01: ball([-30, 25], [-20, 20], [-37.5, 37.5]),
  neck_02: ball([-5, 5], [-5, 5], [-37.5, 37.5]),
  eye: ball([-30, 45], [-35, 35], [0, 0], {
    flex: { x: 1, y: 0, z: 0 },
    abduct: { x: 0, y: 1, z: 0 },
    twist: { x: 0, y: 0, z: 1 },
  }),
};

describe('Reach.spine', () => {
  it('spreads a turn and a bend over the spine as far as each segment turns and bends', () => {
    const reached = Reach.spine(spinal, Pose.rest, {
      joints: ['spine_01', 'spine_02'],
      turn: degrees(11),
      bend: degrees(25),
      side: 0,
    });

    expect(reached.pose.turns['spine_01']?.twist).toBeCloseTo(degrees(1), 9);
    expect(reached.pose.turns['spine_02']?.twist).toBeCloseTo(degrees(10), 9);
    expect(reached.pose.turns['spine_01']?.flex).toBeCloseTo(degrees(15), 9);
    expect(reached.pose.turns['spine_02']?.flex).toBeCloseTo(degrees(10), 9);
    expect(reached.short.turn).toBeCloseTo(0, 12);
    expect(reached.short.bend).toBeCloseTo(0, 12);
    expect(reached.short.side).toBeCloseTo(0, 12);
  });

  it('turns every segment as far as it turns, and says how far short, for a turn beyond them all', () => {
    const reached = Reach.spine(spinal, Pose.rest, {
      joints: ['spine_01', 'spine_02'],
      turn: degrees(-30),
      bend: 0,
      side: 0,
    });

    expect(reached.pose.turns['spine_01']?.twist).toBeCloseTo(degrees(-2), 9);
    expect(reached.pose.turns['spine_02']?.twist).toBeCloseTo(degrees(-20), 9);
    expect(reached.short.turn).toBeCloseTo(degrees(8), 9);
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

    expect(reached.pose.turns['neck_01']?.twist ?? 0).toBeCloseTo(0, 9);
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

    const first = reached.pose.turns['neck_01']?.twist ?? 0;
    const second = reached.pose.turns['neck_02']?.twist ?? 0;
    expect(first).toBeGreaterThan(degrees(10));
    expect(first).toBeCloseTo(second, 9);
    // As far as they go, but for how far the head's turn carries them aside.
    expect(reached.pose.turns['eye']?.abduct ?? 0).toBeGreaterThan(degrees(33));
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
  const hipJoint = ball(
    [-20, 120],
    [-30, 45],
    [-40, 45],
    {
      flex: { x: -1, y: 0, z: 0 },
      abduct: { x: 0, y: 0, z: 1 },
      twist: { x: 0, y: 1, z: 0 },
    },
    7,
  );
  const legs: Joint.Joints = {
    pelvis: ball([-10, 10], [-10, 10], [-10, 10], undefined, 12),
    thigh_l: hipJoint,
    calf_l: {
      ...hinge({ x: 1, y: 0, z: 0 }, [-5, 140]),
      flesh: Option.some({ radius: 0.05, length: 0.2, mass: 3 }),
    },
    thigh_r: hipJoint,
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
