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

/** How far a trunk is asked to turn about its length, bend forward, and lean to the side, in radians, each spread over its joints. */
export interface Trunk {
  readonly joints: ReadonlyArray<string>;
  readonly turn: number;
  readonly bend: number;
  readonly side: number;
}

/** A trunk's pose reached: the pose, and how far short of each it fell, in radians. */
export interface Spread {
  readonly pose: Pose.Pose;
  readonly short: { readonly turn: number; readonly bend: number; readonly side: number };
}

/** How far the joint `name` turns about `axis` toward the sign of `asked`, at `pose`: what its range lets it, nothing for a way it does not turn. */
const reachOf = (
  joints: Joint.Joints,
  pose: Pose.Pose,
  name: string,
  axis: Joint.Axis,
  asked: number,
) => {
  const limits = Joint.limitsAt(joints, pose.turns, name);
  const range =
    axis === 'flex' ? Option.some(limits.flex) : axis === 'abduct' ? limits.abduct : limits.twist;
  return Option.match(range, {
    onNone: () => 0,
    onSome: ([min, max]) => (asked >= 0 ? Math.max(max, 0) : Math.max(-min, 0)),
  });
};

/**
 * `pose` with a trunk's turn, bend, and lean spread over `ask.joints`, each segment taking a share as large as how far it turns that way, as the spine spreads them: the lumbar spine bends far and hardly turns, the thoracic spine turns. Those axes of those joints are set, the rest left as they are, and the pose clamped. Asked beyond them all, each turns as far as it does, and it says how far short.
 */
export const spine = (joints: Joint.Joints, pose: Pose.Pose, ask: Trunk): Spread => {
  const asked: ReadonlyArray<readonly [Joint.Axis, number]> = [
    ['twist', ask.turn],
    ['flex', ask.bend],
    ['abduct', ask.side],
  ];
  let turns = pose.turns;
  for (const [axis, total] of asked) {
    const reaches = ask.joints.map((name) => reachOf(joints, pose, name, axis, total));
    const all = reaches.reduce((sum, reach) => sum + reach, 0);
    ask.joints.forEach((name, at) => {
      const reach = reaches[at] ?? 0;
      const share =
        all === 0 ? 0 : Math.abs(total) >= all ? Math.sign(total) * reach : (total * reach) / all;
      turns = { ...turns, [name]: { ...(turns[name] ?? Joint.still), [axis]: share } };
    });
  }
  const clamped = Pose.clamp(joints, { ...pose, turns });
  const reached = (axis: Joint.Axis) =>
    ask.joints.reduce((sum, name) => sum + Joint.angleOf(clamped.turns, name, axis), 0);
  return {
    pose: clamped,
    short: {
      turn: Math.abs(ask.turn - reached('twist')),
      bend: Math.abs(ask.bend - reached('flex')),
      side: Math.abs(ask.side - reached('abduct')),
    },
  };
};

/** Where to look, and with what: the point `at`, in the model's space; the eyes, their `forward` the way each looks in its own frame; and the joints of the neck, from the one nearest the body, which turn the head for what the eyes cannot reach. */
export interface Look {
  readonly at: Ray.Point;
  readonly eyes: ReadonlyArray<string>;
  readonly forward: Ray.Point;
  readonly neck: ReadonlyArray<string>;
}

/** A look reached: the pose, and how far short of looking at the point the eyes fell, in radians, the most of any eye. */
export interface Looked {
  readonly pose: Pose.Pose;
  readonly short: number;
}

/** How many times the eyes and the neck are each turned toward what they look at: enough for the head's turn carrying the eyes along to settle. */
const LOOK_PASSES = 3;

/** The angle between two directions. */
const angleBetween = (a: Ray.Point, b: Ray.Point) =>
  Maths.acos(Math.min(Math.max(dot(unit(a), unit(b)), -1), 1));

/** How far `eye` looks short of `at` at `pose`, and the way it looks and the way to the point, in the model's space. */
const gazeOf = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  eye: string,
  ask: Look,
) => {
  const placed = Pose.place(bones, joints, pose)[eye];
  if (placed === undefined) {
    return Option.none();
  }
  const looking = unit(Quaternion.rotate(placed.turn, ask.forward));
  const toward = unit(less(ask.at, placed.at));
  return Option.some({ placed, looking, toward, short: angleBetween(looking, toward) });
};

/**
 * `pose` with the eyes looking at `ask.at`: the eyes first, as far as they turn; then, for what they cannot reach, the neck, its turn, bend, and lean spread over its joints as `spine` spreads them, the head carrying the eyes along; and the eyes again, a fixed number of passes. Says how far short the eyes fell.
 */
export const look = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  ask: Look,
): Looked => {
  const [eye] = ask.eyes;
  const [base] = ask.neck;
  const eyesOn = (now: Pose.Pose) =>
    ask.eyes.reduce((looked, name) => {
      const gaze = gazeOf(bones, joints, looked, name, ask);
      return Option.match(gaze, {
        onNone: () => looked,
        onSome: ({ toward }) =>
          Pose.clamp(
            joints,
            faced(bones, joints, looked, {
              bone: name,
              normal: ask.forward,
              toward,
              turning: [name],
            }),
          ),
      });
    }, now);
  let now = eyesOn(pose);
  for (let pass = 0; pass < LOOK_PASSES && eye !== undefined && base !== undefined; pass++) {
    const gaze = gazeOf(bones, joints, now, eye, ask);
    const baseJoint = joints[base];
    const basePlaced = Pose.place(bones, joints, now)[base];
    if (Option.isNone(gaze) || baseJoint === undefined || basePlaced === undefined) {
      break;
    }
    if (gaze.value.short < 1e-9) {
      break;
    }
    // What the eyes cannot reach, the neck turns: the whole turn from where they look to the point, less as far as they still turn.
    const whole = Quaternion.between(gaze.value.looking, gaze.value.toward);
    const ahead = eyesOn(now);
    const left = Option.match(gazeOf(bones, joints, ahead, eye, ask), {
      onNone: () => 0,
      onSome: ({ short }) => short,
    });
    const share = gaze.value.short === 0 ? 0 : left / gaze.value.short;
    const neckTurn = Quaternion.slerp(Quaternion.identity, whole, share);
    // In the frame the neck turns in, as its turn about its length, its bend, and its lean.
    const frame = frameOf(basePlaced, baseJoint, anglesIn(now, base));
    const local = Quaternion.multiply(
      Quaternion.multiply(Quaternion.invert(frame), neckTurn),
      frame,
    );
    const twistAxis = Option.getOrElse(baseJoint.axes.twist, () => ({ x: 0, y: 1, z: 0 }));
    const { swing, twist } = Quaternion.swingTwist(local, twistAxis);
    const twisted = Quaternion.axisAngle(twist);
    const swung = Quaternion.axisAngle(swing);
    const along = (axis: Ray.Point, of: { axis: Ray.Point; angle: number }) =>
      of.angle * dot(of.axis, axis);
    const sum = (axis: Joint.Axis) =>
      ask.neck.reduce((total, name) => total + Joint.angleOf(now.turns, name, axis), 0);
    now = spine(joints, now, {
      joints: ask.neck,
      turn: sum('twist') + along(twistAxis, twisted),
      bend: sum('flex') + along(baseJoint.axes.flex, swung),
      side:
        sum('abduct') +
        Option.match(baseJoint.axes.abduct, {
          onNone: () => 0,
          onSome: (axis) => along(axis, swung),
        }),
    }).pose;
    now = eyesOn(now);
  }
  const short = ask.eyes.reduce(
    (most, name) =>
      Math.max(
        most,
        Option.match(gazeOf(bones, joints, now, name, ask), {
          onNone: () => 0,
          onSome: (gaze) => gaze.short,
        }),
      ),
    0,
  );
  return { pose: now, short };
};

/** A figure asked to stand over one foot: the limb she stands on, from its root's joint to the foot. */
export interface Balance {
  readonly stance: { readonly root: string; readonly end: string };
}

/** How many times the figure is moved over her standing foot, and that foot reached back to where it stood: enough for her legs' turning to settle. */
const BALANCE_PASSES = 6;

/**
 * `pose` with the whole figure moved along the ground so her centre of mass stands over the foot she stands on, lowered as far as that leg needs to reach the ground it stood on, and that leg reaching back to where its foot stood, so it stays planted; a fixed number of passes, as each reach moves her mass a little.
 */
export const balance = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  ask: Balance,
): Pose.Pose => {
  const planted = Pose.place(bones, joints, pose)[ask.stance.end];
  if (planted === undefined) {
    return pose;
  }
  let now = pose;
  for (let pass = 0; pass < BALANCE_PASSES; pass++) {
    const centre = Pose.centreOfMass(bones, joints, now);
    if (Option.isNone(centre)) {
      return now;
    }
    const across = {
      x: planted.at.x - centre.value.x,
      z: planted.at.z - centre.value.z,
    };
    const placed = Pose.place(bones, joints, now);
    const hip = placed[ask.stance.root];
    const middle = Option.getOrUndefined(
      Option.flatMap(Option.fromNullishOr(bones[ask.stance.end]), ({ parent }) => parent),
    );
    const knee = middle === undefined ? undefined : placed[middle];
    const foot = placed[ask.stance.end];
    // As low as the leg needs, at full stretch, to stand on the ground it stood on.
    const lower =
      hip === undefined || knee === undefined || foot === undefined
        ? 0
        : (() => {
            const stretch = length(less(knee.at, hip.at)) + length(less(foot.at, knee.at));
            const aside = Maths.hypot(
              hip.at.x + across.x - planted.at.x,
              hip.at.z + across.z - planted.at.z,
            );
            const height = hip.at.y - planted.at.y;
            const most = aside >= stretch ? 0 : Math.sqrt(stretch * stretch - aside * aside);
            return Math.max(height - most, 0);
          })();
    const moved = {
      ...now,
      at: { x: now.at.x + across.x, y: now.at.y - lower, z: now.at.z + across.z },
    };
    now = limb(bones, joints, moved, { ...ask.stance, to: planted.at }).pose;
  }
  return now;
};
