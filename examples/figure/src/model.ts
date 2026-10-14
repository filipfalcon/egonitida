import * as Three from 'three/webgpu';

/**
 * The figure's model, as whoever made it delivers it, such as a `.glb` from Blender: a body turned on a lathe, skinned to five bones, `root` at her feet, `knee`, `hips`, `chest`, and `head`, with morph targets that make her chest fuller and her hips wider or narrower. It is made here in code, so the example needs no file; a game loads its own, and fits it to its dials as this one is fitted.
 */

/** The name of her body's mesh. */
export const BODY = 'body';

/** How high each of her bones stands above the one beneath it, from her feet: her knee, her hips, her chest, and her head; and how tall she is. */
export const KNEE = 0.5;
export const HIPS = 0.45;
export const CHEST = 0.4;
export const HEAD = 0.27;
export const TALL = 1.82;

/** Each bone's height from her feet, in the order her skeleton holds them. */
const HEIGHTS = [0, KNEE, KNEE + HIPS, KNEE + HIPS + CHEST, KNEE + HIPS + CHEST + HEAD];

/** How far above and below a joint her skin is held by both its bones. */
const BAND = 0.08;

/** Her outline, as how far her body reaches from her middle at each height, from her feet to the top of her head. */
const OUTLINE: ReadonlyArray<readonly [height: number, reach: number]> = [
  [0, 0],
  [0.01, 0.08],
  [0.08, 0.06],
  [0.3, 0.09],
  [0.5, 0.075],
  [0.75, 0.13],
  [0.95, 0.18],
  [1.1, 0.13],
  [1.3, 0.16],
  [1.45, 0.17],
  [1.53, 0.06],
  [1.6, 0.05],
  [1.7, 0.1],
  [1.8, 0.06],
  [TALL, 0],
];

/** How far her body reaches from her middle at `height`, between the points of her outline. */
const reachAt = (height: number) => {
  for (let at = 1; at < OUTLINE.length; at++) {
    const below = OUTLINE[at - 1];
    const above = OUTLINE[at];
    if (below !== undefined && above !== undefined && height <= above[0]) {
      return below[1] + ((height - below[0]) / (above[0] - below[0])) * (above[1] - below[1]);
    }
  }
  return 0;
};

/** A swelling, whole at its middle, `distance` from it, and nothing a `reach` away. */
const swelling = (distance: number, reach: number) => {
  const t = Math.abs(distance) / reach;
  return t < 1 ? (1 - t * t) ** 2 : 0;
};

/** The bones that hold a point at `height`, each with its weight: the bone it is on, and the one across a joint near it. */
const heldAt = (height: number): ReadonlyArray<readonly [bone: number, weight: number]> => {
  let on = 0;
  for (let joint = 1; joint < HEIGHTS.length; joint++) {
    const at = HEIGHTS[joint] ?? 0;
    if (Math.abs(height - at) < BAND) {
      const across = (height - (at - BAND)) / (2 * BAND);
      return [
        [joint - 1, 1 - across],
        [joint, across],
      ];
    }
    if (height >= at) {
      on = joint;
    }
  }
  return [[on, 1]];
};

/** Her morph targets, each by name, with how far it moves a point of her body out from her middle at a whole, by the point's height and how near her front it is, from 0 at her sides to 1. */
const MORPHS: ReadonlyArray<
  readonly [name: string, move: (height: number, front: number) => number]
> = [
  ['chest-fuller', (height, front) => 0.06 * swelling(height - 1.32, 0.13) * front * front],
  ['hips-wider', (height) => 0.05 * swelling(height - 0.92, 0.18)],
  ['hips-narrower', (height) => -0.035 * swelling(height - 0.92, 0.18)],
];

/** Her bones, standing as her heights have them, each named. */
const bones = () => {
  const made = ['root', 'knee', 'hips', 'chest', 'head'].map((name) => {
    const bone = new Three.Bone();
    bone.name = name;
    return bone;
  });
  made.forEach((bone, index) => {
    const parent = made[index - 1];
    if (parent !== undefined) {
      bone.position.y = (HEIGHTS[index] ?? 0) - (HEIGHTS[index - 1] ?? 0);
      parent.add(bone);
    }
  });
  return made;
};

/** The figure, as delivered: her body, skinned to her bones and carrying her morph targets, within a group as a loaded model is. */
export const figure = (): Three.Group => {
  const outline: Array<Three.Vector2> = [];
  for (let height = 0; height < TALL; height += 0.02) {
    outline.push(new Three.Vector2(reachAt(height), height));
  }
  outline.push(new Three.Vector2(0, TALL));
  const geometry = new Three.LatheGeometry(outline, 48);
  const position = geometry.getAttribute('position');
  const skinIndex: Array<number> = [];
  const skinWeight: Array<number> = [];
  const moves = MORPHS.map(() => Array.from({ length: position.count * 3 }, () => 0));
  for (let at = 0; at < position.count; at++) {
    const x = position.getX(at);
    const height = position.getY(at);
    const z = position.getZ(at);
    const reach = Math.hypot(x, z);
    const outX = reach === 0 ? 0 : x / reach;
    const outZ = reach === 0 ? 0 : z / reach;
    const held = heldAt(height);
    for (let k = 0; k < 4; k++) {
      const [bone, weight] = held[k] ?? [0, 0];
      skinIndex.push(bone);
      skinWeight.push(weight);
    }
    MORPHS.forEach(([, move], index) => {
      const by = move(height, Math.max(outZ, 0));
      const moved = moves[index];
      if (moved !== undefined) {
        moved[at * 3] = outX * by;
        moved[at * 3 + 2] = outZ * by;
      }
    });
  }
  geometry.setAttribute('skinIndex', new Three.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new Three.Float32BufferAttribute(skinWeight, 4));
  // As a loaded model's are: each target how far it moves her points, by name.
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = MORPHS.map(([name], index) => {
    const moved = new Three.Float32BufferAttribute(moves[index] ?? [], 3);
    moved.name = name;
    return moved;
  });
  geometry.computeVertexNormals();
  const body = new Three.SkinnedMesh(
    geometry,
    new Three.MeshStandardNodeMaterial({ color: 0xd9a88f, roughness: 0.6 }),
  );
  body.name = BODY;
  const skeleton = bones();
  const [root] = skeleton;
  if (root !== undefined) {
    body.add(root);
  }
  const model = new Three.Group();
  model.add(body);
  body.bind(new Three.Skeleton(skeleton));
  return model;
};
