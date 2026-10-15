import { Option, Schema } from 'effect';
import * as Joint from '#src/Joint.ts';
import * as Maths from '#src/Maths.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * A figure's pose as plain data: each joint's motions' values, anatomically, where the whole figure stands, and how it is turned. From it a step and a view alike place every bone (`place`, forward kinematics), keep every motion within its limits and set what follows (`clamp`), mix poses, go between them, and weigh the figure (`centreOfMass`), worked out with `Maths` through `Quaternion`, alike on every engine. A joint turns from how it was made by each motion's value less its rest, about the motion's axis, in the joint's order; poses are blended on those turns, and read back as the motions' values, never by adding values one after another.
 */

/** A figure's pose: where the whole figure stands and how it is turned, from how its model was made, and each joint's motions' values, anatomically, by its bone's name and the motion's; a joint or a motion not named is at its rest, as made. */
export const Pose = Schema.Struct({
  at: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
  turn: Quaternion.Quaternion,
  turns: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Finite)),
});
export type Pose = typeof Pose.Type;

/** A figure as her model was made: standing where it stood, turned no way, every motion at its rest. */
export const rest: Pose = { at: { x: 0, y: 0, z: 0 }, turn: Quaternion.identity, turns: {} };

/** Where a bone of a posed figure stands and how it is turned. */
export interface Placed {
  readonly at: Ray.Point;
  readonly turn: Quaternion.Quaternion;
}

/** The value of the motion `motion` of `joint` at `angles`: as named, or its rest. */
const valueIn = (joint: Joint.Joint, angles: Joint.Angles, motion: string) =>
  angles[motion] ?? joint.motions[motion]?.rest ?? 0;

/** The turn of `joint` at `angles`, in its bone's own frame as made: each motion's value less its rest, about its axis, multiplied in the joint's order, the last turning a direction first. Nothing turns at rest. */
export const turnOf = (joint: Joint.Joint, angles: Joint.Angles): Quaternion.Quaternion =>
  joint.order.reduce<Quaternion.Quaternion>((turn, name) => {
    const motion = joint.motions[name];
    return motion === undefined
      ? turn
      : Quaternion.multiply(
          turn,
          Quaternion.about(motion.axis, valueIn(joint, angles, name) - motion.rest),
        );
  }, Quaternion.identity);

/** How many Newton steps `anglesOf` takes at most: enough for any turn a joint makes to settle to the last bit, few enough that a step's cost is known. */
const NEWTON_STEPS = 16;

const dot = (a: Ray.Point, b: Ray.Point) => a.x * b.x + a.y * b.y + a.z * b.z;

/** `x` solving `m x = r`, for `m` three rows of three, by Cramer's rule; nothing where it has no single answer. */
const solved = (m: ReadonlyArray<ReadonlyArray<number>>, r: ReadonlyArray<number>) => {
  const at = (row: number, column: number) => m[row]?.[column] ?? 0;
  const det = (a: (row: number, column: number) => number) =>
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
    a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
    a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  const whole = det(at);
  if (Math.abs(whole) < 1e-300) {
    return [0, 0, 0];
  }
  return [0, 1, 2].map(
    (column) => det((row, c) => (c === column ? (r[row] ?? 0) : at(row, c))) / whole,
  );
};

/**
 * The values of `joint`'s motions that turn its bone by `turn`, in its own frame as made: the turn its motions make in its order brought onto `turn` by Newton's steps, from the values `from` names, or their rest; least squares where it has fewer than three motions, so what the joint cannot turn is dropped. A joint with no motions has none.
 */
export const anglesOf = (
  joint: Joint.Joint,
  turn: Quaternion.Quaternion,
  from: Joint.Angles = {},
): Joint.Angles => {
  const names = joint.order.filter((name) => joint.motions[name] !== undefined);
  if (names.length === 0) {
    return {};
  }
  const offsets = names.map(
    (name) => valueIn(joint, from, name) - (joint.motions[name]?.rest ?? 0),
  );
  for (let step = 0; step < NEWTON_STEPS; step++) {
    // Each motion's axis as the motions before it in the order turn it: how the turn grows with its value.
    const columns: Array<Ray.Point> = [];
    let prefix = Quaternion.identity;
    names.forEach((name, at) => {
      const axis = joint.motions[name]?.axis ?? { x: 0, y: 0, z: 0 };
      columns.push(Quaternion.rotate(prefix, axis));
      prefix = Quaternion.multiply(prefix, Quaternion.about(axis, offsets[at] ?? 0));
    });
    const miss = Quaternion.axisAngle(Quaternion.multiply(turn, Quaternion.invert(prefix)));
    const error = {
      x: miss.axis.x * miss.angle,
      y: miss.axis.y * miss.angle,
      z: miss.axis.z * miss.angle,
    };
    if (Maths.hypot(error.x, error.y, error.z) < 1e-15) {
      break;
    }
    // Least squares, (Jᵀ J) Δ = Jᵀ e, over as many motions as it has.
    const m = [0, 1, 2].map((row) =>
      [0, 1, 2].map((column) => {
        const a = columns[row];
        const b = columns[column];
        return a === undefined || b === undefined ? (row === column ? 1 : 0) : dot(a, b);
      }),
    );
    const r = [0, 1, 2].map((row) => {
      const a = columns[row];
      return a === undefined ? 0 : dot(a, error);
    });
    const delta = solved(m, r);
    names.forEach((_, at) => {
      offsets[at] = (offsets[at] ?? 0) + (delta[at] ?? 0);
    });
  }
  return Object.fromEntries(
    names.map((name, at) => [name, (joint.motions[name]?.rest ?? 0) + (offsets[at] ?? 0)]),
  );
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
    const own = joint === undefined ? Quaternion.identity : turnOf(joint, pose.turns[name] ?? {});
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

/** The measure `measure` of the bone `bone`, placed as `placed` places it: the angle between its own +y and the measure's direction in the frame of the bone it is measured from; its rest, if either is not placed. */
export const measured = (
  placed: Readonly<Record<string, Placed>>,
  bone: string,
  measure: Joint.Measure,
): number => {
  const own = placed[bone];
  const from = placed[measure.from];
  if (own === undefined || from === undefined) {
    return measure.rest;
  }
  const along = Quaternion.rotate(own.turn, { x: 0, y: 1, z: 0 });
  const toward = Quaternion.rotate(from.turn, measure.direction);
  const lengths =
    Maths.hypot(along.x, along.y, along.z) * Maths.hypot(toward.x, toward.y, toward.z);
  return lengths === 0
    ? measure.rest
    : Maths.acos(Math.min(Math.max(dot(along, toward) / lengths, -1), 1));
};

/** How many times the motions that follow are set: a shoulder blade follows an arm's elevation, which its own turn changes, so it settles over several: a third of a turn followed, as a blade follows, is left a hundredth of a degree off. */
const FOLLOW_PASSES = 8;

/**
 * `pose` with every motion within its limits, and every motion that follows set: each joint's motions in its order, each within its range at the pose as clamped so far, a bound that depends on another motion read at that motion's value outright; then, a few passes, each motion that follows another joint's motion, or a measure of how a bone lies, the value its table reads there added to its own value as clamped. A pose within every limit, with nothing that follows, is given back as it is.
 */
export const clamp = (bones: Shape.Bones, joints: Joint.Joints, pose: Pose): Pose => {
  let turns: Joint.Turns = pose.turns;
  for (const [name, joint] of Object.entries(joints)) {
    for (const motion of joint.order) {
      const range = Joint.limitsAt(joints, turns, name)[motion];
      if (range === undefined) {
        continue;
      }
      const value = Joint.valueOf(joints, turns, { bone: name, motion });
      const within = Math.min(Math.max(value, range[0]), range[1]);
      if (within !== value) {
        turns = { ...turns, [name]: { ...turns[name], [motion]: within } };
      }
    }
  }
  const followers = Object.entries(joints).filter(([, joint]) => joint.follows.length > 0);
  if (followers.length === 0) {
    return turns === pose.turns ? pose : { ...pose, turns };
  }
  const clamped = turns;
  for (let pass = 0; pass < FOLLOW_PASSES; pass++) {
    const placed = place(bones, joints, { ...pose, turns });
    let next = clamped;
    for (const [name, joint] of followers) {
      for (const { motion, on, table } of joint.follows) {
        const measure = joints[on.bone]?.measures[on.motion];
        const value =
          measure === undefined
            ? Joint.valueOf(joints, turns, on)
            : measured(placed, on.bone, measure);
        const own = Joint.valueOf(joints, next, { bone: name, motion });
        next = { ...next, [name]: { ...next[name], [motion]: own + Joint.along(table, value) } };
      }
    }
    turns = next;
  }
  return { ...pose, turns };
};

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

/** Each joint `poses` turn, its turn made by `turning`, read back as its motions' values from those of `from`. */
const joined = (
  joints: Joint.Joints,
  poses: ReadonlyArray<Pose>,
  from: Pose,
  turning: (joint: Joint.Joint, name: string) => Quaternion.Quaternion,
): Joint.Turns =>
  Object.fromEntries(
    namesOf(poses).flatMap((name) => {
      const joint = joints[name];
      return joint === undefined
        ? []
        : [[name, anglesOf(joint, turning(joint, name), from.turns[name] ?? {})]];
    }),
  );

/**
 * `poses` mixed by their weights, on their turns: each joint's turns blended and read back as its motions' values, and where the figure stands and how it is turned blended too. Weights need not add to a whole; a pose weighing nothing counts for nothing.
 */
export const mix = (joints: Joint.Joints, poses: ReadonlyArray<readonly [Pose, number]>): Pose => {
  const counted = poses.filter(([, weight]) => weight > 0);
  const total = counted.reduce((sum, [, weight]) => sum + weight, 0);
  const [first] = counted;
  if (total === 0 || first === undefined) {
    return rest;
  }
  const share = counted.map(([pose, weight]) => [pose, weight / total] as const);
  const at = share.reduce(
    (sum, [pose, weight]) => ({
      x: sum.x + pose.at.x * weight,
      y: sum.y + pose.at.y * weight,
      z: sum.z + pose.at.z * weight,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    at,
    turn: blended(share.map(([pose, weight]) => [pose.turn, weight] as const)),
    turns: joined(
      joints,
      share.map(([pose]) => pose),
      first[0],
      (joint, name) =>
        blended(
          share.map(([pose, weight]) => [turnOf(joint, pose.turns[name] ?? {}), weight] as const),
        ),
    ),
  };
};

/** The pose `t` of the way from `a` to `b`, at a steady pace: each joint's turn, and the figure's, the short way round, never through a turn neither holds, and where it stands along the line between. */
export const between = (joints: Joint.Joints, a: Pose, b: Pose, t: number): Pose => ({
  at: {
    x: a.at.x + (b.at.x - a.at.x) * t,
    y: a.at.y + (b.at.y - a.at.y) * t,
    z: a.at.z + (b.at.z - a.at.z) * t,
  },
  turn: Quaternion.slerp(a.turn, b.turn, t),
  turns: joined(joints, [a, b], a, (joint, name) =>
    Quaternion.slerp(turnOf(joint, a.turns[name] ?? {}), turnOf(joint, b.turns[name] ?? {}), t),
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
  turns: joined(joints, [pose, additive], pose, (joint, name) =>
    Quaternion.multiply(
      turnOf(joint, pose.turns[name] ?? {}),
      Quaternion.slerp(Quaternion.identity, turnOf(joint, additive.turns[name] ?? {}), weight),
    ),
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
