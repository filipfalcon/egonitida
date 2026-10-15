import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Joint from '#src/Joint.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import * as Shape from '#src/Shape.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

const ALONG = { x: 0, y: 1, z: 0 };

/** How far `point` is from `x`, `y`, `z`. */
const off = (point: Pose.Placed | undefined, x: number, y: number, z: number) =>
  point === undefined ? Infinity : Math.hypot(point.at.x - x, point.at.y - y, point.at.z - z);

/** A motion about `axis`, within `range` degrees, at `rest` degrees as made. */
const motion = (
  axis: readonly [number, number, number],
  range: readonly [number, number],
  rest = 0,
): Joint.Motion => ({
  axis: { x: axis[0], y: axis[1], z: axis[2] },
  range: [degrees(range[0]), degrees(range[1])],
  rest: degrees(rest),
});

/** A joint of `kind` with `motions`, turned in the order they are named. */
const joint = (
  kind: Joint.Kind,
  motions: Readonly<Record<string, Joint.Motion>>,
  more: Partial<Joint.Joint> = {},
): Joint.Joint => ({
  kind,
  motions,
  order: Object.keys(motions),
  depends: [],
  follows: [],
  measures: {},
  flesh: Option.none(),
  ...more,
});

/** A leg standing as a model was made, facing +z: a hip a metre up, a knee half a metre below it, and a foot on the ground, each bone turned as made by `made`. */
const legMade = (made: Quaternion.Quaternion): Shape.Bones => ({
  thigh: { parent: Option.none(), at: { x: 0, y: 1, z: 0 }, turn: made },
  calf: { parent: Option.some('thigh'), at: { x: 0, y: 0.5, z: 0 }, turn: made },
  foot: { parent: Option.some('calf'), at: { x: 0, y: 0, z: 0 }, turn: made },
});
const leg = legMade(Quaternion.identity);

/** A knee flexing about the line across it, `across` in its own frame, made bent 2°, and rotating as it bends, its rotation nothing straight and 30° in and 40° out at 90°. */
const kneeAbout = (across: readonly [number, number, number]): Joint.Joint =>
  joint(
    'Hinge',
    { flex: motion(across, [-5, 140], 2), rotate: motion([0, 1, 0], [0, 0]) },
    {
      depends: [
        {
          motion: 'rotate',
          end: 'max',
          on: { bone: 'calf', motion: 'flex' },
          table: [
            [0, 0],
            [degrees(90), degrees(40)],
          ],
        },
        {
          motion: 'rotate',
          end: 'min',
          on: { bone: 'calf', motion: 'flex' },
          table: [
            [0, 0],
            [degrees(90), degrees(-30)],
          ],
        },
      ],
      flesh: Option.some({ radius: 0.05, length: 0.5, mass: 3 }),
    },
  );

/** A hip flexing the leg forward, abducting it outward, and rotating it. */
const hip = joint(
  'Ball',
  {
    flex: motion([-1, 0, 0], [-20, 120]),
    abduct: motion([0, 0, 1], [-30, 45]),
    rotate: motion([0, 1, 0], [-40, 45]),
  },
  { flesh: Option.some({ radius: 0.07, length: 0.5, mass: 7 }) },
);

const joints: Joint.Joints = { thigh: hip, calf: kneeAbout([1, 0, 0]) };

/** The leg's pose with each joint's motions as `turns` says, standing where it was made. */
const posed = (turns: Joint.Turns): Pose.Pose => ({ ...Pose.rest, turns });

/** A knee flexed `angle` degrees, and rotated `rotate`. */
const knee = (angle: number, rotate = 0): Joint.Turns => ({
  calf: { flex: degrees(angle), rotate: degrees(rotate) },
});

describe('Pose.place', () => {
  it('stands every bone where the model was made, every motion at its rest', () => {
    const placed = Pose.place(leg, joints, Pose.rest);

    expect(off(placed['thigh'], 0, 1, 0)).toBeLessThan(1e-12);
    expect(off(placed['foot'], 0, 0, 0)).toBeLessThan(1e-12);
  });

  it('turns each bone below a joint by each motion’s value less its rest, the bones below carried along', () => {
    // Made bent 2°, flexed to 92°: a quarter turn from how it was made.
    const placed = Pose.place(leg, joints, posed(knee(92)));

    expect(off(placed['calf'], 0, 0.5, 0)).toBeLessThan(1e-12);
    expect(off(placed['foot'], 0, 0.5, -0.5)).toBeLessThan(1e-12);
  });

  it('reads a motion’s axis in its bone’s own frame, however the bone was turned as made', () => {
    const made = Quaternion.about(ALONG, Math.PI / 2);
    const placed = Pose.place(
      legMade(made),
      { thigh: hip, calf: kneeAbout([0, 0, 1]) },
      posed(knee(92)),
    );

    expect(off(placed['foot'], 0, 0.5, -0.5)).toBeLessThan(1e-12);
  });

  it('turns a joint by its motions in its order, the last turning a direction first', () => {
    // Abducted a quarter about z first, the leg lies along +x; flexed then about −x, it stays there.
    const both = joint('Ball', {
      flex: motion([-1, 0, 0], [-180, 180]),
      abduct: motion([0, 0, 1], [-180, 180]),
    });
    const placed = Pose.place(
      leg,
      { thigh: both },
      posed({ thigh: { flex: degrees(90), abduct: degrees(90) } }),
    );

    expect(off(placed['calf'], 0.5, 1, 0)).toBeLessThan(1e-12);
  });

  it('stands the whole figure where the pose puts it, turned as it says', () => {
    const placed = Pose.place(leg, joints, {
      at: { x: 2, y: 0, z: 3 },
      turn: Quaternion.about(ALONG, Math.PI),
      turns: knee(92),
    });

    expect(off(placed['thigh'], 2, 1, 3)).toBeLessThan(1e-12);
    expect(off(placed['foot'], 2, 0.5, 3.5)).toBeLessThan(1e-12);
  });

  it('places a figure as she is shaped, her bones drawn out as the dials draw them', () => {
    const shape = Shape.make({ shin: Shape.lengthen(['foot'], { by: 0.5 }) });

    const placed = Pose.place(Shape.shaped(shape, leg, { shin: 1 }), joints, Pose.rest);

    expect(off(placed['foot'], 0, -0.25, 0)).toBeLessThan(1e-12);
  });
});

describe('Pose.anglesOf', () => {
  it('reads a turn back as the motions’ values that make it', () => {
    const angles = { flex: degrees(35), abduct: degrees(-12), rotate: degrees(20) };

    const read = Pose.anglesOf(hip, Pose.turnOf(hip, angles));

    expect(read['flex']).toBeCloseTo(angles.flex, 12);
    expect(read['abduct']).toBeCloseTo(angles.abduct, 12);
    expect(read['rotate']).toBeCloseTo(angles.rotate, 12);
  });

  it('reads a turn back about axes that are not square to one another, as a clavicle’s are', () => {
    const clavicle = joint('Ball', {
      elevate: motion([0, 0, 1], [-10, 35]),
      protract: motion([0.3, 0.95, 0], [-25, 15]),
    });
    const angles = { elevate: degrees(25), protract: degrees(-18) };

    const read = Pose.anglesOf(clavicle, Pose.turnOf(clavicle, angles));

    expect(read['elevate']).toBeCloseTo(angles.elevate, 12);
    expect(read['protract']).toBeCloseTo(angles.protract, 12);
  });

  it('drops what a joint cannot turn', () => {
    const read = Pose.anglesOf(
      joints['calf'] ?? hip,
      Quaternion.multiply(
        Quaternion.about({ x: 1, y: 0, z: 0 }, 0.5),
        Quaternion.about({ x: 0, y: 0, z: 1 }, 0.2),
      ),
    );

    expect(read['flex']).toBeCloseTo(degrees(2) + 0.5, 2);
  });
});

describe('Pose.clamp', () => {
  it('flexes a knee no further than it flexes', () => {
    const clamped = Pose.clamp(leg, joints, posed(knee(170)));

    expect(clamped.turns['calf']?.['flex']).toBeCloseTo(degrees(140), 12);
  });

  it('rotates a bent knee as far as its tables let it, and a straight one not at all', () => {
    expect(Pose.clamp(leg, joints, posed(knee(90, 50))).turns['calf']?.['rotate']).toBeCloseTo(
      degrees(40),
      12,
    );
    expect(Pose.clamp(leg, joints, posed(knee(0, 50))).turns['calf']?.['rotate']).toBeCloseTo(
      0,
      12,
    );
  });

  it('leaves a pose within every limit as it is', () => {
    const within = posed({
      thigh: { flex: degrees(30), abduct: degrees(-10), rotate: degrees(20) },
      ...knee(60),
    });

    expect(Pose.clamp(leg, joints, within)).toEqual(within);
  });

  it('adds to a motion that follows another what its table reads, as a twist bone takes half its parent’s rotation back', () => {
    const twist = joint(
      'Follower',
      { rotate: motion([0, 1, 0], [0, 0]) },
      {
        follows: [
          {
            motion: 'rotate',
            on: { bone: 'thigh', motion: 'rotate' },
            table: [
              [-Math.PI, Math.PI / 2],
              [Math.PI, -Math.PI / 2],
            ],
          },
        ],
      },
    );

    const clamped = Pose.clamp(
      leg,
      { ...joints, calf: twist },
      posed({ thigh: { rotate: degrees(30) } }),
    );

    expect(clamped.turns['calf']?.['rotate']).toBeCloseTo(degrees(-15), 12);
  });

  it('turns a shoulder blade up by the arm’s elevation, which its own turn raises, until they settle', () => {
    // A trunk, a blade on it, and an arm hanging from the blade, the blade and the arm made pointing down their own +y.
    const down = Quaternion.about({ x: 0, y: 0, z: 1 }, Math.PI);
    const shoulder: Shape.Bones = {
      trunk: { parent: Option.none(), at: { x: 0, y: 1.4, z: 0 }, turn: Quaternion.identity },
      blade: { parent: Option.some('trunk'), at: { x: 0.2, y: 1.4, z: 0 }, turn: down },
      arm: { parent: Option.some('blade'), at: { x: 0.2, y: 1.35, z: 0 }, turn: down },
    };
    const raising: Joint.Joints = {
      trunk: joint('Free', {}),
      blade: joint(
        'Follower',
        { up: motion([0, 0, -1], [0, 0]) },
        {
          follows: [
            {
              motion: 'up',
              on: { bone: 'arm', motion: 'elevation' },
              table: [
                [degrees(30), 0],
                [degrees(180), degrees(50)],
              ],
            },
          ],
        },
      ),
      arm: joint(
        'Ball',
        { abduct: motion([0, 0, -1], [-30, 120]) },
        { measures: { elevation: { from: 'trunk', direction: { x: 0, y: -1, z: 0 }, rest: 0 } } },
      ),
    };

    const clamped = Pose.clamp(shoulder, raising, posed({ arm: { abduct: degrees(90) } }));

    // A third of the elevation past 30°, the elevation the arm's 90° and the blade's own turn: 30°.
    expect(clamped.turns['blade']?.['up']).toBeCloseTo(degrees(30), 3);
  });
});

describe('mixing poses', () => {
  it('mixes poses by their weights, on the turns, read back as the motions’ values', () => {
    const mixed = Pose.mix(joints, [
      [posed(knee(2)), 1],
      [posed(knee(92)), 1],
    ]);

    expect(mixed.turns['calf']?.['flex']).toBeCloseTo(degrees(47), 12);
  });

  it('goes between two poses at a steady pace, through nothing neither holds', () => {
    const halfway = Pose.between(
      joints,
      posed({ thigh: { rotate: degrees(-40) } }),
      posed({ thigh: { rotate: degrees(40) } }),
      0.25,
    );

    expect(halfway.turns['thigh']?.['rotate']).toBeCloseTo(degrees(-20), 12);
    expect(halfway.turns['thigh']?.['flex']).toBeCloseTo(0, 12);
  });

  it('adds a turn over a pose by a weight', () => {
    const added = Pose.add(joints, posed(knee(32)), posed(knee(42)), 0.5);

    expect(added.turns['calf']?.['flex']).toBeCloseTo(degrees(52), 12);
  });
});

describe('Pose.points', () => {
  it('stands each bone where the pose places it, as a ragdoll starts from where she is', () => {
    const bent = posed(knee(92));

    const points = Pose.points(leg, joints, bent);

    expect(points['foot']).toEqual(Pose.place(leg, joints, bent)['foot']?.at);
    expect(Object.keys(points)).toEqual(['thigh', 'calf', 'foot']);
  });
});

describe('Pose.centreOfMass', () => {
  it('weighs every bone’s flesh where it lies', () => {
    const centre = Pose.centreOfMass(leg, joints, posed(knee(92)));

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
