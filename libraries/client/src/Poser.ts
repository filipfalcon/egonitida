import {
  Fn,
  If,
  Loop,
  instanceIndex,
  int,
  max,
  min,
  normalize,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as Bvh from '#src/Bvh.ts';
import type * as SceneTracer from '#src/SceneTracer.ts';
import * as TracedScene from '#src/TracedScene.ts';

/**
 * The meshes a traced scene lays at rest, posed on the graphics device as their bones and morphs bend them now, as Three bends them to draw them: each corner moved by every morph as far as it is turned, then carried by its bones; each triangle laid where its corners stand, facing as they face; and every hierarchy's boxes grown about them again, from its leaves up, every hierarchy's level at once. Nothing of it is worked out by the page but where the bones stand and how far each morph is turned.
 */

/** How many groups of four numbers each triangle, each triangle's corners, and each threaded node take on the device. */
const TRIANGLE_GROUPS = TracedScene.TRIANGLE / 4;
const CORNER_GROUPS = TracedScene.CORNERS / 4;
const NODE_GROUPS = Bvh.THREADED / 4;

/** What poses one mesh: what it is made of at rest, uploaded once, and what bends it now, uploaded every frame. */
interface Posing {
  readonly mesh: Three.Mesh;
  readonly influences: Three.StorageBufferAttribute;
  readonly bones: Three.StorageBufferAttribute;
  readonly bind: Three.UniformNode<'mat4', Three.Matrix4>;
  readonly bindInverse: Three.UniformNode<'mat4', Three.Matrix4>;
  readonly corners: Three.ComputeNode;
  readonly triangles: Three.ComputeNode;
}

/** A buffer of `values`, `size` numbers an element. */
const bufferOf = (values: Float32Array | Uint32Array, size: number) =>
  new Three.StorageBufferAttribute(values, size);

/** What poses `posed` on `device`: its corners, then its triangles. */
const posingOf = (device: SceneTracer.OnDevice, posed: TracedScene.PosedOnDevice): Posing => {
  const { mesh } = posed;
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const facing = geometry.getAttribute('normal');
  const count = position.count;
  // Each corner at rest in one buffer, as a shader may read only so many: where it stands, which way it faces, and how much each of its bones weighs.
  const skinned = mesh instanceof Three.SkinnedMesh;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const rest = new Float32Array(count * 12);
  const indices = new Uint32Array(count * 4);
  for (let at = 0; at < count; at += 1) {
    rest.set([position.getX(at), position.getY(at), position.getZ(at), 1], at * 12);
    rest.set([facing.getX(at), facing.getY(at), facing.getZ(at), 0], at * 12 + 4);
    for (let which = 0; which < 4; which += 1) {
      indices[at * 4 + which] = skinned ? skinIndex.getComponent(at, which) : 0;
      rest[at * 12 + 8 + which] = skinned
        ? skinWeight.getComponent(at, which)
        : which === 0
          ? 1
          : 0;
    }
  }
  // Every morph's move of every corner, and its turn of which way the corner faces, side by side.
  const morphs = geometry.morphAttributes['position'] ?? [];
  const morphFacings = geometry.morphAttributes['normal'] ?? [];
  const targets = morphs.length;
  const relative = geometry.morphTargetsRelative;
  const moves = new Float32Array(Math.max(targets, 1) * count * 8);
  morphs.forEach((morph, target) => {
    const morphFacing = morphFacings[target];
    for (let at = 0; at < count; at += 1) {
      const into = (target * count + at) * 8;
      moves.set(
        [
          morph.getX(at) - (relative ? 0 : position.getX(at)),
          morph.getY(at) - (relative ? 0 : position.getY(at)),
          morph.getZ(at) - (relative ? 0 : position.getZ(at)),
          0,
        ],
        into,
      );
      if (morphFacing !== undefined) {
        moves.set(
          [
            morphFacing.getX(at) - (relative ? 0 : facing.getX(at)),
            morphFacing.getY(at) - (relative ? 0 : facing.getY(at)),
            morphFacing.getZ(at) - (relative ? 0 : facing.getZ(at)),
            0,
          ],
          into + 4,
        );
      }
    }
  });
  const boneCount = skinned ? mesh.skeleton.bones.length : 1;
  // Which corners each laid triangle joins, as the gathering laid it.
  const index = geometry.getIndex();
  const start = Math.max(geometry.drawRange.start, 0);
  const slots = new Uint32Array(posed.order.length * 4);
  posed.order.forEach((item, at) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const drawn = start + item * 3 + corner;
      slots[at * 4 + corner] = index === null ? drawn : index.getX(drawn);
    }
  });

  const influences = bufferOf(new Float32Array(Math.max(targets, 1)), 1);
  const bones = bufferOf(new Float32Array(boneCount * 16), 4);
  const bind = uniform(new Three.Matrix4());
  const bindInverse = uniform(new Three.Matrix4());

  const restNode = storage(bufferOf(rest, 4), 'vec4', count * 3).toReadOnly();
  const movesNode = storage(
    bufferOf(moves, 4),
    'vec4',
    Math.max(targets, 1) * count * 2,
  ).toReadOnly();
  const influencesNode = storage(influences, 'float', Math.max(targets, 1)).toReadOnly();
  const bonesNode = storage(bones, 'vec4', boneCount * 4).toReadOnly();
  const indicesNode = storage(bufferOf(indices, 4), 'uvec4', count).toReadOnly();
  // Each corner posed: where it stands, and which way it faces.
  const posedNode = storage(bufferOf(new Float32Array(count * 8), 4), 'vec4', count * 2);

  /** `way`, four numbers, turned by the bone `bone`'s matrix, kept by its columns. */
  const byBone = (bone: Three.Node<'uint'>, way: Three.Node<'vec4'>) => {
    const column = (which: number) => bonesNode.element(bone.mul(4).add(which));
    return column(0)
      .mul(way.x)
      .add(column(1).mul(way.y))
      .add(column(2).mul(way.z))
      .add(column(3).mul(way.w));
  };

  const cornersKernel = Fn(() => {
    const at = instanceIndex;
    const moved = restNode.element(at.mul(3)).xyz.toVar();
    const turned = restNode.element(at.mul(3).add(1)).xyz.toVar();
    if (targets > 0) {
      Loop(targets, ({ i }) => {
        const influence = influencesNode.element(i);
        If(influence.notEqual(0), () => {
          const moving = uint(i).mul(count).add(at).mul(2);
          moved.addAssign(movesNode.element(moving).xyz.mul(influence));
          turned.addAssign(movesNode.element(moving.add(1)).xyz.mul(influence));
        });
      });
    }
    // Carried by its bones, as Three's skinning carries it: into the skeleton's space, by each bone as much as it weighs, and back.
    const atBind = bind.mul(vec4(moved, 1)).toVar();
    const facingBind = bind.mul(vec4(turned, 0)).toVar();
    const which = indicesNode.element(at);
    const weight = restNode.element(at.mul(3).add(2));
    const carried = byBone(which.x, atBind)
      .mul(weight.x)
      .add(byBone(which.y, atBind).mul(weight.y))
      .add(byBone(which.z, atBind).mul(weight.z))
      .add(byBone(which.w, atBind).mul(weight.w));
    const carriedFacing = byBone(which.x, facingBind)
      .mul(weight.x)
      .add(byBone(which.y, facingBind).mul(weight.y))
      .add(byBone(which.z, facingBind).mul(weight.z))
      .add(byBone(which.w, facingBind).mul(weight.w));
    posedNode
      .element(at.mul(2))
      .assign(skinned ? vec4(bindInverse.mul(carried).xyz, 1) : vec4(moved, 1));
    posedNode
      .element(at.mul(2).add(1))
      .assign(vec4(skinned ? normalize(bindInverse.mul(carriedFacing).xyz) : normalize(turned), 0));
  })().compute(count);

  const slotsNode = storage(bufferOf(slots, 4), 'uvec4', posed.order.length).toReadOnly();
  const trianglesKernel = Fn(() => {
    const at = instanceIndex;
    const joined = slotsNode.element(at);
    const triangle = uint(posed.firstTriangle).add(at);
    for (const [corner, part] of [
      [0, 'x'],
      [1, 'y'],
      [2, 'z'],
    ] as const) {
      const vertex = joined[part];
      device.triangles.writable
        .element(triangle.mul(TRIANGLE_GROUPS).add(corner))
        .assign(vec4(posedNode.element(vertex.mul(2)).xyz, 0));
      const said = device.corners.writable.element(triangle.mul(CORNER_GROUPS).add(corner));
      said.assign(vec4(posedNode.element(vertex.mul(2).add(1)).xyz, said.w));
    }
  })().compute(posed.order.length);

  return {
    mesh,
    influences,
    bones,
    bind,
    bindInverse,
    corners: cornersKernel,
    triangles: trianglesKernel,
  };
};

/** One level of every posed hierarchy, refitted at once: the boxes of the nodes `order` names from `start`, `count` of them, grown about their triangles or their children. */
const refitOf = (
  device: SceneTracer.OnDevice,
  order: Three.StorageBufferNode<'uint'>,
  start: number,
  count: number,
) =>
  Fn(() => {
    const node = order.element(uint(start).add(instanceIndex));
    const low = device.shapeNodes.writable.element(node.mul(NODE_GROUPS)).toVar();
    const high = device.shapeNodes.writable.element(node.mul(NODE_GROUPS).add(1)).toVar();
    const least = vec3(1e30).toVar();
    const greatest = vec3(-1e30).toVar();
    const items = int(high.w);
    If(items.greaterThan(0), () => {
      const first = int(device.shapeNodes.writable.element(node.mul(NODE_GROUPS).add(2)).x);
      Loop(items, ({ i }) => {
        const triangle = first.add(i).mul(TRIANGLE_GROUPS);
        for (let corner = 0; corner < 3; corner += 1) {
          const at = device.triangles.writable.element(triangle.add(corner)).xyz;
          least.assign(min(least, at));
          greatest.assign(max(greatest, at));
        }
      });
    }).Else(() => {
      const left = node.add(1);
      const right = uint(int(device.shapeNodes.writable.element(left.mul(NODE_GROUPS)).w));
      for (const child of [left, right]) {
        least.assign(min(least, device.shapeNodes.writable.element(child.mul(NODE_GROUPS)).xyz));
        greatest.assign(
          max(greatest, device.shapeNodes.writable.element(child.mul(NODE_GROUPS).add(1)).xyz),
        );
      }
    });
    device.shapeNodes.writable.element(node.mul(NODE_GROUPS)).assign(vec4(least, low.w));
    device.shapeNodes.writable.element(node.mul(NODE_GROUPS).add(1)).assign(vec4(greatest, high.w));
  })().compute(count);

/** Poses a traced scene's meshes laid at rest on the graphics device. */
export interface Poser {
  /** Poses every mesh `flat` lays at rest as it is bent now, onto `flat` as the device holds it. */
  readonly pose: (flat: TracedScene.Flat) => void;
}

/** A poser of what `device` holds. */
export const make = (renderer: Three.WebGPURenderer, device: SceneTracer.OnDevice): Poser => {
  const kept: { key: string; posings: ReadonlyArray<Posing>; kernels: Array<Three.ComputeNode> } = {
    key: '',
    posings: [],
    kernels: [],
  };

  /** Builds what poses every mesh `flat` lays at rest, and refits every hierarchy, level by level. */
  const build = (flat: TracedScene.Flat) => {
    const posings = flat.posed.map((posed) => posingOf(device, posed));
    // Every posed hierarchy's levels, from its leaves up, the same heights of all of them together.
    const levels = flat.posed.map(({ firstNode, nodes }) => {
      const local = flat.shapeNodes.slice(
        firstNode * Bvh.THREADED,
        (firstNode + nodes) * Bvh.THREADED,
      );
      for (let node = 0; node < nodes; node += 1) {
        const after = local[node * Bvh.THREADED + 3] ?? -1;
        local[node * Bvh.THREADED + 3] = after < 0 ? -1 : after - firstNode;
      }
      const { order, levels: each } = Bvh.levelsOf(local);
      return each.map(({ start, count }) =>
        Array.from(order.subarray(start, start + count), (node) => node + firstNode),
      );
    });
    const highest = levels.reduce((most, each) => Math.max(most, each.length), 0);
    const byHeight = Array.from({ length: highest }, (_, height) =>
      levels.flatMap((each) => each[height] ?? []),
    );
    const order = storage(
      bufferOf(new Uint32Array(byHeight.flat().length > 0 ? byHeight.flat() : [0]), 1),
      'uint',
      Math.max(byHeight.flat().length, 1),
    ).toReadOnly();
    const refits = byHeight.reduce<{ start: number; kernels: Array<Three.ComputeNode> }>(
      (made, level) => ({
        start: made.start + level.length,
        kernels: [...made.kernels, refitOf(device, order, made.start, level.length)],
      }),
      { start: 0, kernels: [] },
    ).kernels;
    kept.posings = posings;
    kept.kernels = [
      ...posings.map(({ corners }) => corners),
      ...posings.map(({ triangles }) => triangles),
      ...refits,
    ];
  };

  return {
    pose: (flat) => {
      if (flat.posed.length === 0) {
        return;
      }
      const key = flat.posed
        .map(({ mesh, firstTriangle, firstNode }) => `${mesh.id}:${firstTriangle}:${firstNode}`)
        .join(',');
      if (key !== kept.key) {
        kept.key = key;
        build(flat);
      }
      for (const posing of kept.posings) {
        const { mesh } = posing;
        posing.influences.array.set(mesh.morphTargetInfluences ?? [0]);
        posing.influences.needsUpdate = true;
        if (mesh instanceof Three.SkinnedMesh) {
          const { boneMatrices } = mesh.skeleton;
          if (boneMatrices !== null) {
            posing.bones.array.set(boneMatrices);
            posing.bones.needsUpdate = true;
          }
          posing.bind.value.copy(mesh.bindMatrix);
          posing.bindInverse.value.copy(mesh.bindMatrixInverse);
        }
      }
      // The renderer is ready, so it computes at once and gives back no promise.
      void renderer.compute(kept.kernels);
    },
  };
};
