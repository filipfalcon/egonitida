import { Option } from 'effect';
import type * as Ray from '#src/Ray.ts';

/**
 * A figure's joints as plain data, as anatomy has them: how each bone turns on the one above it and how far, read from her model's file as the game is built (`?joints`, through `@nitida/vite-plugin`). A joint turns by its motions, each named as anatomy names it, such as a knee's `flex` and `rotate` or an ankle's `dorsiflex`, about an axis in the bone's own frame as made, within a range; its turn is the product of its motions' turns in its `order`, the last turning a direction first, so its axes may be oblique, as anatomical axes often are. Every value is anatomical: nothing is the anatomical position, and `rest` is the value as the model was made. A limit may depend on another joint's motion, as a two-joint muscle makes it, its table giving the bound outright; a motion may follow another joint's motion, or a measure of how a bone lies, such as the arm's elevation the shoulder blade turns up by, its table's value added to the motion's own. Angles are in radians; a step and a view read them alike.
 */

/** How a joint turns: a ball, a hinge, or a saddle, driven; a follower, turned only as it follows; a link of a chain, such as a ponytail's, swung; or free, as a pelvis is, which stands and turns as the whole figure does. */
export type Kind = 'Ball' | 'Hinge' | 'Saddle' | 'Follower' | 'Chain' | 'Free';

/** The least and the most of a motion, in radians. */
export type Range = readonly [min: number, max: number];

/** A table to read between, its rows `[x, y]` in order of `x`, in radians. */
export type Table = ReadonlyArray<readonly [number, number]>;

/** One of a joint's motions: the axis it turns about, of length one, in the bone's own frame as made, positive the way it is named; its range, anatomically; and its value as the model was made. */
export interface Motion {
  readonly axis: Ray.Point;
  readonly range: Range;
  readonly rest: number;
}

/** A motion of a joint, by the joint's bone and the motion's name. */
export interface Of {
  readonly bone: string;
  readonly motion: string;
}

/** A limit that depends on another joint's motion: the end `end` of the motion `motion`, as `table` reads at the value of `on`, outright. */
export interface Depends {
  readonly motion: string;
  readonly end: 'min' | 'max';
  readonly on: Of;
  readonly table: Table;
}

/** A motion that follows: the joint's own motion `motion`, to whose value `table`'s value at `on` is added; `on` a motion of a joint, or a measure of a bone, by its name in place of a motion's. */
export interface Follows {
  readonly motion: string;
  readonly on: Of;
  readonly table: Table;
}

/** A measure of how a bone lies: the angle, from nothing to π, between the bone's own +y and `direction` in the frame of the bone `from`, such as the arm's elevation, down the trunk; and its value as the model was made. */
export interface Measure {
  readonly from: string;
  readonly direction: Ray.Point;
  readonly rest: number;
}

/** The flesh about a bone that bears weight: a capsule from where the bone stands along its own +y, `radius` round and `length` long, and the mass of the segment, in kilograms. */
export interface Flesh {
  readonly radius: number;
  readonly length: number;
  readonly mass: number;
}

/** A joint: how it turns, its motions by name, the order their turns make its turn in, what its limits depend on, what its motions follow, what it measures, and the flesh about it. */
export interface Joint {
  readonly kind: Kind;
  readonly motions: Readonly<Record<string, Motion>>;
  readonly order: ReadonlyArray<string>;
  readonly depends: ReadonlyArray<Depends>;
  readonly follows: ReadonlyArray<Follows>;
  readonly measures: Readonly<Record<string, Measure>>;
  readonly flesh: Option.Option<Flesh>;
}

/** A figure's joints, by the names of their bones. */
export type Joints = Readonly<Record<string, Joint>>;

/** How a joint is turned: each of its motions' values, anatomically, in radians; a motion not named is at its rest, as the model was made. */
export type Angles = Readonly<Record<string, number>>;

/** Each joint's angles, by the names of their bones: a joint not named is as made. */
export type Turns = Readonly<Record<string, Angles>>;

/** A joint's limits at a pose: each motion's range, by name. */
export type Limits = Readonly<Record<string, Range>>;

/** What `table` reads at `x`: between the two rows about it, along the line between them, and as its first or last row beyond its ends; nothing for a table of no rows. */
export const along = (table: Table, x: number): number => {
  const first = table[0];
  const last = table[table.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  if (x <= first[0]) {
    return first[1];
  }
  if (x >= last[0]) {
    return last[1];
  }
  for (let row = 1; row < table.length; row++) {
    const below = table[row - 1];
    const above = table[row];
    if (below !== undefined && above !== undefined && x <= above[0]) {
      const span = above[0] - below[0];
      return span === 0 ? above[1] : below[1] + ((x - below[0]) / span) * (above[1] - below[1]);
    }
  }
  return last[1];
};

/** The value of the motion `motion` of the joint `bone` in `turns`: as named, or its rest; nothing for a motion no joint of `joints` has. */
export const valueOf = (joints: Joints, turns: Turns, { bone, motion }: Of): number =>
  turns[bone]?.[motion] ?? joints[bone]?.motions[motion]?.rest ?? 0;

/**
 * The limits of the joint `name` of `joints` at `turns`: each motion's range as it was made, each bound that depends on another joint's motion read from its table at that motion's value, outright. What is no joint has no motions.
 */
export const limitsAt = (joints: Joints, turns: Turns, name: string): Limits => {
  const joint = joints[name];
  if (joint === undefined) {
    return {};
  }
  const limits: Record<string, Range> = Object.fromEntries(
    Object.entries(joint.motions).map(([motion, { range }]) => [motion, range]),
  );
  for (const { motion, end, on, table } of joint.depends) {
    const range = limits[motion];
    if (range !== undefined) {
      const value = along(table, valueOf(joints, turns, on));
      limits[motion] = end === 'min' ? [value, range[1]] : [range[0], value];
    }
  }
  return limits;
};

/** Whether the joint `name` of `joints` has the motion `motion`. */
export const hasMotion = (joints: Joints, name: string, motion: string): boolean =>
  Option.isSome(Option.fromNullishOr(joints[name]?.motions[motion]));
