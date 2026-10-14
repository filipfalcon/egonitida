import { Option } from 'effect';

/**
 * Rays against boxes square to the axes: how far a ray goes before it enters a box, such as how far a camera behind a player can stand before a wall comes between them, or whether one thing sees another. Plain arithmetic, for a system, a rule, or a view alike.
 *
 * Distances are as far along a ray as its direction is long: in the scene's units, for a direction of length one.
 */

/** A point, or a direction, in the scene's units. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A ray: from `origin`, going `direction`. */
export interface Ray {
  readonly origin: Point;
  readonly direction: Point;
}

/** A box square to the axes, from its least corner `min` to its greatest `max`. */
export interface Box {
  readonly min: Point;
  readonly max: Point;
}

/** Where along one axis a ray is within a box's sides: from `near` to `far`, everywhere for a ray that runs between them, nowhere for one that runs outside them. */
const within = (start: number, step: number, min: number, max: number) => {
  if (step === 0) {
    return start > min && start < max
      ? { near: -Infinity, far: Infinity }
      : { near: Infinity, far: -Infinity };
  }
  const low = (min - start) / step;
  const high = (max - start) / step;
  return { near: Math.min(low, high), far: Math.max(low, high) };
};

/**
 * How far along `ray` it enters `box`, if it does before `reach`: where it first crosses into it through one of its sides. A ray that starts within the box crosses into nothing, and a ray that only runs along a side, or touches an edge, enters nothing.
 */
export const entering = (ray: Ray, box: Box, reach: number): Option.Option<number> => {
  const x = within(ray.origin.x, ray.direction.x, box.min.x, box.max.x);
  const y = within(ray.origin.y, ray.direction.y, box.min.y, box.max.y);
  const z = within(ray.origin.z, ray.direction.z, box.min.z, box.max.z);
  const near = Math.max(x.near, y.near, z.near);
  const far = Math.min(x.far, y.far, z.far);
  return near < far && near >= 0 && near < reach ? Option.some(near) : Option.none();
};

/** How far `ray` goes before it enters any of `boxes`: as far as the nearest it enters, or `reach` where it enters none before it. */
export const reach = (ray: Ray, boxes: Iterable<Box>, reach: number): number => {
  let nearest = reach;
  for (const box of boxes) {
    nearest = Option.getOrElse(entering(ray, box, nearest), () => nearest);
  }
  return nearest;
};

/** A box standing on the ground, as a level lays one out on its floor: from `minX`, `minZ` to `maxX`, `maxZ`, from the ground up to `height`, or as high as there is. */
export const standing = (
  floor: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  },
  height = Infinity,
): Box => ({
  min: { x: floor.minX, y: 0, z: floor.minZ },
  max: { x: floor.maxX, y: height, z: floor.maxZ },
});
