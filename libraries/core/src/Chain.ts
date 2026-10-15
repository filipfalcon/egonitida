import { Option, Schema } from 'effect';
import * as Maths from '#src/Maths.ts';
import type * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * A chain that swings, as plain data, such as a ponytail: points at the bones of a chain hanging from a posed bone, the first tied to it, the rest falling under their weight, trailing as it moves, each link springing back toward how it hung as made by its stiffness and never further from that than its limit. Only a client draws it, so a game keeps it as a local component, stepped by a local system, as a ragdoll is; `Ragdolling` aims the chain's bones at its points. It is stepped in steps of its own, with `Maths`, the same start swinging the same way every time.
 */

/** A point, or a direction, in metres. */
export type Point = Ray.Point;

/** Where the bone a chain hangs from stands and how it is turned, in the model's space, as `Pose.place` places it. */
export type Pin = Pose.Placed;

/** How a chain swings: how fast each link springs back toward how it hung as made, a share of the way each second; how far from that it bends at most, in radians; and how much of its swing it loses each step of its own. */
export interface Options {
  readonly stiffness: number;
  readonly limit: number;
  readonly damping: number;
}

/** How a chain swings, made by `plan`: the names of its points, its bones then the end of its last; where each stood as made, in the frame of the bone it hangs from; how long each link is; and how it swings. */
export interface Plan {
  readonly names: ReadonlyArray<string>;
  readonly made: ReadonlyArray<Point>;
  readonly lengths: ReadonlyArray<number>;
  readonly options: Options;
}

/** A chain swinging: where each of its points is now and was a moment before, three numbers each, in its plan's order. */
export const Body = Schema.Struct({
  now: Schema.Array(Schema.Finite),
  before: Schema.Array(Schema.Finite),
});
export type Body = typeof Body.Type;

/** It swings in steps this long, however long the game's are. */
const SUBSTEP = 1 / 120;
/** How hard everything falls, in metres a second each second. */
const GRAVITY = 9.81;

const plus = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const less = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const times = (a: Point, by: number): Point => ({ x: a.x * by, y: a.y * by, z: a.z * by });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Point) => Maths.hypot(a.x, a.y, a.z);
const unit = (a: Point): Point => {
  const long = length(a);
  return long === 0 ? a : times(a, 1 / long);
};

/** The name of the point at the end of a chain's last bone. */
export const endOf = (last: string) => `${last}_end`;

/**
 * How the chain of the bones `names` of `bones` swings, as `options` say: hanging from the parent of its first bone, a point at each bone where it was made, and one at the end of its last, as far past it as its last link is long.
 */
export const plan = (bones: Shape.Bones, names: ReadonlyArray<string>, options: Options): Plan => {
  const [first] = names;
  const pin = Option.getOrUndefined(
    Option.flatMap(
      Option.fromNullishOr(first === undefined ? undefined : bones[first]),
      ({ parent }) => Option.flatMap(parent, (name) => Option.fromNullishOr(bones[name])),
    ),
  );
  const back = pin === undefined ? Quaternion.identity : Quaternion.invert(pin.turn);
  const from = pin === undefined ? { x: 0, y: 0, z: 0 } : pin.at;
  const at = names.map((name) => bones[name]?.at ?? from);
  const last = at[at.length - 1];
  const beforeLast = at[at.length - 2];
  const end =
    last === undefined
      ? from
      : plus(last, beforeLast === undefined ? { x: 0, y: 0, z: 0 } : less(last, beforeLast));
  const points = [...at, end];
  const lastName = names[names.length - 1];
  return {
    names: [...names, ...(lastName === undefined ? [] : [endOf(lastName)])],
    made: points.map((point) => Quaternion.rotate(back, less(point, from))),
    lengths: points.map((point, index) => {
      const before = points[index - 1];
      return before === undefined ? 0 : length(less(point, before));
    }),
    options,
  };
};

/** Point `index` of `values`. */
const pointOf = (values: ReadonlyArray<number>, index: number): Point => ({
  x: values[index * 3] ?? 0,
  y: values[index * 3 + 1] ?? 0,
  z: values[index * 3 + 2] ?? 0,
});

/** `points` as three numbers each. */
const flattened = (points: ReadonlyArray<Point>) => points.flatMap(({ x, y, z }) => [x, y, z]);

/** Where `plan`'s point `index` hangs as made, `pin` placing the bone it hangs from. */
const madeAt = (plan: Plan, index: number, pin: Pin) =>
  plus(pin.at, Quaternion.rotate(pin.turn, plan.made[index] ?? { x: 0, y: 0, z: 0 }));

/** A chain of `plan` starting to swing, hanging as made from the bone `pin` places, still. */
export const start = (plan: Plan, pin: Pin): Body => {
  const now = flattened(plan.names.map((_, index) => madeAt(plan, index, pin)));
  return { now, before: now };
};

/** Where each point of `body` is, by its name: its bones', and the end of its last. */
export const points = (plan: Plan, body: Body): Readonly<Record<string, Point>> =>
  Object.fromEntries(plan.names.map((name, index) => [name, pointOf(body.now, index)]));

/** `direction`, of length one, turned toward `made`, also of length one, until it is no further from it than `limit`. */
const withinLimit = (direction: Point, made: Point, limit: number): Point => {
  const cosine = Math.min(Math.max(dot(direction, made), -1), 1);
  if (Maths.acos(cosine) <= limit) {
    return direction;
  }
  const aside = less(direction, times(made, cosine));
  const across = length(aside) === 0 ? { x: made.y, y: -made.x, z: 0 } : unit(aside);
  return plus(times(made, Maths.cos(limit)), times(unit(across), Maths.sin(limit)));
};

/** `body` after one step of its own of `seconds`, hanging from the bone `pin` places. */
const swungOnce = (plan: Plan, body: Body, seconds: number, pin: Pin): Body => {
  const { stiffness, limit, damping } = plan.options;
  const keep = Math.max(1 - damping, 0);
  const fall = GRAVITY * seconds * seconds;
  const now: Array<Point> = [];
  const before: Array<Point> = [];
  plan.names.forEach((_, index) => {
    const was = pointOf(body.now, index);
    const earlier = pointOf(body.before, index);
    before.push(was);
    if (index === 0) {
      // Tied to the bone it hangs from.
      now.push(madeAt(plan, 0, pin));
      return;
    }
    const moved = plus(was, times(less(was, earlier), keep));
    const fallen = { ...moved, y: moved.y - fall };
    const above = now[index - 1] ?? fallen;
    const made = unit(less(madeAt(plan, index, pin), madeAt(plan, index - 1, pin)));
    // Sprung back toward how it hung as made, kept within its limit of it, and held at its length.
    const sprung = plus(
      fallen,
      times(
        less(plus(above, times(made, plan.lengths[index] ?? 0)), fallen),
        Math.min(stiffness * seconds, 1),
      ),
    );
    const way = withinLimit(unit(less(sprung, above)), made, limit);
    now.push(plus(above, times(way, plan.lengths[index] ?? 0)));
  });
  return { now: flattened(now), before: flattened(before) };
};

/**
 * `body` of `plan` after `seconds` of swinging, in steps of its own however long the game's are, hanging from the bone `pin` places now: its first point tied to that bone, the rest falling under their weight and trailing as it moves, losing a little of their swing each step, each link sprung back toward how it hung as made by its stiffness, kept within its limit of that, and held at its length.
 */
export const step = (plan: Plan, body: Body, seconds: number, pin: Pin): Body => {
  const steps = Math.max(Math.round(seconds / SUBSTEP), 1);
  let now = body;
  for (let at = 0; at < steps; at++) {
    now = swungOnce(plan, now, seconds / steps, pin);
  }
  return now;
};
