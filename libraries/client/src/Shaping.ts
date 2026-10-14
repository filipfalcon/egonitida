import { Shape } from '@lightocean/core';
import { Data, Effect, Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';

/**
 * A model reshaped as a game's dials say, as its `Shape` has them, such as a figure's hips made wider, her cheeks fuller, or her legs longer: by the morph targets whoever made the model put in it, and by drawing its bones out. `fit` finds them in a model as it is delivered, or refuses it, naming what it lacks; and the model is then shaped from the dials' values alone, every frame, as a view draws it, y = h(x): the same values give the same shape, however it was shaped before.
 */

/** The model has no morph target or bone a dial turns: each one absent, by name, in the order of the dials. */
export class Unfitted extends Data.TaggedError('Unfitted')<{
  readonly absent: ReadonlyArray<string>;
}> {}

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
 * One bone of the model's skeletons, as it was made and as it rests now. Its rests are in the space the skeletons are bound in; `rest`, `move`, `unmove`, `stretch`, and `moved` are worked out anew each time the model is lengthened.
 */
interface Joint {
  readonly bone: Three.Bone;
  /** The nearest bone above it in the model that is a joint too. */
  readonly parent: Joint | undefined;
  readonly madeRest: Three.Matrix4;
  readonly madeInverse: Three.Matrix4;
  /** Its rest as made, from its parent's. */
  readonly madeLocal: Three.Matrix4;
  readonly madePosition: Three.Vector3;
  readonly madeScale: Three.Vector3;
  readonly rest: Three.Matrix4;
  /** From its rest as made to its rest now, and back. */
  readonly move: Three.Matrix4;
  readonly unmove: Three.Matrix4;
  stretch: number;
  /** How much bigger the dials grow it, whole: 1 as made. */
  growth: number;
  moved: boolean;
}

/** One skeleton of the model: its joints by its bones' indices, and its bones' inverses as made. */
interface Skeleton {
  readonly skeleton: Three.Skeleton;
  readonly joints: ReadonlyArray<Joint | undefined>;
  readonly madeInverses: ReadonlyArray<Three.Matrix4>;
}

/** One buffer of skin, however many meshes are drawn from it: where each point was made, and the joints its skeleton holds it by. */
interface Skin {
  readonly position: Three.BufferAttribute | Three.InterleavedBufferAttribute;
  readonly skinIndex: Three.BufferAttribute | Three.InterleavedBufferAttribute;
  readonly skinWeight: Three.BufferAttribute | Three.InterleavedBufferAttribute;
  readonly made: Float32Array;
  readonly joints: ReadonlyArray<Joint | undefined>;
  readonly toSkeleton: Three.Matrix4;
  readonly fromSkeleton: Three.Matrix4;
}

/** A bone a dial raises: its joint, how long its offset from its parent was made, and how long the longest way down through the bones the dial lengthens beneath it was made. */
interface Raised {
  readonly joint: Joint;
  readonly made: number;
  readonly beneath: number;
}

/** A dial lengthening `joints`, or growing them whole, raising the bone `raised`, if it raises one, and the value it was last applied at: nothing, as the model is made. */
interface Length {
  readonly dial: string;
  readonly grows: boolean;
  readonly by: number;
  readonly joints: ReadonlyArray<Joint>;
  readonly raised: Option.Option<Raised>;
  applied: number;
}

/** What lengthens a model: its dials, joints parents first, skeletons, skins, and meshes. */
interface Lengths {
  readonly dials: ReadonlyArray<Length>;
  readonly joints: ReadonlyArray<Joint>;
  readonly skeletons: ReadonlyArray<Skeleton>;
  readonly skins: ReadonlyArray<Skin>;
  readonly meshes: ReadonlyArray<Three.SkinnedMesh>;
}

const translation = new Three.Vector3();
const turn = new Three.Quaternion();
const scale = new Three.Vector3();
const point = new Three.Vector3();
const moved = new Three.Vector3();
const sum = new Three.Vector3();

/** Rests every joint as the dials' values stretch them, parents first: each lengthened joint's offset from its parent drawn out, and every joint below it carried along. */
const restJoints = (lengths: Lengths) => {
  for (const joint of lengths.joints) {
    joint.stretch = 1;
    joint.growth = 1;
  }
  for (const length of lengths.dials) {
    for (const joint of length.joints) {
      if (length.grows) {
        joint.growth *= 1 + length.applied * length.by;
      } else {
        joint.stretch *= 1 + length.applied * length.by;
      }
    }
    if (Option.isSome(length.raised) && length.raised.value.made > 0) {
      const { joint, made, beneath } = length.raised.value;
      joint.stretch *= 1 + (length.applied * length.by * beneath) / made;
    }
  }
  for (const joint of lengths.joints) {
    const parent = joint.parent;
    joint.moved =
      parent !== undefined && (joint.stretch !== 1 || joint.growth !== 1 || parent.moved);
    if (parent === undefined || !joint.moved) {
      joint.rest.copy(joint.madeRest);
      joint.move.identity();
      joint.unmove.identity();
      joint.bone.position.copy(joint.madePosition);
      joint.bone.scale.copy(joint.madeScale);
      continue;
    }
    joint.madeLocal.decompose(translation, turn, scale);
    translation.multiplyScalar(joint.stretch);
    scale.multiplyScalar(joint.growth);
    joint.rest.compose(translation, turn, scale).premultiply(parent.rest);
    joint.move.multiplyMatrices(joint.rest, joint.madeInverse);
    joint.unmove.copy(joint.move).invert();
    joint.bone.position.copy(joint.madePosition).multiplyScalar(joint.stretch);
    joint.bone.scale.copy(joint.madeScale).multiplyScalar(joint.growth);
  }
};

/** Puts point `at` of `skin` where its joints hold it now: as made, moved by the moves of the joints it follows, each by its weight; exactly as made if none of them moved. */
const placePoint = (skin: Skin, at: number) => {
  const madeX = skin.made[at * 3] ?? 0;
  const madeY = skin.made[at * 3 + 1] ?? 0;
  const madeZ = skin.made[at * 3 + 2] ?? 0;
  point.set(madeX, madeY, madeZ).applyMatrix4(skin.toSkeleton);
  sum.set(0, 0, 0);
  let weights = 0;
  let carried = false;
  for (let k = 0; k < 4; k++) {
    const weight = skin.skinWeight.getComponent(at, k);
    if (weight === 0) {
      continue;
    }
    const joint = skin.joints[skin.skinIndex.getComponent(at, k)];
    moved.copy(point);
    if (joint !== undefined && joint.moved) {
      moved.applyMatrix4(joint.move);
      carried = true;
    }
    sum.addScaledVector(moved, weight);
    weights += weight;
  }
  if (!carried || weights === 0) {
    skin.position.setXYZ(at, madeX, madeY, madeZ);
    return;
  }
  sum.divideScalar(weights).applyMatrix4(skin.fromSkeleton);
  skin.position.setXYZ(at, sum.x, sum.y, sum.z);
};

/** Lengthens the model as its dials were last applied: its joints rested, its skeletons bound to those rests, and its skin carried with them. */
const lengthenModel = (lengths: Lengths) => {
  restJoints(lengths);
  for (const { skeleton, joints, madeInverses } of lengths.skeletons) {
    skeleton.boneInverses.forEach((boneInverse, index) => {
      const joint = joints[index];
      const made = madeInverses[index];
      if (made === undefined) {
        return;
      }
      if (joint === undefined || !joint.moved) {
        boneInverse.copy(made);
      } else {
        boneInverse.multiplyMatrices(made, joint.unmove);
      }
    });
  }
  for (const skin of lengths.skins) {
    for (let at = 0; at < skin.position.count; at++) {
      placePoint(skin, at);
    }
    skin.position.needsUpdate = true;
  }
  for (const mesh of lengths.meshes) {
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    if (mesh.boundingBox !== null) {
      mesh.computeBoundingBox();
    }
    if (mesh.boundingSphere !== null) {
      mesh.computeBoundingSphere();
    }
  }
};

/**
 * A model fitted to a game's dials, made by `fit`: the model within it, and `shape`, which shapes it by the dials' values. It stands for the model in the scene, so a view places it as it would the model.
 */
export class Shaped<D extends Shape.Dials> extends Three.Group {
  readonly model: Three.Object3D;
  readonly #turns: ReadonlyArray<Turn>;
  readonly #lengths: Lengths;
  readonly #joints: ReadonlyMap<Three.Object3D, Joint>;

  constructor(model: Three.Object3D, turns: ReadonlyArray<Turn>, lengths: Lengths) {
    super();
    this.model = model;
    this.#turns = turns;
    this.#lengths = lengths;
    this.#joints = new Map(lengths.joints.map((joint) => [joint.bone, joint]));
    this.add(model);
  }

  /** What `run` gives, run with every bone of the model where it was made, then put back where the dials put it: as a mixer binding the model must see it, so it blends a clip with the model as made, however it is shaped. */
  asMade<A>(run: () => A): A {
    const shaped = this.#lengths.joints.map((joint) => joint.bone.position.clone());
    for (const joint of this.#lengths.joints) {
      joint.bone.position.copy(joint.madePosition);
    }
    try {
      return run();
    } finally {
      this.#lengths.joints.forEach((joint, index) => {
        const position = shaped[index];
        if (position !== undefined) {
          joint.bone.position.copy(position);
        }
      });
    }
  }

  /** How far the dials draw `bone`'s offset from its parent out as the model is shaped now: 1 as it was made, and for any bone they never lengthen nor raise. An animation that moves the bone moves it as far, as `Animating` poses a shaped model. */
  stretchOf(bone: Three.Object3D): number {
    return this.#joints.get(bone)?.stretch ?? 1;
  }

  /**
   * Shapes the model as `values` say: every morph target a dial turns, on every mesh that carries it, weighted by the dial's value alone; and every bone a dial lengthens, lengthened from the model as it was made, with its skin, whenever a value lengthening it is another than last. Allocates nothing while no length changes.
   */
  shape(values: Shape.Values<D>): void {
    const read: Readonly<Record<string, number>> = values;
    for (const turned of this.#turns) {
      const value = read[turned.dial];
      if (value !== undefined) {
        turned.influences[turned.index] = weightOf(turned.side, value);
      }
    }
    let lengthened = false;
    for (const length of this.#lengths.dials) {
      const value = read[length.dial];
      if (value !== undefined && value !== length.applied) {
        length.applied = value;
        lengthened = true;
      }
    }
    if (lengthened) {
      lengthenModel(this.#lengths);
    }
  }
}

/** The targets a morph dial turns, each with the part of its value it is weighted by; none for a dial that turns no morph target. */
const targetsOf = (dial: Shape.Dial): ReadonlyArray<readonly [string, Side]> =>
  dial._tag === 'Morph'
    ? [[dial.target, 'Whole']]
    : dial._tag === 'Opposed'
      ? [
          [dial.less, 'Less'],
          [dial.more, 'More'],
        ]
      : [];

/** What lengthens `model`: every bone of its skeletons a joint, parents first, with their rests as the first skeleton holding each was bound to them, and every buffer of skin drawn from them. */
const lengthsOf = (model: Three.Object3D, meshes: ReadonlyArray<Three.SkinnedMesh>) => {
  const madeRests = new Map<Three.Bone, Three.Matrix4>();
  for (const mesh of meshes) {
    mesh.skeleton.bones.forEach((bone, index) => {
      const boneInverse = mesh.skeleton.boneInverses[index];
      if (!madeRests.has(bone) && boneInverse !== undefined) {
        madeRests.set(bone, boneInverse.clone().invert());
      }
    });
  }
  const joints = new Map<Three.Object3D, Joint>();
  const parentOf = (object: Three.Object3D): Joint | undefined => {
    const above = object.parent;
    return above === null ? undefined : (joints.get(above) ?? parentOf(above));
  };
  model.traverse((child) => {
    const madeRest = child instanceof Three.Bone ? madeRests.get(child) : undefined;
    if (!(child instanceof Three.Bone) || madeRest === undefined) {
      return;
    }
    const parent = parentOf(child);
    joints.set(child, {
      bone: child,
      parent,
      madeRest,
      madeInverse: madeRest.clone().invert(),
      madeLocal:
        parent === undefined
          ? madeRest.clone()
          : parent.madeRest.clone().invert().multiply(madeRest),
      madePosition: child.position.clone(),
      madeScale: child.scale.clone(),
      rest: madeRest.clone(),
      move: new Three.Matrix4(),
      unmove: new Three.Matrix4(),
      stretch: 1,
      growth: 1,
      moved: false,
    });
  });
  const jointsOf = (skeleton: Three.Skeleton) => skeleton.bones.map((bone) => joints.get(bone));
  const skeletons = [...new Set(meshes.map((mesh) => mesh.skeleton))].map((skeleton) => ({
    skeleton,
    joints: jointsOf(skeleton),
    madeInverses: skeleton.boneInverses.map((boneInverse) => boneInverse.clone()),
  }));
  const skins = new Map<Skin['position'], Skin>();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (skins.has(position) || skinIndex === undefined || skinWeight === undefined) {
      continue;
    }
    // Read point by point: as loaded, a buffer may interleave them with the rest of each vertex.
    const made = new Float32Array(position.count * 3);
    for (let at = 0; at < position.count; at++) {
      made[at * 3] = position.getX(at);
      made[at * 3 + 1] = position.getY(at);
      made[at * 3 + 2] = position.getZ(at);
    }
    skins.set(position, {
      position,
      skinIndex,
      skinWeight,
      made,
      joints: jointsOf(mesh.skeleton),
      toSkeleton: mesh.bindMatrix.clone(),
      fromSkeleton: mesh.bindMatrixInverse.clone(),
    });
  }
  return { joints, skeletons, skins: [...skins.values()] };
};

/** How long the longest way down from `raised` through `lengthened` was made: along each way, every bone of them its offset from its parent long, and every other nothing. */
const beneath = (raised: Joint, lengthened: ReadonlyArray<Joint>) => {
  let longest = 0;
  for (const from of lengthened) {
    let along = 0;
    let at: Joint | undefined = from;
    while (at !== undefined && at !== raised) {
      along += lengthened.includes(at) ? at.madePosition.length() : 0;
      at = at.parent;
    }
    if (at === raised) {
      longest = Math.max(longest, along);
    }
  }
  return longest;
};

/** Gives `meshes` skin and skeletons of their own, copies of those they hold, which lengthening may rewrite without reaching any other copy of the model they share them with; a buffer or skeleton several of them share, they go on sharing. Lets go of the copied skin once the scope closes. */
const ownSkin = (meshes: ReadonlyArray<Three.SkinnedMesh>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const geometries = new Map<Three.BufferGeometry, Three.BufferGeometry>();
      const skeletons = new Set<Three.Skeleton>();
      for (const mesh of meshes) {
        const owned = geometries.get(mesh.geometry) ?? mesh.geometry.clone();
        geometries.set(mesh.geometry, owned);
        mesh.geometry = owned;
        skeletons.add(mesh.skeleton);
      }
      for (const skeleton of skeletons) {
        skeleton.boneInverses = skeleton.boneInverses.map((boneInverse) => boneInverse.clone());
      }
      return [...geometries.values()];
    }),
    (owned) =>
      Effect.sync(() => {
        for (const geometry of owned) {
          geometry.dispose();
        }
      }),
  );

/**
 * `model` fitted to `shape`: every morph target a dial turns, found on every mesh of the model that carries it, and every bone a dial lengthens, found in its skeletons, as the model holds its meshes now and rests as it was made. Fails with `Unfitted` if no mesh carries one of the targets, or no skeleton one of the bones.
 *
 * Lengthening rewrites the skin, so a model with a dial that lengthens is given a copy of its skin and its skeletons' rests of its own, which the scope lets go of once it closes: copies of one loaded model, which share them, as `SkeletonUtils.clone` copies one, are each shaped on their own. Everything else the model holds stays the caller's to let go of.
 */
export const fit = <D extends Shape.Dials>(
  model: Three.Object3D,
  shape: Shape.Shape<D>,
): Effect.Effect<Shaped<D>, Unfitted, Scope.Scope> =>
  Effect.gen(function* () {
    const meshes: Array<Three.Mesh> = [];
    const skinned: Array<Three.SkinnedMesh> = [];
    model.traverse((child) => {
      if (child instanceof Three.Mesh) {
        meshes.push(child);
      }
      if (child instanceof Three.SkinnedMesh) {
        skinned.push(child);
      }
    });
    if (
      Object.values(shape.dials).some((dial) => dial._tag === 'Lengthen' || dial._tag === 'Grow')
    ) {
      yield* ownSkin(skinned);
    }
    const rig = lengthsOf(model, skinned);
    const bones = new Map([...rig.joints.values()].map((joint) => [joint.bone.name, joint]));
    const turns: Array<Turn> = [];
    const lengths: Array<Length> = [];
    const absent: Array<string> = [];
    for (const [dial, turned] of Object.entries(shape.dials)) {
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
      if (turned._tag === 'Lengthen' || turned._tag === 'Grow') {
        const joints = turned.bones.flatMap((name) => {
          const joint = bones.get(name);
          if (joint === undefined) {
            absent.push(name);
            return [];
          }
          return [joint];
        });
        const raises = turned._tag === 'Lengthen' ? turned.raises : Option.none<string>();
        const raised = Option.flatMap(raises, (name) => {
          const joint = bones.get(name);
          if (joint === undefined) {
            absent.push(name);
            return Option.none();
          }
          return Option.some({
            joint,
            made: joint.madePosition.length(),
            beneath: beneath(joint, joints),
          });
        });
        lengths.push({
          dial,
          grows: turned._tag === 'Grow',
          by: turned.by,
          joints,
          raised,
          applied: 0,
        });
      }
    }
    if (absent.length > 0) {
      return yield* new Unfitted({ absent });
    }
    return new Shaped<D>(model, turns, {
      dials: lengths,
      joints: [...rig.joints.values()],
      skeletons: rig.skeletons,
      skins: rig.skins,
      meshes: skinned,
    });
  });
