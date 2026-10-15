import { Option } from 'effect';
import * as Joint from '#src/Joint.ts';
import * as Maths from '#src/Maths.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * Reaching: a pose turned so a limb's end comes to a point, and faces a way, within its joints' limits, as a footballer puts her foot on the ball. It is worked out in a fixed amount of work, analytically where it can be, so a step's cost is known, with `Maths`, so every host comes to the same pose; and it says how far short it fell, for a target out of reach or a turn beyond a joint.
 */

/** A surface of a limb to face a way: `normal`, in the frame of the bone `bone`, turned toward `toward`, in the model's space, by the joints `turning`, in order, as far as their limits let them. */
export interface Facing {
  readonly bone: string;
  readonly normal: Ray.Point;
  readonly toward: Ray.Point;
  readonly turning: ReadonlyArray<string>;
}

/** A limb asked to reach: from the joint `root`, such as a hip, through the joint of the bone above `end`, such as a knee, to `end`, such as an ankle, brought to `to`; its middle joint bending toward `swivel`, a point, if given; and a surface of it facing as `facing` says, if given. All in the model's space. */
export interface Limb {
  readonly root: string;
  readonly end: string;
  readonly to: Ray.Point;
  readonly swivel?: Ray.Point | undefined;
  readonly facing?: Facing | undefined;
}

/** A pose reached: the pose, how far its end fell short of the point, in metres, and how far its surface fell short of facing as asked, in radians. */
export interface Reached {
  readonly pose: Pose.Pose;
  readonly short: number;
  readonly facingShort: number;
}

/** How many times the joints that face a surface are each turned toward it: enough for two or three joints to settle, few enough that a step's cost is known. */
const FACING_PASSES = 8;

const less = (a: Ray.Point, b: Ray.Point): Ray.Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: Ray.Point, b: Ray.Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Ray.Point, b: Ray.Point): Ray.Point => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const times = (a: Ray.Point, by: number): Ray.Point => ({ x: a.x * by, y: a.y * by, z: a.z * by });
const length = (a: Ray.Point) => Maths.hypot(a.x, a.y, a.z);
const unit = (a: Ray.Point): Ray.Point => {
  const long = length(a);
  return long === 0 ? a : times(a, 1 / long);
};

/** `angle` brought within a half turn either way. */
const wrapped = (angle: number) => Maths.atan2(Maths.sin(angle), Maths.cos(angle));

/** `pose` with the joint `name` turned to `angles`. */
const turning = (pose: Pose.Pose, name: string, angles: Joint.Angles): Pose.Pose => ({
  ...pose,
  turns: { ...pose.turns, [name]: angles },
});

/** The angles of `name` in `pose`. */
const anglesIn = (pose: Pose.Pose, name: string) => pose.turns[name] ?? Joint.still;

/** The frame a joint turns in, in the model's space: its bone's turn less its own joint's turn, where its axes lie. */
const frameOf = (placed: Pose.Placed, joint: Joint.Joint, angles: Joint.Angles) =>
  Quaternion.multiply(placed.turn, Quaternion.invert(Pose.turnOf(joint, angles)));

/** How far `value` lies outside `range`. */
const outside = (value: number, [min, max]: Joint.Range) =>
  value < min ? min - value : value > max ? value - max : 0;

/** `value` within `range`. */
const within = (value: number, [min, max]: Joint.Range) => Math.min(Math.max(value, min), max);

/**
 * The bend of the hinge `middle` that brings the end of the limb from `root` through it to `distance` from the root's joint: analytically, the bend about the hinge's own axis, however it lies, of the two that do so the one its limits allow, or else the one nearer them, clamped; at full stretch, or folded, for a distance beyond what the limb reaches.
 */
const bendFor = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  names: { readonly root: string; readonly middle: string; readonly end: string },
  middle: Joint.Joint,
  distance: number,
) => {
  const angles = anglesIn(pose, names.middle);
  const straight = turning(pose, names.middle, { ...angles, flex: 0 });
  const placed = Pose.place(bones, joints, straight);
  const hip = placed[names.root];
  const knee = placed[names.middle];
  const foot = placed[names.end];
  if (hip === undefined || knee === undefined || foot === undefined) {
    return angles.flex;
  }
  const axis = unit(
    Quaternion.rotate(frameOf(knee, middle, { ...angles, flex: 0 }), middle.axes.flex),
  );
  const g = less(knee.at, hip.at);
  const v = less(foot.at, knee.at);
  const along = times(axis, dot(v, axis));
  const square = less(v, along);
  // |end − root|² = |g|² + |v|² + 2 (g·v∥ + b cos φ + c sin φ).
  const a = dot(g, along);
  const b = dot(g, square);
  const c = dot(g, cross(axis, square));
  const reach = Maths.hypot(b, c);
  if (reach === 0) {
    return angles.flex;
  }
  const e = (distance * distance - dot(g, g) - dot(v, v)) / 2 - a;
  const spread = Maths.acos(Math.min(Math.max(e / reach, -1), 1));
  const centre = Maths.atan2(c, b);
  const range = Joint.limitsAt(joints, pose.turns, names.middle).flex;
  const [first, second] = [wrapped(centre + spread), wrapped(centre - spread)];
  const firstOut = outside(first, range);
  const secondOut = outside(second, range);
  const chosen =
    firstOut < secondOut
      ? first
      : secondOut < firstOut
        ? second
        : Math.abs(first - angles.flex) <= Math.abs(second - angles.flex)
          ? first
          : second;
  return within(chosen, range);
};

/**
 * The turn of the joint `root` that brings the limb's end from where it is to `to`: the shortest turn of the whole limb about the root's joint onto the line to it, then about that line until its middle joint lies toward `swivel`, if given; as the root's own angles.
 */
const aimFor = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  names: { readonly root: string; readonly middle: string; readonly end: string },
  root: Joint.Joint,
  ask: Limb,
): Joint.Angles => {
  const angles = anglesIn(pose, names.root);
  const placed = Pose.place(bones, joints, pose);
  const hip = placed[names.root];
  const knee = placed[names.middle];
  const foot = placed[names.end];
  if (hip === undefined || knee === undefined || foot === undefined) {
    return angles;
  }
  const toward = less(ask.to, hip.at);
  if (length(toward) === 0) {
    return angles;
  }
  const onto = Quaternion.between(less(foot.at, hip.at), toward);
  const line = unit(toward);
  const swivelled =
    ask.swivel === undefined
      ? onto
      : (() => {
          // About the line to the target, until the middle joint lies toward the swivel.
          const kneeNow = Quaternion.rotate(onto, less(knee.at, hip.at));
          const from = less(kneeNow, times(line, dot(kneeNow, line)));
          const hint = less(ask.swivel, hip.at);
          const to = less(hint, times(line, dot(hint, line)));
          if (length(from) === 0 || length(to) === 0) {
            return onto;
          }
          const turn = Maths.atan2(dot(cross(from, to), line), dot(from, to));
          return Quaternion.multiply(Quaternion.about(line, turn), onto);
        })();
  // The root's own turn after the whole limb is turned in the model's space: Q · W⁻¹ · T · W.
  const own = Pose.turnOf(root, angles);
  const turned = Quaternion.multiply(
    Quaternion.multiply(Quaternion.multiply(own, Quaternion.invert(hip.turn)), swivelled),
    hip.turn,
  );
  return Pose.anglesOf(root, turned);
};

/** The way the surface `facing` faces now, in the model's space, at `pose`. */
const facingNow = (bones: Shape.Bones, joints: Joint.Joints, pose: Pose.Pose, facing: Facing) => {
  const placed = Pose.place(bones, joints, pose)[facing.bone];
  return placed === undefined ? facing.normal : unit(Quaternion.rotate(placed.turn, facing.normal));
};

/**
 * `pose` with the joints of `facing` turned, in order, a fixed number of passes, each about each of its swing axes as far toward facing as asked as its limits let it, analytically for that axis.
 */
const faced = (bones: Shape.Bones, joints: Joint.Joints, pose: Pose.Pose, facing: Facing) => {
  const toward = unit(facing.toward);
  let now = pose;
  for (let pass = 0; pass < FACING_PASSES; pass++) {
    for (const name of facing.turning) {
      const joint = joints[name];
      const placed = Pose.place(bones, joints, now)[name];
      if (joint === undefined || placed === undefined) {
        continue;
      }
      // Each way it swings, as a hinge about that axis alone, toward facing as asked.
      const swings: ReadonlyArray<readonly [Joint.Axis, Ray.Point]> = [
        ['flex', joint.axes.flex],
        ...Option.toArray(Option.map(joint.axes.abduct, (axis) => ['abduct', axis] as const)),
      ];
      for (const [axisName, local] of swings) {
        const angles = anglesIn(now, name);
        const frame = frameOf(Pose.place(bones, joints, now)[name] ?? placed, joint, angles);
        const axis = unit(Quaternion.rotate(frame, local));
        const normal = facingNow(bones, joints, now, facing);
        const square = less(normal, times(axis, dot(normal, axis)));
        const turn = Maths.atan2(dot(cross(axis, normal), toward), dot(square, toward));
        const limits = Joint.limitsAt(joints, now.turns, name);
        const range =
          axisName === 'flex' ? limits.flex : Option.getOrElse(limits.abduct, () => limits.flex);
        now = turning(now, name, { ...angles, [axisName]: within(angles[axisName] + turn, range) });
      }
    }
  }
  return now;
};

/**
 * `pose` with the limb `ask` names reaching: its middle joint bent so its end lies as far from its root's joint as `ask.to`, analytically, about the hinge's own axis; its root's joint turned to bring the end onto the point, and about the line to it so the middle joint lies toward `ask.swivel`; the pose clamped to every joint's limits; and then the joints `ask.facing` names turned to face its surface as asked. Says how far the end fell short of the point, and the surface of facing as asked. A limb whose joints the bones and joints do not make, a root, a middle joint whose parent it is, and an end below that, is left as it is.
 */
export const limb = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  ask: Limb,
): Reached => {
  const middleName = Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(bones[ask.end]), ({ parent }) => parent),
  );
  const middleBone = middleName === undefined ? undefined : bones[middleName];
  const root = joints[ask.root];
  const middle = middleName === undefined ? undefined : joints[middleName];
  const shortOf = (reached: Pose.Pose) => {
    const placed = Pose.place(bones, joints, reached)[ask.end];
    return placed === undefined ? Infinity : length(less(placed.at, ask.to));
  };
  if (
    middleName === undefined ||
    root === undefined ||
    middle === undefined ||
    !Option.contains(
      Option.flatMap(Option.fromNullishOr(middleBone), ({ parent }) => parent),
      ask.root,
    )
  ) {
    return { pose, short: shortOf(pose), facingShort: 0 };
  }
  const names = { root: ask.root, middle: middleName, end: ask.end };
  const hip = Pose.place(bones, joints, pose)[ask.root];
  const distance = hip === undefined ? 0 : length(less(ask.to, hip.at));
  const bent = turning(pose, middleName, {
    ...anglesIn(pose, middleName),
    flex: bendFor(bones, joints, pose, names, middle, distance),
  });
  const aimed = Pose.clamp(
    joints,
    turning(bent, ask.root, aimFor(bones, joints, bent, names, root, ask)),
  );
  const { facing } = ask;
  if (facing === undefined) {
    return { pose: aimed, short: shortOf(aimed), facingShort: 0 };
  }
  const turned = Pose.clamp(joints, faced(bones, joints, aimed, facing));
  const normal = facingNow(bones, joints, turned, facing);
  return {
    pose: turned,
    short: shortOf(turned),
    facingShort: Maths.acos(Math.min(Math.max(dot(normal, unit(facing.toward)), -1), 1)),
  };
};
