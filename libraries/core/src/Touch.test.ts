import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Joint from '#src/Joint.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Shape from '#src/Shape.ts';
import * as Touch from '#src/Touch.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

const bone = (parent: string | undefined, y: number, z = 0): Shape.Bone => ({
  parent: Option.fromNullishOr(parent),
  at: { x: 0, y, z },
  turn: Quaternion.identity,
});

/** A leg standing as a model was made, facing +z: a hip a metre up, a knee half a metre below it, its shin made pointing down its own +y, as a rig points a bone at the next, and an ankle on the ground. */
const leg: Shape.Bones = {
  thigh: bone(undefined, 1),
  calf: { ...bone('thigh', 0.5), turn: Quaternion.about({ x: 0, y: 0, z: 1 }, Math.PI) },
  foot: bone('calf', 0),
};

/** The leg's joints: a hip swinging the leg forward as it grows, and a knee, its axis across it in the shin's own turned frame, and the shin's flesh a capsule along it. */
const joints: Joint.Joints = {
  thigh: {
    kind: 'Hinge',
    motions: {
      flex: { axis: { x: -1, y: 0, z: 0 }, range: [degrees(-20), degrees(120)], rest: 0 },
    },
    order: ['flex'],
    depends: [],
    follows: [],
    measures: {},
    flesh: Option.none(),
  },
  calf: {
    kind: 'Hinge',
    motions: { flex: { axis: { x: -1, y: 0, z: 0 }, range: [degrees(-5), degrees(140)], rest: 0 } },
    order: ['flex'],
    depends: [],
    follows: [],
    measures: {},
    flesh: Option.some({ radius: 0.05, length: 0.4, mass: 2.5 }),
  },
};

/** The parts of the foot a ball is touched by: the instep atop it, ahead of the ankle, facing up, and the heel behind it, facing back. */
const touches: Touch.Touches = {
  instep_l: {
    bone: 'foot',
    at: { x: 0, y: 0.04, z: 0.2 },
    radius: 0.03,
    normal: { x: 0, y: 1, z: 0 },
  },
  heel_l: {
    bone: 'foot',
    at: { x: 0, y: 0.02, z: -0.06 },
    radius: 0.03,
    normal: { x: 0, y: 0, z: -1 },
  },
};

/** The leg swung forward from the hip by `angle` degrees. */
const swung = (angle: number): Pose.Pose => ({
  ...Pose.rest,
  turns: { thigh: { flex: degrees(angle) } },
});

describe('Touch.of', () => {
  it('finds a ball resting on the instep touched by the instep, facing up', () => {
    const ball = { at: { x: 0, y: 0.04 + 0.03 + 0.11 - 0.001, z: 0.2 }, radius: 0.11 };

    const touched = Touch.of(leg, joints, touches, Pose.rest, Pose.rest, ball, 1 / 60);

    expect(Option.map(touched, ({ part }) => part)).toEqual(Option.some('instep_l'));
    expect(Option.map(touched, ({ normal }) => normal.y)).toEqual(
      Option.some(expect.closeTo(1, 9)),
    );
    expect(Option.map(touched, ({ facing }) => facing.y)).toEqual(
      Option.some(expect.closeTo(1, 9)),
    );
  });

  it('finds nothing touched by a ball out of every part’s reach', () => {
    const ball = { at: { x: 0, y: 0.5, z: 1 }, radius: 0.11 };

    expect(Touch.of(leg, joints, touches, Pose.rest, Pose.rest, ball, 1 / 60)).toEqual(
      Option.none(),
    );
  });

  it('finds the shin’s flesh touched where no touch point is', () => {
    const ball = { at: { x: 0, y: 0.3, z: 0.05 + 0.11 - 0.001 }, radius: 0.11 };

    const touched = Touch.of(leg, joints, touches, Pose.rest, Pose.rest, ball, 1 / 60);

    expect(Option.map(touched, ({ part }) => part)).toEqual(Option.some('calf'));
    expect(Option.map(touched, ({ normal }) => normal.z)).toEqual(
      Option.some(expect.closeTo(1, 9)),
    );
  });

  it('finds a foot swung through a ball touching it moving as fast as the foot’s point moves, though the ball lay between where the foot was and where it is', () => {
    // The instep swung from 30° behind to 30° ahead in a sixtieth of a second, the ball where it passes, at the bottom.
    const seconds = 1 / 60;
    const ball = { at: { x: 0, y: 0.04, z: 0.2 + 0.03 + 0.11 }, radius: 0.11 };

    const touched = Touch.of(leg, joints, touches, swung(-30), swung(30), ball, seconds);

    expect(Option.map(touched, ({ part }) => part)).toEqual(Option.some('instep_l'));
    // The instep turns about the hip, a metre above it, at a radian every 1/60 s × 3/π: about 60 m/s ahead.
    const speed = Option.map(touched, ({ velocity }) => velocity.z);
    expect(Option.getOrElse(speed, () => 0)).toBeGreaterThan(50);
    expect(Option.getOrElse(speed, () => 0)).toBeLessThan(70);
  });
});
