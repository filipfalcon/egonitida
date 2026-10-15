import { Joint, Pose, type Quaternion } from '@lightocean/core';
import { Data, Effect, Option } from 'effect';
import * as Three from 'three/webgpu';

/**
 * A model posed by a figure's pose, as the game works it out, y = h(x): each bone of a joint turned from how it was made by the joint's angles, the bones with no parent bone placed and turned as the whole figure is, and each corrective shape a mesh names weighed by how far its joint turns, so a bent knee keeps its crease. Only how bones turn changes, and where the topmost stand, so a model `Shaping` shaped is posed as she is shaped. It poses the model every frame, after `Animating`, over what that posed by a weight, for a bone and all below it, so a game poses her legs by reaching and her arms by a clip. It is the drawing's twin of `Pose.place`: a bone is drawn where that places it.
 */

/** A corrective shape a mesh names in its extras (`userData.correctives`): its morph target, weighed from nothing at `from` degrees of the joint's turn about `axis` to whole at `full`. */
export interface Corrective {
  readonly target: string;
  readonly joint: string;
  readonly axis: Joint.Axis;
  readonly from: number;
  readonly full: number;
}

/** The model has no bone a joint turns, or no morph target or joint a corrective shape names: each one absent, by name. */
export class Unfitted extends Data.TaggedError('Unfitted')<{
  readonly absent: ReadonlyArray<string>;
}> {}

/** How much of a pose each bone takes, by the name of a bone it applies to, with all below it, unless a bone below is named too: a whole for any bone none names above it. */
export type Weights = Readonly<Record<string, number>>;

/** One bone a joint turns, or one with no parent bone, as fitted. */
interface Fitted {
  readonly bone: Three.Bone;
  readonly name: string;
  readonly joint: Option.Option<Joint.Joint>;
  /** Whether it has no parent bone, so it is placed as the whole figure is. */
  readonly root: boolean;
  /** How it was turned and where it stood, from its parent, as made. */
  readonly madeTurn: Three.Quaternion;
  readonly madeAt: Three.Vector3;
  /** What `pose` last turned it to and placed it at, to tell whether anything posed it since. */
  readonly wrote: { turn: Three.Quaternion; at: Three.Vector3; written: boolean };
}

/** One corrective shape as fitted: the weights it sets, and where. */
interface Fix {
  readonly corrective: Corrective;
  readonly influences: Array<number>;
  readonly index: number;
}

const own = new Three.Quaternion();
const turned = new Three.Quaternion();
const toModel = new Three.Matrix4();
const fromModel = new Three.Matrix4();
const placing = new Three.Matrix4();
const at = new Three.Vector3();
const scale = new Three.Vector3();
const figureTurn = new Three.Quaternion();
const figureAt = new Three.Vector3();

/** `q` as Three.js's quaternion, into `out`. */
const asThree = (out: Three.Quaternion, q: Quaternion.Quaternion) => out.set(q.x, q.y, q.z, q.w);

/** How much of a pose the bone `bone` takes by `weights`: what the nearest bone at or above it they name says, or a whole. */
const weightOf = (bone: Three.Object3D, weights: Weights) => {
  for (let at: Three.Object3D | null = bone; at !== null; at = at.parent) {
    const weight = weights[at.name];
    if (weight !== undefined) {
      return weight;
    }
  }
  return 1;
};

/**
 * A model posed by a pose, made by `fit`: the model, and `pose`, which poses it.
 */
export class Posed {
  readonly model: Three.Object3D;
  readonly #fitted: ReadonlyArray<Fitted>;
  readonly #fixes: ReadonlyArray<Fix>;

  constructor(model: Three.Object3D, fitted: ReadonlyArray<Fitted>, fixes: ReadonlyArray<Fix>) {
    this.model = model;
    this.#fitted = fitted;
    this.#fixes = fixes;
  }

  /**
   * Poses the model as `pose` says, each bone by its weight in `weights`, from nothing, as it was posed, to a whole, as the pose has it: each bone of a joint turned from how it was made by the joint's angles, and each bone with no parent bone placed and turned as the whole figure is, in the model's own space. A bone nothing else posed since it was last posed goes from how it was made, so a weight never adds up from frame to frame. Each corrective shape is weighed by its joint's angle, as far as its bone takes the pose.
   */
  pose(pose: Pose.Pose, weights: Weights = {}): void {
    this.model.updateWorldMatrix(true, false);
    toModel.copy(this.model.matrixWorld).invert();
    asThree(figureTurn, pose.turn);
    figureAt.set(pose.at.x, pose.at.y, pose.at.z);
    for (const fitted of this.#fitted) {
      const { bone, wrote } = fitted;
      const weight = weightOf(bone, weights);
      // What it is posed from: as something else posed it this frame, or as made.
      const untouched =
        wrote.written && bone.quaternion.equals(wrote.turn) && bone.position.equals(wrote.at);
      if (untouched) {
        bone.quaternion.copy(fitted.madeTurn);
        if (fitted.root) {
          bone.position.copy(fitted.madeAt);
        }
      }
      if (weight <= 0) {
        wrote.written = false;
        continue;
      }
      Option.match(fitted.joint, {
        onNone: () => own.identity(),
        onSome: (joint) => asThree(own, Pose.turnOf(joint, pose.turns[fitted.name] ?? Joint.still)),
      });
      turned.copy(fitted.madeTurn).multiply(own);
      if (fitted.root) {
        // As made, in the model's space, then placed and turned as the whole figure is.
        const parent = bone.parent;
        parent?.updateWorldMatrix(true, false);
        fromModel.copy(toModel).multiply(parent?.matrixWorld ?? new Three.Matrix4());
        placing.compose(fitted.madeAt, turned, scale.set(1, 1, 1)).premultiply(fromModel);
        placing.decompose(at, turned, scale);
        at.applyQuaternion(figureTurn).add(figureAt);
        turned.premultiply(figureTurn);
        placing.compose(at, turned, scale.set(1, 1, 1)).premultiply(fromModel.invert());
        placing.decompose(at, turned, scale);
        bone.position.lerp(at, weight);
      }
      bone.quaternion.slerp(turned, weight);
      wrote.turn.copy(bone.quaternion);
      wrote.at.copy(bone.position);
      wrote.written = true;
    }
    for (const { corrective, influences, index } of this.#fixes) {
      const angle = (Joint.angleOf(pose.turns, corrective.joint, corrective.axis) * 180) / Math.PI;
      const span = corrective.full - corrective.from;
      const rising =
        span === 0 ? (angle >= corrective.full ? 1 : 0) : (angle - corrective.from) / span;
      const bone = this.model.getObjectByName(corrective.joint);
      const weight = bone === undefined ? 1 : weightOf(bone, weights);
      influences[index] = Math.min(Math.max(rising, 0), 1) * weight;
    }
    this.model.updateMatrixWorld(true);
  }
}

/** Whether `value` is a corrective shape as a mesh's extras write one. */
const isCorrective = (value: unknown): value is Corrective =>
  typeof value === 'object' &&
  value !== null &&
  'target' in value &&
  typeof value.target === 'string' &&
  'joint' in value &&
  typeof value.joint === 'string' &&
  'axis' in value &&
  (value.axis === 'flex' || value.axis === 'abduct' || value.axis === 'twist') &&
  'from' in value &&
  typeof value.from === 'number' &&
  'full' in value &&
  typeof value.full === 'number';

/**
 * `model` fitted to `joints`: the bone of every joint found in it, by name, each bone with no parent bone, how each was made, and every corrective shape its meshes name in their extras, with the morph target it weighs. Fails with `Unfitted` if the model has no bone of a joint, or a corrective shape names a morph target its mesh lacks or a joint `joints` lacks.
 */
export const fit = (model: Three.Object3D, joints: Joint.Joints): Effect.Effect<Posed, Unfitted> =>
  Effect.suspend(() => {
    const absent: Array<string> = [];
    const bones = new Map<string, Three.Bone>();
    model.traverse((child) => {
      if (child instanceof Three.Bone && !bones.has(child.name)) {
        bones.set(child.name, child);
      }
    });
    for (const name of Object.keys(joints)) {
      if (!bones.has(name)) {
        absent.push(name);
      }
    }
    const fixes: Array<Fix> = [];
    model.traverse((child) => {
      if (!(child instanceof Three.Mesh)) {
        return;
      }
      const named: unknown = child.userData['correctives'];
      for (const corrective of Array.isArray(named) ? named.filter(isCorrective) : []) {
        const index = child.morphTargetDictionary?.[corrective.target];
        const influences = child.morphTargetInfluences;
        if (index === undefined || influences === undefined) {
          absent.push(corrective.target);
        } else if (joints[corrective.joint] === undefined) {
          absent.push(corrective.joint);
        } else {
          fixes.push({ corrective, influences, index });
        }
      }
    });
    if (absent.length > 0) {
      return Effect.fail(new Unfitted({ absent }));
    }
    // Parents first, as the model holds them.
    const fitted: Array<Fitted> = [];
    model.traverse((child) => {
      if (!(child instanceof Three.Bone) || bones.get(child.name) !== child) {
        return;
      }
      const root = !(child.parent instanceof Three.Bone);
      const joint = Option.fromNullishOr(joints[child.name]);
      if (Option.isNone(joint) && !root) {
        return;
      }
      fitted.push({
        bone: child,
        name: child.name,
        joint,
        root,
        madeTurn: child.quaternion.clone(),
        madeAt: child.position.clone(),
        wrote: { turn: new Three.Quaternion(), at: new Three.Vector3(), written: false },
      });
    });
    return Effect.succeed(new Posed(model, fitted, fixes));
  });
