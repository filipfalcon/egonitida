import type { Ragdoll } from '@egonitida/core';
import { Data, Effect } from 'effect';
import * as Three from 'three/webgpu';

/**
 * A model posed by a ragdoll, as a game's ragdoll falls: its points named after the model's bones, one at each bone's start, and each bone the game names turned to aim at the point of the bone it names, about where a side it names lies, if it names one; the bone nothing above it is aimed stands where its point is. Only how the bones turn changes, and where the topmost stands, so a model `Shaping` shaped falls as long as it is. It is posed every frame, after its animation, and goes over to the ragdoll by a weight, so a fall takes over from what the model was doing without a jump, y = h(x).
 */

/** How the game aims one bone at the ragdoll: at the point of the bone `toward`, turned about it so the way from the point of the first bone of `side` to the second lies as the ragdoll has it. */
export interface Aim {
  readonly toward: string;
  readonly side?: readonly [string, string] | undefined;
}

/** How a model is posed by a ragdoll: each bone the game aims, by name. */
export interface Ragdolling {
  readonly aims: Readonly<Record<string, Aim>>;
}

/** Where each point of a ragdoll is, in the world, by the name of the bone it stands at. */
export type Points = Readonly<Record<string, Ragdoll.Point>>;

/** The model has no bone the ragdoll moves: each one absent, by name, in the order of the aims. */
export class Unfitted extends Data.TaggedError('Unfitted')<{
  readonly absent: ReadonlyArray<string>;
}> {}

/** How a model is posed by a ragdoll aiming its bones as `aims` says. */
export const make = (aims: Readonly<Record<string, Aim>>): Ragdolling => ({ aims });

/**
 * How a figure made with MPFB, MakeHuman's Blender add-on, is posed as `Ragdoll.mpfb` falls, on the `game_engine` rig it makes: her pelvis aimed up at her chest and her chest at her neck, each turned about the way across her, from right to left; her neck at her head; each limb from joint to joint, down to her toes and her hands.
 */
export const mpfb = make({
  pelvis: { toward: 'spine_03', side: ['thigh_r', 'thigh_l'] },
  spine_03: { toward: 'neck_01', side: ['upperarm_r', 'upperarm_l'] },
  neck_01: { toward: 'head' },
  thigh_l: { toward: 'calf_l' },
  calf_l: { toward: 'foot_l' },
  foot_l: { toward: 'ball_l' },
  thigh_r: { toward: 'calf_r' },
  calf_r: { toward: 'foot_r' },
  foot_r: { toward: 'ball_r' },
  upperarm_l: { toward: 'lowerarm_l' },
  lowerarm_l: { toward: 'hand_l' },
  upperarm_r: { toward: 'lowerarm_r' },
  lowerarm_r: { toward: 'hand_r' },
});

/** One bone the ragdoll aims, as fitted: the bones it aims at, where they lie from it as the model was made, and whether nothing above it is aimed. */
interface Aimed {
  readonly bone: Three.Object3D;
  readonly name: string;
  readonly toward: string;
  readonly side: readonly [string, string] | undefined;
  /** Toward the bone it aims at, in its own space, as made. */
  readonly aim: Three.Vector3;
  /** From the first bone of its side to the second, in its own space, as made, square to its aim. */
  readonly across: Three.Vector3;
  readonly root: boolean;
}

const from = new Three.Vector3();
const to = new Three.Vector3();
const facing = new Three.Vector3();
const sideways = new Three.Vector3();
const third = new Three.Vector3();
const crossing = new Three.Vector3();
const parentTurn = new Three.Quaternion();
const turned = new Three.Quaternion();
const shortest = new Three.Quaternion();
const posed = new Three.Quaternion();
const basis = new Three.Matrix4();
const made = new Three.Matrix4();
const standing = new Three.Vector3();

/** `out` set to the point `point`. */
const vectorOf = (out: Three.Vector3, point: Ragdoll.Point) => out.set(point.x, point.y, point.z);

/**
 * A model posed by a ragdoll, made by `fit`: the model, and `pose`, which poses it as the ragdoll lies, by a weight.
 */
export class Ragdolled {
  readonly model: Three.Object3D;
  readonly #aimed: ReadonlyArray<Aimed>;

  constructor(model: Three.Object3D, aimed: ReadonlyArray<Aimed>) {
    this.model = model;
    this.#aimed = aimed;
  }

  /**
   * Poses the model as `points` lie, by `weight`, from nothing, as it was posed, to a whole, as the ragdoll lies: each bone the ragdoll aims turned to aim at the point of the bone it aims at, about its side if it has one, the topmost standing at its point, its parents first. A bone whose points are not given is left as it is.
   */
  pose(points: Points, weight: number): void {
    this.model.updateWorldMatrix(true, true);
    for (const aimed of this.#aimed) {
      const start = points[aimed.name];
      const end = points[aimed.toward];
      const parent = aimed.bone.parent;
      if (start === undefined || end === undefined || parent === null) {
        continue;
      }
      vectorOf(from, start);
      vectorOf(to, end);
      facing.subVectors(to, from).normalize();
      parent.getWorldQuaternion(parentTurn);
      const sideStart = aimed.side === undefined ? undefined : points[aimed.side[0]];
      const sideEnd = aimed.side === undefined ? undefined : points[aimed.side[1]];
      if (sideStart !== undefined && sideEnd !== undefined) {
        // Turned whole: its aim to the ragdoll's, and its side about it.
        vectorOf(sideways, sideEnd).sub(vectorOf(third, sideStart));
        sideways.addScaledVector(facing, -sideways.dot(facing)).normalize();
        third.crossVectors(facing, sideways);
        basis.makeBasis(facing, sideways, third);
        crossing.crossVectors(aimed.aim, aimed.across);
        made.makeBasis(aimed.aim, aimed.across, crossing).transpose();
        turned.setFromRotationMatrix(basis.multiply(made));
      } else {
        // Turned the shortest way from where it aims now to where the ragdoll aims it.
        turned.copy(parentTurn).multiply(aimed.bone.quaternion);
        third.copy(aimed.aim).applyQuaternion(turned);
        shortest.setFromUnitVectors(third, facing);
        turned.premultiply(shortest);
      }
      posed.copy(parentTurn).invert().multiply(turned);
      aimed.bone.quaternion.slerp(posed, weight);
      if (aimed.root) {
        aimed.bone.position.lerp(parent.worldToLocal(standing.copy(from)), weight);
      }
      aimed.bone.updateMatrixWorld(true);
    }
  }
}

/** Where `bone` stands in the world now. */
const worldAt = (bone: Three.Object3D) => bone.getWorldPosition(new Three.Vector3());

/**
 * `model` fitted to `ragdolling`: every bone it aims, every bone they aim at, and every bone of their sides found in the model, and where each lies from the bone aimed at it, as the model stands now, as it was made. Fails with `Unfitted` if the model has no bone of one of those names.
 */
export const fit = (
  model: Three.Object3D,
  ragdolling: Ragdolling,
): Effect.Effect<Ragdolled, Unfitted> =>
  Effect.suspend(() => {
    model.updateWorldMatrix(true, true);
    const absent: Array<string> = [];
    const found = (name: string) => {
      const bone = model.getObjectByName(name);
      if (bone === undefined && !absent.includes(name)) {
        absent.push(name);
      }
      return bone;
    };
    const aimed: Array<Aimed> = [];
    for (const [name, aim] of Object.entries(ragdolling.aims)) {
      const bone = found(name);
      const toward = found(aim.toward);
      const side = aim.side?.map(found);
      if (bone === undefined || toward === undefined) {
        continue;
      }
      const direction = bone.worldToLocal(worldAt(toward)).normalize();
      const [sideStart, sideEnd] = side ?? [];
      const across =
        sideStart === undefined || sideEnd === undefined
          ? new Three.Vector3()
          : bone
              .worldToLocal(worldAt(sideEnd))
              .sub(bone.worldToLocal(worldAt(sideStart)))
              .projectOnPlane(direction)
              .normalize();
      aimed.push({
        bone,
        name,
        toward: aim.toward,
        side: aim.side,
        aim: direction,
        across,
        root: false,
      });
    }
    if (absent.length > 0) {
      return Effect.fail(new Unfitted({ absent }));
    }
    // Parents first, as the model holds them, and the topmost of each stands where its point is.
    const order = new Map<Three.Object3D, number>();
    model.traverse((child) => {
      order.set(child, order.size);
    });
    const bones = new Set(aimed.map(({ bone }) => bone));
    const isRoot = (bone: Three.Object3D) => {
      for (let above = bone.parent; above !== null; above = above.parent) {
        if (bones.has(above)) {
          return false;
        }
      }
      return true;
    };
    return Effect.succeed(
      new Ragdolled(
        model,
        aimed
          .map((one) => ({ ...one, root: isRoot(one.bone) }))
          .sort((a, b) => (order.get(a.bone) ?? 0) - (order.get(b.bone) ?? 0)),
      ),
    );
  });
