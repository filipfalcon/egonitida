import { Data, Effect } from 'effect';
import * as Three from 'three/webgpu';

/**
 * A model reshaped as a game's dials say, such as a figure's hips made wider or her cheeks fuller, by the morph targets whoever made the model put in it. The game names its dials and what each turns in the model, since only it knows the model; `fit` finds them in a model as it is delivered, or refuses it, naming what it lacks; and the model is then shaped from the dials' values alone, every frame, as a view draws it, y = h(x): the same values give the same shape, however it was shaped before.
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

/** What a dial turns in a model. */
export type Dial = Morph | Opposed;

/** A game's dials, each by the name the game gives it. */
export type Dials = Readonly<Record<string, Dial>>;

/** How a model is shaped: a game's dials, made by `make`. */
export interface Shaping<D extends Dials> {
  readonly dials: D;
}

/** A value for each of the dials `D`, such as a component of the game holds them. */
export type Values<D extends Dials> = { readonly [Name in keyof D]: number };

/** The model has no mesh carrying a morph target a dial turns: each such target, by name, in the order of the dials. */
export class Unfitted extends Data.TaggedError('Unfitted')<{
  readonly absent: ReadonlyArray<string>;
}> {}

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

/** How a model is shaped by `dials`. */
export const make = <const D extends Dials>(dials: D): Shaping<D> => ({ dials });

/** Which part of a dial's value a morph target is weighted by: all of it, only above nothing, or only below. */
type Side = 'Whole' | 'More' | 'Less';

/** One morph target of one mesh, turned by the dial named `dial`. */
interface Turn {
  readonly dial: string;
  readonly side: Side;
  readonly influences: Array<number>;
  readonly index: number;
}

/** How far a target on `side` is weighted by a dial at `value`. */
const weightOf = (side: Side, value: number) =>
  side === 'Whole' ? value : side === 'More' ? Math.max(value, 0) : Math.max(-value, 0);

/**
 * A model fitted to a game's dials, made by `fit`: the model within it, and `shape`, which shapes it by the dials' values. It stands for the model in the scene, so a view places it as it would the model.
 */
export class Shaped<D extends Dials> extends Three.Group {
  readonly model: Three.Object3D;
  readonly #turns: ReadonlyArray<Turn>;

  constructor(model: Three.Object3D, turns: ReadonlyArray<Turn>) {
    super();
    this.model = model;
    this.#turns = turns;
    this.add(model);
  }

  /** Shapes the model as `values` say: every morph target a dial turns, on every mesh that carries it, weighted by the dial's value alone. Allocates nothing. */
  shape(values: Values<D>): void {
    const read: Readonly<Record<string, number>> = values;
    for (const turn of this.#turns) {
      const value = read[turn.dial];
      if (value !== undefined) {
        turn.influences[turn.index] = weightOf(turn.side, value);
      }
    }
  }
}

/** The targets a dial turns, each with the part of its value it is weighted by. */
const targetsOf = (dial: Dial): ReadonlyArray<readonly [string, Side]> =>
  dial._tag === 'Morph'
    ? [[dial.target, 'Whole']]
    : [
        [dial.less, 'Less'],
        [dial.more, 'More'],
      ];

/**
 * `model` fitted to `shaping`: every morph target a dial turns, found on every mesh of the model that carries it, as the model holds its meshes now. Fails with `Unfitted` if no mesh carries one of them.
 */
export const fit = <D extends Dials>(
  model: Three.Object3D,
  shaping: Shaping<D>,
): Effect.Effect<Shaped<D>, Unfitted> =>
  Effect.suspend(() => {
    const meshes: Array<Three.Mesh> = [];
    model.traverse((child) => {
      if (child instanceof Three.Mesh) {
        meshes.push(child);
      }
    });
    const turns: Array<Turn> = [];
    const absent: Array<string> = [];
    for (const [dial, turned] of Object.entries(shaping.dials)) {
      for (const [target, side] of targetsOf(turned)) {
        const found = meshes.flatMap((mesh) => {
          const index = mesh.morphTargetDictionary?.[target];
          const influences = mesh.morphTargetInfluences;
          return index === undefined || influences === undefined
            ? []
            : [{ dial, side, influences, index }];
        });
        if (found.length === 0) {
          absent.push(target);
        }
        turns.push(...found);
      }
    }
    return absent.length > 0
      ? Effect.fail(new Unfitted({ absent }))
      : Effect.succeed(new Shaped<D>(model, turns));
  });
