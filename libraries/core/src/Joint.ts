import { Option } from 'effect';
import type * as Ray from '#src/Ray.ts';

/**
 * A figure's joints as plain data: how each bone turns on the one above it and how far, as anatomy has it, read from her model's file as the game is built (`?joints`, through `@lightocean/vite-plugin`). A joint swings about one axis, a hinge such as a knee, or two, a saddle such as a wrist or a ball such as a hip, within an elliptic cone of four semi-axes; and may twist about the bone, within a range. A limit may depend on another joint's angle, as a two-joint muscle makes it: the hamstrings let the hip bend less while the knee is straight. A joint may follow another rather than be driven, as the shoulder blade follows the arm. Angles are in radians and axes in the bone's own frame as the model was made; a step and a view read them alike.
 */

/** A joint's axes: bending, the first way it swings; abducting, the second; and twisting, about the bone. */
export type Axis = 'flex' | 'abduct' | 'twist';

/** The least and the most a joint turns about an axis, in radians. */
export type Range = readonly [min: number, max: number];

/** A table to read between, its rows `[x, y]` in order of `x`. */
export type Table = ReadonlyArray<readonly [number, number]>;

/** How a joint swings: about one axis, a hinge; about two, a saddle, which does not twist on its own, or a ball, which does. */
export type Kind = 'Hinge' | 'Saddle' | 'Ball';

/** One end of one of a joint's ranges. */
export interface Limit {
  readonly axis: Axis;
  readonly end: 'min' | 'max';
}

/** A limit that depends on another joint's angle: as `table` reads at the angle of `on`. */
export interface Depends {
  readonly limit: Limit;
  readonly on: { readonly joint: string; readonly axis: Axis };
  readonly table: Table;
}

/** A joint, or one axis of it, that follows another rather than being driven: its axis `sets` turned as `table` reads at the angle of `joint` about `axis`. */
export interface Follows {
  readonly joint: string;
  readonly axis: Axis;
  readonly sets: Axis;
  readonly table: Table;
}

/** The flesh about a bone that bears weight: a capsule along it, `radius` round and `length` long from where it stands, and the mass of the segment, in kilograms. */
export interface Flesh {
  readonly radius: number;
  readonly length: number;
  readonly mass: number;
}

/** A joint: how it swings and twists, about which of the bone's axes, how far, what its limits depend on, what it follows, and the flesh about it. */
export interface Joint {
  readonly kind: Kind;
  readonly axes: {
    readonly flex: Ray.Point;
    readonly abduct: Option.Option<Ray.Point>;
    readonly twist: Option.Option<Ray.Point>;
  };
  readonly swing: { readonly flex: Range; readonly abduct: Option.Option<Range> };
  readonly twist: Option.Option<Range>;
  readonly depends: ReadonlyArray<Depends>;
  readonly follows: Option.Option<Follows>;
  readonly flesh: Option.Option<Flesh>;
}

/** A figure's joints, by the names of their bones. */
export type Joints = Readonly<Record<string, Joint>>;

/** How a joint is turned: about each of its axes, in radians. */
export interface Angles {
  readonly flex: number;
  readonly abduct: number;
  readonly twist: number;
}

/** Each joint's angles, by the names of their bones: a joint not named is as the model was made. */
export type Turns = Readonly<Record<string, Angles>>;

/** Not turned at all. */
export const still: Angles = { flex: 0, abduct: 0, twist: 0 };

/** A joint's limits at some pose: how far it swings each way, and twists, if it does. */
export interface Limits {
  readonly flex: Range;
  readonly abduct: Option.Option<Range>;
  readonly twist: Option.Option<Range>;
}

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

/** The angle of `turns` about `axis` of the joint `joint`; nothing for one not turned. */
export const angleOf = (turns: Turns, joint: string, axis: Axis): number =>
  (turns[joint] ?? still)[axis];

/** `range` with its end `end` set to `value`. */
const withEnd = (range: Range, end: 'min' | 'max', value: number): Range =>
  end === 'min' ? [value, range[1]] : [range[0], value];

/**
 * The limits of the joint `name` of `joints` at `turns`: as it was made, each limit that depends on another joint's angle read from its table at that angle. What is no joint turns no way.
 */
export const limitsAt = (joints: Joints, turns: Turns, name: string): Limits => {
  const joint = joints[name];
  if (joint === undefined) {
    return { flex: [0, 0], abduct: Option.none(), twist: Option.none() };
  }
  return joint.depends.reduce<Limits>(
    (limits, { limit, on, table }) => {
      const value = along(table, angleOf(turns, on.joint, on.axis));
      return limit.axis === 'flex'
        ? { ...limits, flex: withEnd(limits.flex, limit.end, value) }
        : limit.axis === 'abduct'
          ? {
              ...limits,
              abduct: Option.map(limits.abduct, (range) => withEnd(range, limit.end, value)),
            }
          : {
              ...limits,
              twist: Option.map(limits.twist, (range) => withEnd(range, limit.end, value)),
            };
    },
    { flex: joint.swing.flex, abduct: joint.swing.abduct, twist: joint.twist },
  );
};
