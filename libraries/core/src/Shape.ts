import { Option } from 'effect';
import * as Maths from '#src/Maths.ts';
import type * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';

/**
 * How a figure is shaped by a game's dials, as plain data: what each dial turns, a morph target its model carries or bones it draws out or grows, and where those bones then stand. The game names its dials, since only it knows its figures, and its state holds their values; `Shaping` reshapes the model by them as a view draws it, and `standing` works out where its bones stand by them in a step, from its bones as the model was made, so what the simulation does with a figure, such as letting her fall, is as long as she is drawn.
 */

/** A dial that turns one morph target, as far as its value: the target's weight is the value. */
export interface Morph {
  readonly _tag: 'Morph';
  readonly target: string;
}

/** A dial that turns one of two opposed morph targets, such as narrower hips and wider ones: `more` as far as a value above nothing, `less` as far as one below it, and neither at nothing. */
export interface Opposed {
  readonly _tag: 'Opposed';
  readonly less: string;
  readonly more: string;
}

/**
 * A dial that lengthens bones, such as a figure's shins: each bone's offset from its parent bone is drawn out by `by` for every whole of the value, and in as far below nothing, and the skin each holds goes with it. Only where the model rests is lengthened, so animations that turn its bones, never moving them, play on it as before; a bone with no parent bone has no offset to draw out, and is left as it is.
 *
 * A dial that `raises` a bone, such as legs raising the pelvis, draws that bone's offset out too, by as much as the longest way down through the bones it lengthens beneath it grew, so a figure standing on the ground as made stands on it with her legs longer or shorter.
 */
export interface Lengthen {
  readonly _tag: 'Lengthen';
  readonly bones: ReadonlyArray<string>;
  readonly by: number;
  readonly raises: Option.Option<string>;
}

/**
 * A dial that grows bones whole, such as a figure's head: each bone, and everything below it, is made bigger by `by` for every whole of the value, and smaller below nothing, from where it stands, and the skin each holds goes with it. Only where the model rests is grown, so animations that turn its bones play on it as before; a bone with no parent bone is left as it is.
 */
export interface Grow {
  readonly _tag: 'Grow';
  readonly bones: ReadonlyArray<string>;
  readonly by: number;
}

/** What a dial turns in a figure. */
export type Dial = Morph | Opposed | Lengthen | Grow;

/** A game's dials, each by the name the game gives it. */
export type Dials = Readonly<Record<string, Dial>>;

/** How a figure is shaped: a game's dials, made by `make`. */
export interface Shape<D extends Dials> {
  readonly dials: D;
}

/** A value for each of the dials `D`, such as a component of the game holds them. */
export type Values<D extends Dials> = { readonly [Name in keyof D]: number };

/** A bone of a figure as its model was made: the bone above it, if any, where it stands, and how it is turned, in the model's space. */
export interface Bone {
  readonly parent: Option.Option<string>;
  readonly at: Ray.Point;
  readonly turn: Quaternion.Quaternion;
}

/** A figure's bones as its model was made, by name, such as `@lightocean/vite-plugin` reads them from a model's file. */
export type Bones = Readonly<Record<string, Bone>>;

/** A dial turning the morph target `target`, or one of the two opposed targets `less` and `more`. */
export function morph(target: string): Morph;
export function morph(targets: { readonly less: string; readonly more: string }): Opposed;
export function morph(
  targets: string | { readonly less: string; readonly more: string },
): Morph | Opposed {
  return typeof targets === 'string'
    ? { _tag: 'Morph', target: targets }
    : { _tag: 'Opposed', less: targets.less, more: targets.more };
}

/** A dial lengthening `bones`, each by `by` of its offset from its parent for every whole of the value, and raising the bone `raises`, if given, by as much as they grew beneath it. */
export const lengthen = (
  bones: ReadonlyArray<string>,
  options: { readonly by: number; readonly raises?: string | undefined },
): Lengthen => ({
  _tag: 'Lengthen',
  bones,
  by: options.by,
  raises: Option.fromNullishOr(options.raises),
});

/** A dial growing `bones` whole, each by `by` of itself for every whole of the value. */
export const grow = (bones: ReadonlyArray<string>, options: { readonly by: number }): Grow => ({
  _tag: 'Grow',
  bones,
  by: options.by,
});

/** How a figure is shaped by `dials`. */
export const make = <const D extends Dials>(dials: D): Shape<D> => ({ dials });

/** A dial turning one part of an MPFB figure slimmer below nothing and fuller above it, by its two shape keys, as MakeHuman names them. */
const fuller = <const Part extends string>(part: Part) =>
  morph({ less: `${part}-decr`, more: `${part}-incr` });

/**
 * The dials of a figure made with MPFB, MakeHuman's Blender add-on, exported with its shape keys and its `game_engine` rig: her hips, bust, waist, stomach, buttocks, thighs, calves, arms, cheeks, chin, jaw, and nose each slimmer or fuller by its `-decr` and `-incr` keys; her legs, arms, and torso each lengthened by `by` of themselves for every whole of the value, her legs raising her pelvis, so she stands on the ground. A game shapes such a figure by them, its component's fields named as they are, and adds its own beside them, such as a head that grows.
 */
export const mpfb = (options: { readonly by: number }) =>
  make({
    hips: fuller('hips'),
    bust: fuller('bust'),
    waist: fuller('waist'),
    stomach: fuller('stomach'),
    buttocks: fuller('buttocks'),
    thighs: fuller('thighs'),
    calves: fuller('calves'),
    arms: fuller('arms'),
    cheeks: fuller('cheeks'),
    chin: fuller('chin'),
    jaw: fuller('jaw'),
    nose: fuller('nose'),
    legLength: lengthen(['calf_l', 'foot_l', 'calf_r', 'foot_r'], {
      by: options.by,
      raises: 'pelvis',
    }),
    armLength: lengthen(['lowerarm_l', 'hand_l', 'lowerarm_r', 'hand_r'], { by: options.by }),
    torsoLength: lengthen(['spine_02', 'spine_03', 'neck_01'], { by: options.by }),
  });

/** How far apart `a` and `b` are. */
const apart = (a: Ray.Point, b: Ray.Point) => Maths.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** How long the offset of the bone `name` of `bones` from its parent was made: nothing for a bone with no parent, or none at all. */
const offsetOf = (bones: Bones, name: string) => {
  const bone = bones[name];
  const parent = bone === undefined ? undefined : Option.getOrUndefined(bone.parent);
  const above = parent === undefined ? undefined : bones[parent];
  return bone === undefined || above === undefined ? 0 : apart(bone.at, above.at);
};

/** How long the longest way down from `raised` through `lengthened` was made: along each way, every bone of them its offset from its parent long, and every other nothing. */
const beneath = (bones: Bones, raised: string, lengthened: ReadonlyArray<string>) => {
  let longest = 0;
  for (const from of lengthened) {
    let along = 0;
    let at: string | undefined = from;
    while (at !== undefined && at !== raised) {
      along += lengthened.includes(at) ? offsetOf(bones, at) : 0;
      const bone: Bone | undefined = bones[at];
      at = bone === undefined ? undefined : Option.getOrUndefined(bone.parent);
    }
    if (at === raised) {
      longest = Math.max(longest, along);
    }
  }
  return longest;
};

/**
 * Where each of `bones` stands, the figure shaped by `shape` as `values` say, in the model's space: each bone's offset from its parent drawn out as far as the dials lengthening it, or raising it, draw it, and grown as far as the dials growing the bones above it grow them, every bone below carried along; a bone with no parent stands where it was made. Morph targets move no bone, and a bone a dial names that `bones` lacks is passed over. It places the bones as `Shaping` rests them on the model, so a simulation stands a figure as long as a view draws her.
 */
export const standing = <D extends Dials>(
  shape: Shape<D>,
  bones: Bones,
  values: Values<D>,
): Readonly<Record<string, Ray.Point>> => {
  const read: Readonly<Record<string, number>> = values;
  const stretch = new Map<string, number>();
  const growth = new Map<string, number>();
  const times = (by: Map<string, number>, name: string, factor: number) =>
    by.set(name, (by.get(name) ?? 1) * factor);
  for (const [name, dial] of Object.entries(shape.dials)) {
    const value = read[name] ?? 0;
    if (dial._tag === 'Grow') {
      for (const bone of dial.bones) {
        times(growth, bone, 1 + value * dial.by);
      }
    }
    if (dial._tag === 'Lengthen') {
      for (const bone of dial.bones) {
        times(stretch, bone, 1 + value * dial.by);
      }
      Option.map(dial.raises, (raised) => {
        const made = offsetOf(bones, raised);
        if (made > 0) {
          times(stretch, raised, 1 + (value * dial.by * beneath(bones, raised, dial.bones)) / made);
        }
      });
    }
  }
  // Each bone placed from its parent's place, and how much the bones above it grew it, parents first.
  const placed = new Map<string, { readonly at: Ray.Point; readonly grown: number }>();
  const place = (name: string, bone: Bone): { readonly at: Ray.Point; readonly grown: number } => {
    const known = placed.get(name);
    if (known !== undefined) {
      return known;
    }
    const parent = Option.flatMap(bone.parent, (above) =>
      Option.map(Option.fromNullishOr(bones[above]), (made) => ({ name: above, made })),
    );
    const now = Option.match(parent, {
      onNone: () => ({ at: bone.at, grown: 1 }),
      onSome: ({ name: above, made }) => {
        const from = place(above, made);
        const drawn = (stretch.get(name) ?? 1) * from.grown;
        return {
          at: {
            x: from.at.x + (bone.at.x - made.at.x) * drawn,
            y: from.at.y + (bone.at.y - made.at.y) * drawn,
            z: from.at.z + (bone.at.z - made.at.z) * drawn,
          },
          grown: from.grown * (growth.get(name) ?? 1),
        };
      },
    });
    placed.set(name, now);
    return now;
  };
  return Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, place(name, bone).at]),
  );
};

/** `bones` shaped by `shape` as `values` say: each standing where `standing` stands it, turned as it was made. */
export const shaped = <D extends Dials>(
  shape: Shape<D>,
  bones: Bones,
  values: Values<D>,
): Bones => {
  const placed = standing(shape, bones, values);
  return Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, { ...bone, at: placed[name] ?? bone.at }]),
  );
};
