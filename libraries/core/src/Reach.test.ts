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
