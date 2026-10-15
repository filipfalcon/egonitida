import { Option } from 'effect';
import * as Joint from '#src/Joint.ts';
import * as Maths from '#src/Maths.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * Reaching: a pose turned so a limb's end comes to a point, and faces a way, within its joints' limits, as a footballer puts her foot on the ball; a trunk's turn spread over the spine; a look; and a figure balanced over the foot she stands on. It is worked out in a fixed amount of work, analytically where it can be, so a step's cost is known, with `Maths`, so every host comes to the same pose; and it says how far short it fell, for a target out of reach or a turn beyond a joint.
 */

/** A surface of a limb to face a way: `normal`, in the frame of the bone `bone`, turned toward `toward`, in the model's space, by every motion of the joints `turning`, in order, as far as their limits let them. */
export interface Facing {
  readonly bone: string;
  readonly normal: Ray.Point;
  readonly toward: Ray.Point;
  readonly turning: ReadonlyArray<string>;
}

/** A limb asked to reach: from the joint `root`, such as a hip, through the joint of the bone above `end`, such as a knee, bending by its motion `bend`, `flex` unless named, to `end`, such as an ankle, brought to `to`; its middle joint lying toward `swivel`, a point, if given; and a surface of it facing as `facing` says, if given. All in the model's space. */
export interface Limb {
  readonly root: string;
  readonly end: string;
  readonly to: Ray.Point;
  readonly bend?: string | undefined;
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

/** `pose` with the motion `motion` of the joint `name` at `value`. */
const setting = (pose: Pose.Pose, name: string, motion: string, value: number): Pose.Pose => ({
  ...pose,
  turns: { ...pose.turns, [name]: { ...pose.turns[name], [motion]: value } },
});

/** `pose` with the joint `name` turned to `angles`. */
const turning = (pose: Pose.Pose, name: string, angles: Joint.Angles): Pose.Pose => ({
  ...pose,
  turns: { ...pose.turns, [name]: { ...pose.turns[name], ...angles } },
});

/** The angles of `name` in `pose`. */
const anglesIn = (pose: Pose.Pose, name: string): Joint.Angles => pose.turns[name] ?? {};

/** The axis of the motion `motion` of `joint`, its bone placed as `placed` and turned as `angles` says, in the model's space: turned by the frame the joint turns in and by the motions before it in the joint's order, so a turn of that motion alone is a turn about it. */
const axisOf = (
  joint: Joint.Joint,
  placed: Pose.Placed,
  angles: Joint.Angles,
  motion: string,
): Option.Option<Ray.Point> => {
  const own = joint.motions[motion];
  if (own === undefined) {
    return Option.none();
  }
  const frame = Quaternion.multiply(placed.turn, Quaternion.invert(Pose.turnOf(joint, angles)));
  const before = joint.order.slice(0, joint.order.indexOf(motion));
  const prefix = Pose.turnOf({ ...joint, order: before }, angles);
  return Option.some(unit(Quaternion.rotate(Quaternion.multiply(frame, prefix), own.axis)));
};

/** How far `value` lies outside `range`. */
const outside = (value: number, [min, max]: Joint.Range) =>
  value < min ? min - value : value > max ? value - max : 0;

/** `value` within `range`. */
const within = (value: number, [min, max]: Joint.Range) => Math.min(Math.max(value, min), max);

/**
 * The value of the motion `bend` of the joint `middle` that brings the end of the limb from `root` through it to `distance` from the root's joint: analytically, the turn about that motion's own axis, however it lies, of the two that do so the one its limits allow, or else the one nearer them, clamped; at full stretch, or folded, for a distance beyond what the limb reaches.
 */
const bendFor = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  names: { readonly root: string; readonly middle: string; readonly end: string },
  middle: Joint.Joint,
  bend: string,
  distance: number,
) => {
  const motion = middle.motions[bend];
  const current = Joint.valueOf(joints, pose.turns, { bone: names.middle, motion: bend });
  if (motion === undefined) {
    return current;
  }
  const atRest = setting(pose, names.middle, bend, motion.rest);
  const placed = Pose.placer(bones, joints, atRest);
  const hip = placed(names.root);
  const knee = placed(names.middle);
  const foot = placed(names.end);
  const axis =
    knee === undefined ? Option.none() : axisOf(middle, knee, anglesIn(atRest, names.middle), bend);
  if (hip === undefined || knee === undefined || foot === undefined || Option.isNone(axis)) {
    return current;
  }
  const g = less(knee.at, hip.at);
  const v = less(foot.at, knee.at);
  const along = times(axis.value, dot(v, axis.value));
  const square = less(v, along);
  // |end − root|² = |g|² + |v|² + 2 (g·v∥ + b cos φ + c sin φ), φ the turn from rest.
  const a = dot(g, along);
  const b = dot(g, square);
  const c = dot(g, cross(axis.value, square));
  const reach = Maths.hypot(b, c);
  if (reach === 0) {
    return current;
  }
  const e = (distance * distance - dot(g, g) - dot(v, v)) / 2 - a;
  const spread = Maths.acos(Math.min(Math.max(e / reach, -1), 1));
  const centre = Maths.atan2(c, b);
  const range = Joint.limitsAt(joints, pose.turns, names.middle)[bend] ?? motion.range;
  const first = motion.rest + wrapped(centre + spread);
  const second = motion.rest + wrapped(centre - spread);
  const firstOut = outside(first, range);
  const secondOut = outside(second, range);
  const chosen =
    firstOut < secondOut
      ? first
      : secondOut < firstOut
        ? second
        : Math.abs(first - current) <= Math.abs(second - current)
          ? first
          : second;
  return within(chosen, range);
};

/**
 * The angles of the joint `root` that bring the limb's end from where it is to `to`: the shortest turn of the whole limb about the root's joint onto the line to it, then about that line until its middle joint lies toward `swivel`, if given; read back as the root's motions' values.
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
  const placed = Pose.placer(bones, joints, pose);
  const hip = placed(names.root);
  const knee = placed(names.middle);
  const foot = placed(names.end);
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
  return Pose.anglesOf(root, turned, angles);
};

/** The way the surface `facing` faces now, in the model's space, at `pose`. */
const facingNow = (bones: Shape.Bones, joints: Joint.Joints, pose: Pose.Pose, facing: Facing) => {
  const placed = Pose.placer(bones, joints, pose)(facing.bone);
  return placed === undefined ? facing.normal : unit(Quaternion.rotate(placed.turn, facing.normal));
};

/**
 * `pose` with the joints of `facing` turned, in order, at most a fixed number of passes, until it faces as asked or a pass turns nothing, each of their motions in their order, as far toward facing as asked as its limits let it, analytically for that motion's axis.
 */
const faced = (bones: Shape.Bones, joints: Joint.Joints, pose: Pose.Pose, facing: Facing) => {
  const toward = unit(facing.toward);
  let now = pose;
  for (let pass = 0; pass < FACING_PASSES; pass++) {
    // Facing as asked already, it turns no further.
    if (dot(facingNow(bones, joints, now, facing), toward) > 1 - 1e-18) {
      break;
    }
    const before = now;
    for (const name of facing.turning) {
      const joint = joints[name];
      const bone = bones[name];
      if (joint === undefined || bone === undefined) {
        continue;
      }
      // The frame it turns in, from where its parent stands, which its own turning moves not: placed once.
      const above = Option.getOrUndefined(bone.parent);
      const parentBone = above === undefined ? undefined : bones[above];
      const parent = above === undefined ? undefined : Pose.placer(bones, joints, now)(above);
      const frame =
        parentBone === undefined || parent === undefined
          ? Quaternion.multiply(now.turn, bone.turn)
          : Quaternion.multiply(
              parent.turn,
              Quaternion.multiply(Quaternion.invert(parentBone.turn), bone.turn),
            );
      for (const [at, motion] of joint.order.entries()) {
        const own = joint.motions[motion];
        const range = Joint.limitsAt(joints, now.turns, name)[motion];
        if (own === undefined || range === undefined) {
          continue;
        }
        const angles = anglesIn(now, name);
        const prefix = Pose.turnOf({ ...joint, order: joint.order.slice(0, at) }, angles);
        const axis = unit(Quaternion.rotate(Quaternion.multiply(frame, prefix), own.axis));
        // The surface's way: on this bone, from its frame; further down, placed.
        const normal =
          facing.bone === name
            ? unit(
                Quaternion.rotate(
                  Quaternion.multiply(frame, Pose.turnOf(joint, angles)),
                  facing.normal,
                ),
              )
            : facingNow(bones, joints, now, facing);
        const square = less(normal, times(axis, dot(normal, axis)));
        const turn = Maths.atan2(dot(cross(axis, normal), toward), dot(square, toward));
        const value = Joint.valueOf(joints, now.turns, { bone: name, motion });
        const turned = within(value + turn, range);
        if (turned !== value) {
          now = setting(now, name, motion, turned);
        }
      }
    }
    // A pass that turned nothing, each joint as far as its limits let it: another would turn nothing either.
    if (now === before) {
      break;
    }
  }
  return now;
};

/**
 * `pose` with the limb `ask` names reaching: its middle joint bent by its bending motion so its end lies as far from its root's joint as `ask.to`, analytically, about that motion's own axis; its root's joint turned to bring the end onto the point, and about the line to it so the middle joint lies toward `ask.swivel`; the pose kept within every joint's limits, as `Pose.limit` keeps it, what follows left for `Pose.follow`; and then the joints `ask.facing` names turned to face its surface as asked. Says how far the end fell short of the point, and the surface of facing as asked. A limb whose joints the bones and joints do not make, a root, a middle joint whose parent it is, and an end below that, is left as it is.
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
    const placed = Pose.placer(bones, joints, reached)(ask.end);
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
  const bend = ask.bend ?? 'flex';
  const hip = Pose.placer(bones, joints, pose)(ask.root);
  const distance = hip === undefined ? 0 : length(less(ask.to, hip.at));
  const bent = setting(
    pose,
    middleName,
    bend,
    bendFor(bones, joints, pose, names, middle, bend, distance),
  );
  const aimed = Pose.limit(
    joints,
    turning(bent, ask.root, aimFor(bones, joints, bent, names, root, ask)),
  );
  const { facing } = ask;
  if (facing === undefined) {
    return { pose: aimed, short: shortOf(aimed), facingShort: 0 };
  }
  const turned = Pose.limit(joints, faced(bones, joints, aimed, facing));
  const normal = facingNow(bones, joints, turned, facing);
  return {
    pose: turned,
    short: shortOf(turned),
    facingShort: Maths.acos(Math.min(Math.max(dot(normal, unit(facing.toward)), -1), 1)),
  };
};

/** A trunk asked to turn: each motion, by its name, such as `turn`, `flex`, or `bend`, to a total, anatomically, in radians, spread over the joints `joints`. */
export interface Trunk {
  readonly joints: ReadonlyArray<string>;
  readonly motions: Readonly<Record<string, number>>;
}

/** A trunk's pose reached: the pose, and how far short of each motion's total it fell, in radians, by the motion's name. */
export interface Spread {
  readonly pose: Pose.Pose;
  readonly short: Readonly<Record<string, number>>;
}

/** How far the joint `name` turns by `motion` toward the sign of `asked`, at `pose`: what its range lets it, from nothing; nothing for a motion it does not have. */
const reachOf = (
  joints: Joint.Joints,
  pose: Pose.Pose,
  name: string,
  motion: string,
  asked: number,
) => {
  const range = Joint.limitsAt(joints, pose.turns, name)[motion];
  return range === undefined ? 0 : asked >= 0 ? Math.max(range[1], 0) : Math.max(-range[0], 0);
};

/**
 * `pose` with a trunk's motions spread over `ask.joints`, each segment taking a share of each motion's total as large as how far it turns that way, as the spine spreads them: the lumbar spine flexes far and hardly turns, the thoracic spine turns. Those motions of those joints are set, the rest left as they are, and the pose kept within every limit. Asked beyond them all, each turns as far as it does, and it says how far short of each.
 */
export const spine = (joints: Joint.Joints, pose: Pose.Pose, ask: Trunk): Spread => {
  let turns = pose.turns;
  for (const [motion, total] of Object.entries(ask.motions)) {
    const reaches = ask.joints.map((name) => reachOf(joints, pose, name, motion, total));
    const all = reaches.reduce((sum, reach) => sum + reach, 0);
    ask.joints.forEach((name, at) => {
      if (!Joint.hasMotion(joints, name, motion)) {
        return;
      }
      const reach = reaches[at] ?? 0;
      const share =
        all === 0 ? 0 : Math.abs(total) >= all ? Math.sign(total) * reach : (total * reach) / all;
      turns = { ...turns, [name]: { ...turns[name], [motion]: share } };
    });
  }
  const clamped = Pose.limit(joints, { ...pose, turns });
  const reached = (motion: string) =>
    ask.joints
      .filter((name) => Joint.hasMotion(joints, name, motion))
      .reduce((sum, name) => sum + Joint.valueOf(joints, clamped.turns, { bone: name, motion }), 0);
  return {
    pose: clamped,
    short: Object.fromEntries(
      Object.entries(ask.motions).map(([motion, total]) => [
        motion,
        Math.abs(total - reached(motion)),
      ]),
    ),
  };
};

/** Where to look, and with what: the point `at`, in the model's space; the eyes, `forward` the way each looks in its own frame; and the joints of the neck, from the one nearest the body, which turn the head for what the eyes cannot reach. */
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

/** How far `eye` looks short of `ask.at` at `pose`, the way it looks, and the way to the point, in the model's space. */
const gazeOf = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  eye: string,
  ask: Look,
) => {
  const placed = Pose.placer(bones, joints, pose)(eye);
  if (placed === undefined) {
    return Option.none();
  }
  const looking = unit(Quaternion.rotate(placed.turn, ask.forward));
  const toward = unit(less(ask.at, placed.at));
  return Option.some({ looking, toward, short: angleBetween(looking, toward) });
};

/**
 * `pose` with the eyes looking at `ask.at`: the eyes first, as far as they turn; then, for what they cannot reach, the neck, its turn read as the motions of the joint nearest the body and spread over the neck's joints as `spine` spreads them, the head carrying the eyes along; and the eyes again, a fixed number of passes. Says how far short the eyes fell.
 */
export const look = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  pose: Pose.Pose,
  ask: Look,
): Looked => {
  const [eye] = ask.eyes;
  const [base] = ask.neck;
  // Each eye turned within its own ranges as it faces: nothing else of her moves, so nothing else is clamped.
  const eyesOn = (now: Pose.Pose) =>
    ask.eyes.reduce(
      (looked, name) =>
        Option.match(gazeOf(bones, joints, looked, name, ask), {
          onNone: () => looked,
          onSome: ({ toward }) =>
            faced(bones, joints, looked, {
              bone: name,
              normal: ask.forward,
              toward,
              turning: [name],
            }),
        }),
      now,
    );
  let now = eyesOn(pose);
  for (let pass = 0; pass < LOOK_PASSES && eye !== undefined && base !== undefined; pass++) {
    const gaze = gazeOf(bones, joints, now, eye, ask);
    const baseJoint = joints[base];
    const basePlaced = Pose.placer(bones, joints, now)(base);
    if (
      Option.isNone(gaze) ||
      baseJoint === undefined ||
      basePlaced === undefined ||
      gaze.value.short < 1e-9
    ) {
      break;
    }
    // What the eyes cannot reach, the neck turns: the whole turn from where they look to the point, less as far as they still turn.
    const whole = Quaternion.between(gaze.value.looking, gaze.value.toward);
    const left = Option.match(gazeOf(bones, joints, eyesOn(now), eye, ask), {
      onNone: () => 0,
      onSome: ({ short }) => short,
    });
    const neckTurn = Quaternion.slerp(Quaternion.identity, whole, left / gaze.value.short);
    // That turn in the frame the neck turns in, after its own, read as its motions' values.
    const baseAngles = anglesIn(now, base);
    const ownTurn = Pose.turnOf(baseJoint, baseAngles);
    const frame = Quaternion.multiply(basePlaced.turn, Quaternion.invert(ownTurn));
    const own = Quaternion.multiply(
      Quaternion.multiply(Quaternion.invert(frame), neckTurn),
      Quaternion.multiply(frame, ownTurn),
    );
    const read = Pose.anglesOf(baseJoint, own, baseAngles);
    const motions = Object.fromEntries(
      Object.keys(baseJoint.motions).map((motion) => {
        const added =
          (read[motion] ?? 0) - Joint.valueOf(joints, now.turns, { bone: base, motion });
        const sum = ask.neck
          .filter((name) => Joint.hasMotion(joints, name, motion))
          .reduce(
            (total, name) => total + Joint.valueOf(joints, now.turns, { bone: name, motion }),
            0,
          );
        return [motion, sum + added];
      }),
    );
    now = eyesOn(spine(joints, now, { joints: ask.neck, motions }).pose);
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

/** A figure asked to stand over one foot: the limb she stands on, from its root's joint to the foot, bending by its motion `bend`, `flex` unless named; and how many passes she takes to settle over it, six unless named, fewer for a step that cannot spare the time. */
export interface Balance {
  readonly stance: {
    readonly root: string;
    readonly end: string;
    readonly bend?: string | undefined;
  };
  readonly passes?: number | undefined;
}

/** How many times the figure is moved over her standing foot, and that foot reached back to where it stood, unless asked otherwise: enough for her legs' turning to settle. */
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
  const planted = Pose.placer(bones, joints, pose)(ask.stance.end);
  if (planted === undefined) {
    return pose;
  }
  let now = pose;
  for (let pass = 0; pass < (ask.passes ?? BALANCE_PASSES); pass++) {
    const centre = Pose.centreOfMass(bones, joints, now);
    if (Option.isNone(centre)) {
      return now;
    }
    const across = { x: planted.at.x - centre.value.x, z: planted.at.z - centre.value.z };
    const placed = Pose.placer(bones, joints, now);
    const hip = placed(ask.stance.root);
    const middle = Option.getOrUndefined(
      Option.flatMap(Option.fromNullishOr(bones[ask.stance.end]), ({ parent }) => parent),
    );
    const knee = middle === undefined ? undefined : placed(middle);
    const foot = placed(ask.stance.end);
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
