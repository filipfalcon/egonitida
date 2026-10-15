import { Option, Schema } from 'effect';
import * as Joint from '#src/Joint.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * A figure's pose as plain data: each joint's angles about its own axes, where the whole figure stands, and how it is turned. From it a step and a view alike place every bone (`place`, forward kinematics), keep every joint within its limits (`clamp`), mix poses, go between them, and weigh the figure (`centreOfMass`), worked out with `Maths` through `Quaternion`, alike on every engine. A joint's angles are its swing, a turn about the axis its bend and abduction make together, after its twist about the bone: what a joint's limits are written in, never angles added one after another.
 */

const Angles = Schema.Struct({ flex: Schema.Finite, abduct: Schema.Finite, twist: Schema.Finite });

/** A figure's pose: where the whole figure stands and how it is turned, from how its model was made, and each joint's angles, by its bone's name; a joint not named is as made. */
export const Pose = Schema.Struct({
  at: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
  turn: Quaternion.Quaternion,
  turns: Schema.Record(Schema.String, Angles),
});
export type Pose = typeof Pose.Type;

/** A figure as her model was made: standing where it stood, turned no way. */
export const rest: Pose = { at: { x: 0, y: 0, z: 0 }, turn: Quaternion.identity, turns: {} };

/** Where a bone of a posed figure stands and how it is turned. */
export interface Placed {
  readonly at: Ray.Point;
  readonly turn: Quaternion.Quaternion;
}

/** The turn of `joint` at `angles`, in its bone's own frame: its swing, about the axis its bend and abduction make together, after its twist about the bone. */
export const turnOf = (joint: Joint.Joint, angles: Joint.Angles): Quaternion.Quaternion => {
  const { flex, abduct, twist } = joint.axes;
  const across = Option.getOrElse(abduct, () => ({ x: 0, y: 0, z: 0 }));
  const swing = {
    x: angles.flex * flex.x + angles.abduct * across.x,
    y: angles.flex * flex.y + angles.abduct * across.y,
    z: angles.flex * flex.z + angles.abduct * across.z,
  };
  const length = Math.sqrt(swing.x * swing.x + swing.y * swing.y + swing.z * swing.z);
  const swung = length === 0 ? Quaternion.identity : Quaternion.about(swing, length);
  return Option.match(twist, {
    onNone: () => swung,
    onSome: (along) => Quaternion.multiply(swung, Quaternion.about(along, angles.twist)),
  });
};

/** The angles of `joint` that turn its bone by `turn`, in its own frame: the twist about the bone first taken out, then the swing read along the joint's axes. What the joint cannot turn is dropped. */
export const anglesOf = (joint: Joint.Joint, turn: Quaternion.Quaternion): Joint.Angles => {
  const { flex, abduct, twist } = joint.axes;
  const { swing, twist: twisted } = Option.match(twist, {
    onNone: () => ({ swing: turn, twist: Quaternion.identity }),
    onSome: (along) => Quaternion.swingTwist(turn, along),
  });
  const { axis, angle } = Quaternion.axisAngle(swing);
  const along = (direction: Ray.Point) =>
    angle * (axis.x * direction.x + axis.y * direction.y + axis.z * direction.z);
  const twistAngle = Option.match(twist, {
    onNone: () => 0,
    onSome: (direction) => {
      const turned = Quaternion.axisAngle(twisted);
      return (
        turned.angle *
        (turned.axis.x * direction.x + turned.axis.y * direction.y + turned.axis.z * direction.z)
      );
    },
  });
  return {
    flex: along(flex),
    abduct: Option.match(abduct, { onNone: () => 0, onSome: along }),
    twist: twistAngle,
  };
};

/** `point` less `from`. */
const less = (point: Ray.Point, from: Ray.Point): Ray.Point => ({
  x: point.x - from.x,
  y: point.y - from.y,
  z: point.z - from.z,
});

/** `point` and `by` together. */
const plus = (point: Ray.Point, by: Ray.Point): Ray.Point => ({
  x: point.x + by.x,
  y: point.y + by.y,
  z: point.z + by.z,
});

/**
 * Where every one of `bones` stands and how it is turned, `joints` turned as `pose` says (forward kinematics): each bone where it was made from its parent, carried with its parent's turn, and turned by its own joint, if it is one; the bones with no parent placed and turned as the whole figure is. On a figure shaped by `Shape.shaped`, she is posed as she is shaped.
 */
export const place = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose,
): Readonly<Record<string, Placed>> => {
  const placed = new Map<string, Placed>();
  const placing = (name: string, bone: Shape.Bone): Placed => {
    const known = placed.get(name);
    if (known !== undefined) {
      return known;
    }
    const joint = joints[name];
    const own =
      joint === undefined ? Quaternion.identity : turnOf(joint, pose.turns[name] ?? Joint.still);
    const parent = Option.flatMap(bone.parent, (above) =>
      Option.map(Option.fromNullishOr(bones[above]), (made) => ({ name: above, made })),
    );
    const now = Option.match(parent, {
      onNone: () => ({
        at: plus(Quaternion.rotate(pose.turn, bone.at), pose.at),
        turn: Quaternion.multiply(Quaternion.multiply(pose.turn, bone.turn), own),
      }),
      onSome: ({ name: above, made }) => {
        const from = placing(above, made);
        const back = Quaternion.invert(made.turn);
        // Where it was made, and how it was turned, in its parent's own frame.
        const offset = Quaternion.rotate(back, less(bone.at, made.at));
        const local = Quaternion.multiply(back, bone.turn);
        return {
          at: plus(from.at, Quaternion.rotate(from.turn, offset)),
          turn: Quaternion.multiply(Quaternion.multiply(from.turn, local), own),
        };
      },
    });
    placed.set(name, now);
    return now;
  };
  return Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, placing(name, bone)]),
  );
};

/** Where every one of `bones` stands, posed as `pose` says, by name: as a ragdoll starts from the pose she is in, through `Ragdoll.among`, rather than from how her model was made. */
export const points = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose,
): Readonly<Record<string, Ray.Point>> =>
  Object.fromEntries(
    Object.entries(place(bones, joints, pose)).map(([name, { at }]) => [name, at]),
  );

/** `value` within `range`. */
const within = (value: number, [min, max]: Joint.Range) => Math.min(Math.max(value, min), max);

/** How far a joint swings toward one side of `range`, at `value`: its semi-axis that side. */
const semiAxis = (value: number, [min, max]: Joint.Range) => (value >= 0 ? max : -min);

/** `flex` and `abduct` within the elliptic cone of four semi-axes `flexRange` and `abductRange` make, drawn back toward nothing along the way they swing if beyond it; within the ranges alone where the cone does not hold nothing. */
const swungWithin = (
  flex: number,
  abduct: number,
  flexRange: Joint.Range,
  abductRange: Joint.Range,
): readonly [number, number] => {
  const f = semiAxis(flex, flexRange);
  const a = semiAxis(abduct, abductRange);
  if (f < 0 || a < 0) {
    return [within(flex, flexRange), within(abduct, abductRange)];
  }
  // A side a joint does not swing to at all holds that axis still.
  const bentAt = f === 0 ? 0 : flex;
  const abductedAt = a === 0 ? 0 : abduct;
  const reach =
    (f === 0 ? 0 : (bentAt / f) * (bentAt / f)) +
    (a === 0 ? 0 : (abductedAt / a) * (abductedAt / a));
  if (reach <= 1) {
    return [bentAt, abductedAt];
  }
  const scale = 1 / Math.sqrt(reach);
  return [bentAt * scale, abductedAt * scale];
};

/** `angles` of a joint within `limits`: its swing within its cone, or its range for a hinge, and its twist within its range, or none if it does not twist. */
const clampedTo = (angles: Joint.Angles, limits: Joint.Limits): Joint.Angles => {
  const [flex, abduct] = Option.match(limits.abduct, {
    onNone: () => [within(angles.flex, limits.flex), 0] as const,
    onSome: (abductRange) => swungWithin(angles.flex, angles.abduct, limits.flex, abductRange),
  });
  const twist = Option.match(limits.twist, {
    onNone: () => 0,
    onSome: (range) => within(angles.twist, range),
  });
  return flex === angles.flex && abduct === angles.abduct && twist === angles.twist
    ? angles
    : { flex, abduct, twist };
};

/**
 * `pose` with every joint within its limits, in the order of `joints`: its swing first, its limits at the pose as clamped so far, then its twist, at its swing as clamped, so a knee's twist narrows as it straightens; and then every joint that follows another turned as its table reads. A pose within every limit is given back as it is.
 */
export const clamp = (joints: Joint.Joints, pose: Pose): Pose => {
  let turns: Joint.Turns = pose.turns;
  for (const name of Object.keys(joints)) {
    const angles = turns[name] ?? Joint.still;
    // Its swing first, its twist left as it is; then its twist, within its limits at that swing.
    const swung = {
      ...clampedTo(angles, Joint.limitsAt(joints, turns, name)),
      twist: angles.twist,
    };
    const settled = clampedTo(swung, Joint.limitsAt(joints, { ...turns, [name]: swung }, name));
    if (!sameAngles(settled, angles)) {
      turns = { ...turns, [name]: settled };
    }
  }
  for (const [name, joint] of Object.entries(joints)) {
    turns = Option.match(joint.follows, {
      onNone: () => turns,
      onSome: (follows) => ({
        ...turns,
        [name]: {
          ...(turns[name] ?? Joint.still),
          [follows.sets]: Joint.along(
            follows.table,
            Joint.angleOf(turns, follows.joint, follows.axis),
          ),
        },
      }),
    });
  }
  return turns === pose.turns ? pose : { ...pose, turns };
};

/** Whether two joints' angles are the same. */
const sameAngles = (a: Joint.Angles, b: Joint.Angles) =>
  a.flex === b.flex && a.abduct === b.abduct && a.twist === b.twist;

/** The names of every joint any of `poses` turns. */
const namesOf = (poses: ReadonlyArray<Pose>) => [
  ...new Set(poses.flatMap(({ turns }) => Object.keys(turns))),
];

/** The turn `weighted` blends to: each written the way round nearest the first, weighed, and brought to length one. */
const blended = (weighted: ReadonlyArray<readonly [Quaternion.Quaternion, number]>) => {
  const [first] = weighted;
  if (first === undefined) {
    return Quaternion.identity;
  }
  const sum = { x: 0, y: 0, z: 0, w: 0 };
  for (const [turn, weight] of weighted) {
    const sign = Quaternion.dot(first[0], turn) < 0 ? -weight : weight;
    sum.x += turn.x * sign;
    sum.y += turn.y * sign;
    sum.z += turn.z * sign;
    sum.w += turn.w * sign;
  }
  return Quaternion.normalize(sum);
};

/**
 * `poses` mixed by their weights, on their turns: each joint's turns blended and read back as its angles, and where the figure stands and how it is turned blended too. Weights need not add to a whole; a pose weighing nothing counts for nothing.
 */
export const mix = (joints: Joint.Joints, poses: ReadonlyArray<readonly [Pose, number]>): Pose => {
  const counted = poses.filter(([, weight]) => weight > 0);
  const total = counted.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) {
    return rest;
  }
  const share = counted.map(([pose, weight]) => [pose, weight / total] as const);
  const turns = Object.fromEntries(
    namesOf(share.map(([pose]) => pose)).flatMap((name) => {
      const joint = joints[name];
      return joint === undefined
        ? []
        : [
            [
              name,
              anglesOf(
                joint,
                blended(
                  share.map(
                    ([pose, weight]) =>
                      [turnOf(joint, pose.turns[name] ?? Joint.still), weight] as const,
                  ),
                ),
              ),
            ],
          ];
    }),
  );
  const at = share.reduce(
    (sum, [pose, weight]) => ({
      x: sum.x + pose.at.x * weight,
      y: sum.y + pose.at.y * weight,
      z: sum.z + pose.at.z * weight,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return { at, turn: blended(share.map(([pose, weight]) => [pose.turn, weight] as const)), turns };
};

/** The pose `t` of the way from `a` to `b`, at a steady pace: each joint's turn, and the figure's, the short way round, never through a turn neither holds, and where it stands along the line between. */
export const between = (joints: Joint.Joints, a: Pose, b: Pose, t: number): Pose => ({
  at: {
    x: a.at.x + (b.at.x - a.at.x) * t,
    y: a.at.y + (b.at.y - a.at.y) * t,
    z: a.at.z + (b.at.z - a.at.z) * t,
  },
  turn: Quaternion.slerp(a.turn, b.turn, t),
  turns: Object.fromEntries(
    namesOf([a, b]).flatMap((name) => {
      const joint = joints[name];
      return joint === undefined
        ? []
        : [
            [
              name,
              anglesOf(
                joint,
                Quaternion.slerp(
                  turnOf(joint, a.turns[name] ?? Joint.still),
                  turnOf(joint, b.turns[name] ?? Joint.still),
                  t,
                ),
              ),
            ],
          ];
    }),
  ),
});

/** `pose` with `additive`'s turns added over it by `weight`, each after the joint's own, in its bone's frame, as a breath or a flinch goes over whatever she does; and where `additive` stands added too, by the weight. */
export const add = (joints: Joint.Joints, pose: Pose, additive: Pose, weight: number): Pose => ({
  at: {
    x: pose.at.x + additive.at.x * weight,
    y: pose.at.y + additive.at.y * weight,
    z: pose.at.z + additive.at.z * weight,
  },
  turn: Quaternion.multiply(
    pose.turn,
    Quaternion.slerp(Quaternion.identity, additive.turn, weight),
  ),
  turns: Object.fromEntries(
    namesOf([pose, additive]).flatMap((name) => {
      const joint = joints[name];
      return joint === undefined
        ? []
        : [
            [
              name,
              anglesOf(
                joint,
                Quaternion.multiply(
                  turnOf(joint, pose.turns[name] ?? Joint.still),
                  Quaternion.slerp(
                    Quaternion.identity,
                    turnOf(joint, additive.turns[name] ?? Joint.still),
                    weight,
                  ),
                ),
              ),
            ],
          ];
    }),
  ),
});

/** Where the mass of `bones` lies, posed as `pose` says: each joint's flesh weighed at the middle of its capsule, along its bone's own +y from where it stands; none if no flesh weighs anything. */
export const centreOfMass = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose,
): Option.Option<Ray.Point> => {
  const placed = place(bones, joints, pose);
  const sum = { x: 0, y: 0, z: 0, mass: 0 };
  for (const [name, joint] of Object.entries(joints)) {
    const bone = placed[name];
    if (bone === undefined || Option.isNone(joint.flesh)) {
      continue;
    }
    const { length, mass } = joint.flesh.value;
    const middle = plus(bone.at, Quaternion.rotate(bone.turn, { x: 0, y: length / 2, z: 0 }));
    sum.x += middle.x * mass;
    sum.y += middle.y * mass;
    sum.z += middle.z * mass;
    sum.mass += mass;
  }
  return sum.mass === 0
    ? Option.none()
    : Option.some({ x: sum.x / sum.mass, y: sum.y / sum.mass, z: sum.z / sum.mass });
};
