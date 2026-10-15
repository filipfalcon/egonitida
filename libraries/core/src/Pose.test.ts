import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Joint from '#src/Joint.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import * as Shape from '#src/Shape.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

const ACROSS = { x: 1, y: 0, z: 0 };
const ALONG = { x: 0, y: 1, z: 0 };
const AHEAD = { x: 0, y: 0, z: 1 };

/** How far `point` is from `x`, `y`, `z`. */
const off = (point: Pose.Placed | undefined, x: number, y: number, z: number) =>
  point === undefined ? Infinity : Math.hypot(point.at.x - x, point.at.y - y, point.at.z - z);

/** A leg standing as a model was made, facing +z: a hip a metre up, a knee half a metre below it, and a foot on the ground, each bone turned as made by `made`. */
const legMade = (made: Quaternion.Quaternion): Shape.Bones => ({
  thigh: { parent: Option.none(), at: { x: 0, y: 1, z: 0 }, turn: made },
  calf: { parent: Option.some('thigh'), at: { x: 0, y: 0.5, z: 0 }, turn: made },
  foot: { parent: Option.some('calf'), at: { x: 0, y: 0, z: 0 }, turn: made },
});
const leg = legMade(Quaternion.identity);

/** A knee bending one way, about the line across it, `across` in its own frame. */
const kneeAbout = (across: Joint.Joint['axes']['flex']): Joint.Joint => ({
  kind: 'Hinge',
  axes: { flex: across, abduct: Option.none(), twist: Option.some(ALONG) },
  swing: { flex: [degrees(-5), degrees(140)], abduct: Option.none() },
  twist: Option.some([0, 0]),
  depends: [],
  follows: Option.none(),
  flesh: Option.some({ radius: 0.05, length: 0.5, mass: 3 }),
});

/** A hip turning every way, its swing within a cone of four semi-axes. */
const hip: Joint.Joint = {
  kind: 'Ball',
  axes: { flex: ACROSS, abduct: Option.some(AHEAD), twist: Option.some(ALONG) },
  swing: { flex: [degrees(-20), degrees(120)], abduct: Option.some([degrees(-30), degrees(45)]) },
  twist: Option.some([degrees(-40), degrees(45)]),
  depends: [],
  follows: Option.none(),
  flesh: Option.some({ radius: 0.07, length: 0.5, mass: 7 }),
};

const joints: Joint.Joints = { thigh: hip, calf: kneeAbout(ACROSS) };

/** The leg's pose with each joint turned as `turns` says, standing where it was made. */
const posed = (turns: Joint.Turns): Pose.Pose => ({ ...Pose.rest, turns });

/** A joint turned by `flex`, `abduct`, and `twist` degrees. */
const turned = (flex: number, abduct = 0, twist = 0): Joint.Angles => ({
  flex: degrees(flex),
  abduct: degrees(abduct),
  twist: degrees(twist),
});

describe('Pose.place', () => {
  it('stands every bone where the model was made, at rest', () => {
    const placed = Pose.place(leg, joints, Pose.rest);

    expect(off(placed['thigh'], 0, 1, 0)).toBeLessThan(1e-12);
    expect(off(placed['foot'], 0, 0, 0)).toBeLessThan(1e-12);
  });

  it('turns each bone below a joint about its axis, the bones below carried along', () => {
    const placed = Pose.place(leg, joints, posed({ calf: turned(90) }));

    // The shin, bent a quarter turn about the line across the knee, lies behind it.
    expect(off(placed['calf'], 0, 0.5, 0)).toBeLessThan(1e-12);
    expect(off(placed['foot'], 0, 0.5, -0.5)).toBeLessThan(1e-12);
  });

  it('reads a joint’s axes in its bone’s own frame, however the bone was turned as made', () => {
    const made = Quaternion.about(ALONG, Math.PI / 2);
    // Turned a quarter about the leg, the line across the knee lies, in the bone's own frame, ahead.
    const placed = Pose.place(
      legMade(made),
      { thigh: hip, calf: kneeAbout({ x: 0, y: 0, z: 1 }) },
      posed({ calf: turned(90) }),
    );

    expect(off(placed['foot'], 0, 0.5, -0.5)).toBeLessThan(1e-12);
  });

  it('stands the whole figure where the pose puts it, turned as it says', () => {
    const placed = Pose.place(leg, joints, {
      at: { x: 2, y: 0, z: 3 },
      turn: Quaternion.about(ALONG, Math.PI),
      turns: { calf: turned(90) },
    });

    expect(off(placed['thigh'], 2, 1, 3)).toBeLessThan(1e-12);
    expect(off(placed['foot'], 2, 0.5, 3.5)).toBeLessThan(1e-12);
  });

  it('places a figure as she is shaped, her bones drawn out as the dials draw them', () => {
    const shape = Shape.make({ shin: Shape.lengthen(['foot'], { by: 0.5 }) });

    const placed = Pose.place(Shape.shaped(shape, leg, { shin: 1 }), joints, posed({}));

    expect(off(placed['foot'], 0, -0.25, 0)).toBeLessThan(1e-12);
  });
});

describe('Pose.clamp', () => {
  it('bends a knee no further than it bends', () => {
    const clamped = Pose.clamp(joints, posed({ calf: turned(170) }));

    expect(clamped.turns['calf']?.flex).toBeCloseTo(degrees(140), 12);
  });

  it('swings a hip no further than the cone it swings within, keeping the way it swung', () => {
    const clamped = Pose.clamp(joints, posed({ thigh: turned(120, 45) }));
    const { flex, abduct } = clamped.turns['thigh'] ?? turned(0);

    expect((flex / degrees(120)) ** 2 + (abduct / degrees(45)) ** 2).toBeCloseTo(1, 12);
    expect(flex / abduct).toBeCloseTo(120 / 45, 12);
  });

  it('leaves a pose within every limit as it is', () => {
    const within = posed({ thigh: turned(30, -10, 20), calf: turned(60) });

    expect(Pose.clamp(joints, within)).toEqual(within);
  });

  it('turns a joint that follows another as its table reads', () => {
    const blade: Joint.Joint = {
      ...kneeAbout(ACROSS),
      swing: { flex: [degrees(-90), degrees(90)], abduct: Option.none() },
      follows: Option.some({
        joint: 'thigh',
        axis: 'flex',
        sets: 'flex',
        table: [
          [degrees(30), 0],
          [degrees(120), degrees(30)],
        ],
      }),
    };

    const clamped = Pose.clamp({ ...joints, calf: blade }, posed({ thigh: turned(75) }));

    expect(clamped.turns['calf']?.flex).toBeCloseTo(degrees(15), 12);
  });
});

describe('mixing poses', () => {
  it('mixes poses by their weights, on the turns, never adding angles', () => {
    const mixed = Pose.mix(joints, [
      [posed({ calf: turned(0) }), 1],
      [posed({ calf: turned(90) }), 1],
    ]);

    expect(mixed.turns['calf']?.flex).toBeCloseTo(degrees(45), 12);
  });

  it('goes between two poses at a steady pace, through nothing neither holds', () => {
    const halfway = Pose.between(
      joints,
      posed({ thigh: turned(0, 0, -40) }),
      posed({ thigh: turned(0, 0, 40) }),
      0.25,
    );

    expect(halfway.turns['thigh']?.twist).toBeCloseTo(degrees(-20), 12);
    expect(halfway.turns['thigh']?.flex).toBeCloseTo(0, 12);
  });

  it('adds a turn over a pose by a weight', () => {
    const added = Pose.add(joints, posed({ calf: turned(30) }), posed({ calf: turned(40) }), 0.5);

    expect(added.turns['calf']?.flex).toBeCloseTo(degrees(50), 12);
  });
});

describe('Pose.centreOfMass', () => {
  it('weighs every bone’s flesh where it lies', () => {
    const centre = Pose.centreOfMass(leg, joints, posed({ calf: turned(90) }));

    // Each bone's flesh lies along it, its own +y: the thigh's up from the hip, as this leg was made, and the bent shin's turned ahead of the knee.
    const thigh = { x: 0, y: 1.25, z: 0 };
    const shin = { x: 0, y: 0.5, z: 0.25 };
    expect(
      Option.map(centre, ({ x, y, z }) =>
        Math.hypot(
          x - (7 * thigh.x + 3 * shin.x) / 10,
          y - (7 * thigh.y + 3 * shin.y) / 10,
          z - (7 * thigh.z + 3 * shin.z) / 10,
        ),
      ),
    ).toEqual(Option.some(expect.closeTo(0, 12)));
  });
});
