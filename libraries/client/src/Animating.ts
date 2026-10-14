import { Data, Effect, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import * as Shaping from '#src/Shaping.ts';

/**
 * A model posed by its animation clips as a game's values say, such as a figure walking, as far through her stride as the state says, and reloading, as long as she has been: every frame, as a view draws it, each clip is set to where it is and how much it weighs, y = h(x), never played on by the time between frames, so the same values give the same pose, however it was posed before, and going back in a game, or replaying it, poses it as it was. The game names its clips and how each is taken, since only it knows its model and its clips; `fit` finds them in the clips delivered with a model, and the bones they move in the model, or refuses it, naming what it lacks.
 */

/** Which of a model's bones a clip moves: every bone from each of `from` down, but none from each of `without` down; all of them, where it names none. */
export interface Bones {
  readonly from?: ReadonlyArray<string> | undefined;
  readonly without?: ReadonlyArray<string> | undefined;
}

/** How a clip is taken, beside which bones it moves: `additive`, added to what the others pose by how far it moved from its start, such as a breath over any stance; otherwise blended with them by its weight. */
export interface Taken extends Bones {
  readonly additive?: boolean | undefined;
}

/** A clip that goes round, such as a stride or an idle: posed as far through it as a share of it, 0 at its start and 1 at its end, round again past it. */
export interface Cycle {
  readonly _tag: 'Cycle';
  readonly clip: string;
  readonly taken: Taken;
}

/** A clip that happens once, such as a reload or a hit: posed as many seconds into it as given, held at its start before it and at its end after. */
export interface Once {
  readonly _tag: 'Once';
  readonly clip: string;
  readonly taken: Taken;
}

/** How a game takes one of its clips. */
export type Clip = Cycle | Once;

/** A game's clips, each by the name the game gives it. */
export type Clips = Readonly<Record<string, Clip>>;

/** How a model is animated: a game's clips, made by `make`. */
export interface Animating<C extends Clips> {
  readonly clips: C;
}

/** Where a clip is, as a share of a cycle or seconds into what happens once, and how much it weighs, from nothing to a whole. */
export interface At {
  readonly at: number;
  readonly weight: number;
}

/** Where each of the clips `C` is, such as a game's state says. */
export type Values<C extends Clips> = { readonly [Name in keyof C]: At };

/** The model lacks a clip, or a bone a clip moves or is given: each one absent, by name, in the order of the game's clips. */
export class Unfitted extends Data.TaggedError('Unfitted')<{
  readonly absent: ReadonlyArray<string>;
}> {}

/** A clip `clip` that goes round, moving the bones `taken` gives, blended or added. */
export const cycle = (clip: string, taken: Taken = {}): Cycle => ({ _tag: 'Cycle', clip, taken });

/** A clip `clip` that happens once, moving the bones `taken` gives, blended or added. */
export const once = (clip: string, taken: Taken = {}): Once => ({ _tag: 'Once', clip, taken });

/** How a model is animated by `clips`. */
export const make = <const C extends Clips>(clips: C): Animating<C> => ({ clips });

/** One of a game's clips as fitted: its name, how it is taken, and the action posing it. */
interface Fitted {
  readonly name: string;
  readonly clip: Clip;
  readonly action: Three.AnimationAction;
  readonly duration: number;
}

/** A bone of a shaped model a clip moves, and where the mixer last put it, before the shaping drew it out. */
interface Moved {
  readonly bone: Three.Object3D;
  readonly posed: Three.Vector3;
}

/** The names of the bones `bones` gives of `model`, or the absent bones it names. */
const bonesOf = (model: Three.Object3D, bones: Bones) => {
  const absent = [...(bones.from ?? []), ...(bones.without ?? [])].filter(
    (name) => model.getObjectByName(name) === undefined,
  );
  const below = (names: ReadonlyArray<string>) => {
    const found = new Set<string>();
    for (const name of names) {
      model.getObjectByName(name)?.traverse((child) => {
        found.add(child.name);
      });
    }
    return found;
  };
  const left = below(bones.without ?? []);
  const kept = bones.from === undefined ? undefined : below(bones.from);
  return {
    absent,
    moves: (name: string) => !left.has(name) && (kept === undefined || kept.has(name)),
  };
};

/** `clip` with only the tracks of the bones `moves` keeps, made additive by how far each moved from its start if `additive`. */
const takenOf = (
  clip: Three.AnimationClip,
  moves: (name: string) => boolean,
  additive: boolean,
) => {
  const taken = new Three.AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks
      .filter((track) => moves(Three.PropertyBinding.parseTrackName(track.name).nodeName))
      .map((track) => track.clone()),
  );
  return additive ? Three.AnimationUtils.makeClipAdditive(taken) : taken;
};

/**
 * A model posed by its clips, made by `fit`: the model within it, and `pose`, which poses it by where each clip is and how much it weighs. It stands for the model in the scene, so a view places it as it would the model; a model `Shaping` shaped is animated as its `Shaped`.
 */
export class Animated<C extends Clips> extends Three.Group {
  readonly model: Three.Object3D;
  readonly #mixer: Three.AnimationMixer;
  readonly #fitted: ReadonlyArray<Fitted>;
  readonly #moved: ReadonlyArray<Moved>;

  constructor(
    model: Three.Object3D,
    mixer: Three.AnimationMixer,
    fitted: ReadonlyArray<Fitted>,
    moved: ReadonlyArray<Moved>,
  ) {
    super();
    this.model = model;
    this.#mixer = mixer;
    this.#fitted = fitted;
    this.#moved = moved;
    this.add(model);
  }

  /**
   * Poses the model as `values` say: each clip where its value puts it, a cycle as far through it as its share, round past its end, and what happens once as many seconds into it as given, held at its start and its end, each weighing as much as its value says. Where the clips weigh less than a whole, the model stands as it was made for the rest. A model `Shaping` shaped has each bone a clip moves moved as far as the shaping draws it out, so a figure whose legs are longer crouches and walks with her feet on the ground; shape it before posing it.
   */
  pose(values: Values<C>): void {
    const read: Readonly<Record<string, At>> = values;
    for (const { name, clip, action, duration } of this.#fitted) {
      const at = read[name];
      if (at === undefined) {
        continue;
      }
      action.time =
        clip._tag === 'Cycle'
          ? (((at.at % 1) + 1) % 1) * duration
          : Math.min(Math.max(at.at, 0), duration);
      action.setEffectiveWeight(Math.min(Math.max(at.weight, 0), 1));
    }
    const { model } = this;
    // The mixer puts a bone only where it did not last put it, so each starts where it last put it.
    for (const { bone, posed } of this.#moved) {
      bone.position.copy(posed);
    }
    // No time passes: every clip is posed where it was just put.
    this.#mixer.update(0);
    if (model instanceof Shaping.Shaped) {
      for (const { bone, posed } of this.#moved) {
        posed.copy(bone.position);
        bone.position.multiplyScalar(model.stretchOf(bone));
      }
    }
  }
}

/**
 * `model` fitted to `animating`: every clip the game names found among `clips`, delivered with the model, as a glTF file delivers them beside its scene, and every bone those clips move, and every bone a clip is given, found in the model. Fails with `Unfitted` if a clip is not among `clips`, or a bone not in the model. The model is posed by a mixer of its own, so copies of one loaded model, sharing its clips, are each posed on their own; the scope lets go of it once it closes. A model `Shaping` shaped is fitted as its `Shaped`, and posed as it is shaped.
 */
export const fit = <C extends Clips>(
  model: Three.Object3D,
  clips: ReadonlyArray<Three.AnimationClip>,
  animating: Animating<C>,
): Effect.Effect<Animated<C>, Unfitted, Scope.Scope> =>
  Effect.gen(function* () {
    const absent: Array<string> = [];
    const taken: Array<{ name: string; clip: Clip; taken: Three.AnimationClip }> = [];
    for (const [name, clip] of Object.entries(animating.clips)) {
      const delivered = clips.find((found) => found.name === clip.clip);
      if (delivered === undefined) {
        absent.push(clip.clip);
        continue;
      }
      for (const track of delivered.tracks) {
        const { nodeName } = Three.PropertyBinding.parseTrackName(track.name);
        if (model.getObjectByName(nodeName) === undefined && !absent.includes(nodeName)) {
          absent.push(nodeName);
        }
      }
      const bones = bonesOf(model, clip.taken);
      absent.push(...bones.absent.filter((bone) => !absent.includes(bone)));
      taken.push({
        name,
        clip,
        taken: takenOf(delivered, bones.moves, clip.taken.additive === true),
      });
    }
    if (absent.length > 0) {
      return yield* new Unfitted({ absent });
    }
    const mixer = yield* Effect.acquireRelease(
      Effect.sync(() => new Three.AnimationMixer(model)),
      (released) =>
        Effect.sync(() => {
          released.stopAllAction();
          released.uncacheRoot(model);
        }),
    );
    const bind = () =>
      taken.map(({ name, clip, taken: posing }) => {
        const action = mixer.clipAction(posing);
        if (clip.taken.additive === true) {
          action.blendMode = Three.AdditiveAnimationBlendMode;
        }
        action.setEffectiveWeight(0);
        action.play();
        return { name, clip, action, duration: posing.duration };
      });
    if (!(model instanceof Shaping.Shaped)) {
      return new Animated<C>(model, mixer, bind(), []);
    }
    const bones = new Set<Three.Object3D>();
    for (const { taken: posing } of taken) {
      for (const track of posing.tracks) {
        const { nodeName, propertyName } = Three.PropertyBinding.parseTrackName(track.name);
        const bone = model.getObjectByName(nodeName);
        if (propertyName === 'position' && bone !== undefined) {
          bones.add(bone);
        }
      }
    }
    // A mixer blends a clip with what it binds to as it finds it, and starts there: the model as it was made.
    const [fitted, moved] = model.asMade(() => [
      bind(),
      [...bones].map((bone) => ({ bone, posed: bone.position.clone() })),
    ]);
    return new Animated<C>(model, mixer, fitted, moved);
  });
