import { Option } from 'effect';
import type * as Joint from '#src/Joint.ts';
import * as Maths from '#src/Maths.ts';
import * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * Touches between a posed figure and a sphere, such as a ball: which part of her touches it, where, along which normal, and how fast that part moves there, from the pose before and the pose now. Her parts are her touch points, named spheres on her bones such as an instep or a heel, and the flesh about her bones, capsules along them; the way between the two poses is swept in a fixed number of steps, the touch found first, so a foot swung through a ball in one step still touches it. Plain arithmetic with `Maths`, for a system, alike on every host.
 */

/** A part of a figure a sphere may touch: a sphere on the bone `bone`, `radius` round, at `at` in the bone's own frame, its surface facing `normal` there. */
export interface Point {
  readonly bone: string;
  readonly at: Ray.Point;
  readonly radius: number;
  readonly normal: Ray.Point;
}

/** A figure's touch points, by the name of the part, such as `instep_l`. */
export type Touches = Readonly<Record<string, Point>>;

/** A sphere: where its centre is, and how round it is. */
export interface Sphere {
  readonly at: Ray.Point;
  readonly radius: number;
}

/** A touch: the part that touched, a touch point's name or the name of the bone whose flesh did; the point on her where it did, in the model's space; the way from her to the sphere's centre there; the way her surface faces there; and how fast that point of her moves, in metres a second. */
export interface Touched {
  readonly part: string;
  readonly point: Ray.Point;
  readonly normal: Ray.Point;
  readonly facing: Ray.Point;
  readonly velocity: Ray.Point;
}

/** How many steps the way from the pose before to the pose now is swept in: enough that a foot swung as fast as a kick moves less than a ball's width between two. */
const SWEEP = 8;

const less = (a: Ray.Point, b: Ray.Point): Ray.Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const plus = (a: Ray.Point, b: Ray.Point): Ray.Point => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const times = (a: Ray.Point, by: number): Ray.Point => ({ x: a.x * by, y: a.y * by, z: a.z * by });
const dot = (a: Ray.Point, b: Ray.Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Ray.Point) => Maths.hypot(a.x, a.y, a.z);

/** A part found touching: what, where on her, along which normal, which way her surface faces, how deep, and the point in its bone's own frame. */
interface Found {
  readonly part: string;
  readonly bone: string;
  readonly point: Ray.Point;
  readonly normal: Ray.Point;
  readonly facing: Ray.Point;
  readonly depth: number;
  readonly local: Ray.Point;
}

/** The way from `from` toward `to`, of length one; up, if they are one point. */
const wayFrom = (from: Ray.Point, to: Ray.Point): Ray.Point => {
  const way = less(to, from);
  const long = length(way);
  return long === 0 ? { x: 0, y: 1, z: 0 } : times(way, 1 / long);
};

/** Every part of the figure placed as `placed` places it that touches `sphere`: its touch points, then the flesh about its bones. */
const touching = (
  placed: Readonly<Record<string, Pose.Placed>>,
  joints: Joint.Joints,
  touches: Touches,
  sphere: Sphere,
): ReadonlyArray<Found> => {
  const found: Array<Found> = [];
  for (const [part, point] of Object.entries(touches)) {
    const on = placed[point.bone];
    if (on === undefined) {
      continue;
    }
    const centre = plus(on.at, Quaternion.rotate(on.turn, point.at));
    const depth = point.radius + sphere.radius - length(less(sphere.at, centre));
    if (depth >= 0) {
      const normal = wayFrom(centre, sphere.at);
      const at = plus(centre, times(normal, point.radius));
      found.push({
        part,
        bone: point.bone,
        point: at,
        normal,
        facing: Quaternion.rotate(on.turn, point.normal),
        depth,
        local: Quaternion.rotate(Quaternion.invert(on.turn), less(at, on.at)),
      });
    }
  }
  for (const [name, joint] of Object.entries(joints)) {
    const on = placed[name];
    if (on === undefined || Option.isNone(joint.flesh)) {
      continue;
    }
    const { radius, length: long } = joint.flesh.value;
    // The capsule's axis, from where the bone stands along its own +y; the point of it nearest the sphere.
    const end = plus(on.at, Quaternion.rotate(on.turn, { x: 0, y: long, z: 0 }));
    const axis = less(end, on.at);
    const span = dot(axis, axis);
    const t = span === 0 ? 0 : Math.min(Math.max(dot(less(sphere.at, on.at), axis) / span, 0), 1);
    const nearest = plus(on.at, times(axis, t));
    const depth = radius + sphere.radius - length(less(sphere.at, nearest));
    if (depth >= 0) {
      const normal = wayFrom(nearest, sphere.at);
      const at = plus(nearest, times(normal, radius));
      found.push({
        part: name,
        bone: name,
        point: at,
        normal,
        facing: normal,
        depth,
        local: Quaternion.rotate(Quaternion.invert(on.turn), less(at, on.at)),
      });
    }
  }
  return found;
};

/**
 * What of the figure `bones` and `joints` make touches `sphere`, moving from `before` to `now` over `seconds`: the way between the two poses swept in a fixed number of steps, going between them on their turns, and at the first step anything touches, the deepest part, touch points before flesh where they are as deep; with the point of her that touched, the normal, the way her surface faces, and how fast that point moves, from where it was before to where it is now. Nothing, if nothing of her touches it.
 */
export const of = (
  bones: Shape.Bones,
  joints: Joint.Joints,
  touches: Touches,
  before: Pose.Pose,
  now: Pose.Pose,
  sphere: Sphere,
  seconds: number,
): Option.Option<Touched> => {
  for (let step = 1; step <= SWEEP; step++) {
    const pose = step === SWEEP ? now : Pose.between(joints, before, now, step / SWEEP);
    const found = touching(Pose.place(bones, joints, pose), joints, touches, sphere);
    const [deepest] = [...found].sort((a, b) => b.depth - a.depth);
    if (deepest !== undefined) {
      // Where that point of her was, and is, carried by its bone.
      const was = Pose.place(bones, joints, before)[deepest.bone];
      const is = Pose.place(bones, joints, now)[deepest.bone];
      const velocity =
        was === undefined || is === undefined || seconds <= 0
          ? { x: 0, y: 0, z: 0 }
          : times(
              less(
                plus(is.at, Quaternion.rotate(is.turn, deepest.local)),
                plus(was.at, Quaternion.rotate(was.turn, deepest.local)),
              ),
              1 / seconds,
            );
      return Option.some({
        part: deepest.part,
        point: deepest.point,
        normal: deepest.normal,
        facing: deepest.facing,
        velocity,
      });
    }
  }
  return Option.none();
};
