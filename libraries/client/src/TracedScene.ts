import { Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Bvh from '#src/Bvh.ts';

/**
 * A scene as rays are traced through it, in two levels, as ray-tracing hardware holds one: each shape's triangles in a hierarchy of its own, built once and kept while the shape stays as it is, and a hierarchy over the placed shapes, built anew each frame from where they stand now, so what moves costs only the small one. Everything lies flat in arrays of four numbers at a time, as a shader reads them, each hierarchy threaded for a walk with no stack, and `trace` walks them here just as the shader does, so what the shader finds can be told against it.
 */

/** How many numbers each triangle, or each link of a strand, takes: a triangle's three corners, four numbers each, the fourth nothing; a link's start, four numbers, the fourth a whole, which tells it from a triangle; its end, four numbers, the fourth how far about the line between them it reaches; and four more of nothing. */
export const TRIANGLE = 12;

/** How many numbers each placed shape takes: the three rows of what turns the scene into its own space, its colour and its hierarchy's root, the light it gives off and whether it casts a shadow, 1 or 0; what it is made of, a surface 0 or hair 1, how rough it is, how metal, and how it bends light; and, for hair, how much light it takes in, red, green, and blue, and how far its cuticle tilts. */
export const PLACED = 28;

/** What a placed shape is made of, as light meets it: a surface, as rough and as metal as it is, from nothing to a whole; or hair, taking light in as `absorption` says for every strand's width it goes through, as rough along it as it is, its cuticle tilted as far as `tilt` says, in radians, bending light as `ior` says. */
export type Material =
  | { readonly _tag: 'Surface'; readonly roughness: number; readonly metalness: number }
  | {
      readonly _tag: 'Hair';
      readonly absorption: readonly [number, number, number];
      readonly roughness: number;
      readonly tilt: number;
      readonly ior: number;
    };

/** A surface wholly rough and not metal at all, as what says nothing of how it is made is taken to be. */
export const matte: Material = { _tag: 'Surface', roughness: 1, metalness: 0 };

/** A shape rays meet, in its own space, with its hierarchy: of triangles, such as a body's skin, or of strands, such as its hair. */
export type Shape = Triangles | Strands;

/** A shape of triangles: three corners of three numbers each a triangle. */
export interface Triangles {
  readonly _tag: 'Triangles';
  readonly positions: Float32Array;
  readonly hierarchy: Bvh.Hierarchy;
}

/** A shape of strands, as round as they are wide, as each link of them lies: where it starts, where it ends, and how far about that line it reaches, seven numbers a link. */
export interface Strands {
  readonly _tag: 'Strands';
  readonly segments: Float32Array;
  readonly hierarchy: Bvh.Hierarchy;
}

/** How many triangles, or links of strands, `shape` holds. */
export const countOf = (shape: Shape): number =>
  shape._tag === 'Triangles' ? shape.positions.length / 9 : shape.segments.length / 7;

/** A shape's triangles, three corners of three numbers each a triangle, in its own space, with their hierarchy built over them. */
export const shapeOf = (positions: Float32Array): Triangles => ({
  _tag: 'Triangles',
  positions,
  hierarchy: Bvh.build(Bvh.trianglesBoxes(positions), positions.length / 9),
});

/** Moves a shape's triangles to `positions`, its hierarchy refitted rather than built anew: for a shape whose triangles moved but stay together, such as a body bent by its bones. */
export const moved = (shape: Triangles, positions: Float32Array): Triangles => {
  const hierarchy = { nodes: shape.hierarchy.nodes.slice(), order: shape.hierarchy.order };
  Bvh.refit(hierarchy, Bvh.trianglesBoxes(positions));
  return { _tag: 'Triangles', positions, hierarchy };
};

/** Strands through `points`, three numbers a point, `points` of them each, as wide at each point as `widths` says, in their own space, each link from a point to the next as wide as the two ends are on average, with their hierarchy built over them. */
export const strandsOf = (
  points: Float32Array,
  widths: Float32Array,
  perStrand: number,
): Strands => {
  const count = points.length / 3;
  const links: Array<number> = [];
  for (let point = 0; point < count; point += 1) {
    if (point % perStrand === perStrand - 1) {
      continue;
    }
    links.push(
      points[point * 3] ?? 0,
      points[point * 3 + 1] ?? 0,
      points[point * 3 + 2] ?? 0,
      points[point * 3 + 3] ?? 0,
      points[point * 3 + 4] ?? 0,
      points[point * 3 + 5] ?? 0,
      ((widths[point] ?? 0) + (widths[point + 1] ?? 0)) / 4,
    );
  }
  const segments = new Float32Array(links);
  return {
    _tag: 'Strands',
    segments,
    hierarchy: Bvh.build(Bvh.segmentsBoxes(segments), segments.length / 7),
  };
};

/** A shape placed in the scene: which shape, where, by its matrix from its own space into the scene's, its colour and the light it gives off, in linear colours, whether it casts a shadow, and what it is made of, `matte` unless said. */
export interface Placed {
  readonly shape: number;
  readonly matrix: Three.Matrix4;
  readonly colour: readonly [number, number, number];
  readonly emissive: readonly [number, number, number];
  readonly casts: boolean;
  readonly material?: Material;
}

/** The scene laid flat: every shape's hierarchy one after another, their triangles in the order their leaves name them, the placed shapes in the order the top hierarchy's leaves name them, and that hierarchy. */
export interface Flat {
  readonly shapeNodes: Float32Array;
  readonly triangles: Float32Array;
  readonly placed: Float32Array;
  readonly placedNodes: Float32Array;
  readonly placedCount: number;
}

/** Lays `shapes` flat, their nodes naming where their children and triangles lie among all of them. */
export const flattenShapes = (
  shapes: ReadonlyArray<Shape>,
): {
  readonly shapeNodes: Float32Array;
  readonly triangles: Float32Array;
  readonly roots: ReadonlyArray<number>;
} => {
  const threads = shapes.map(({ hierarchy }) => Bvh.threaded(hierarchy));
  const nodeCount = threads.reduce((sum, thread) => sum + thread.length, 0);
  const triangleCount = shapes.reduce((sum, shape) => sum + countOf(shape), 0);
  const shapeNodes = new Float32Array(nodeCount);
  const triangles = new Float32Array(triangleCount * TRIANGLE);
  const roots: Array<number> = [];
  let nodeAt = 0;
  let triangleAt = 0;
  shapes.forEach((shape, index) => {
    const { hierarchy } = shape;
    const thread = threads[index] ?? new Float32Array(0);
    const firstNode = nodeAt / Bvh.THREADED;
    roots.push(firstNode);
    shapeNodes.set(thread, nodeAt);
    for (let node = 0; node < thread.length / Bvh.THREADED; node += 1) {
      const at = nodeAt + node * Bvh.THREADED;
      const after = shapeNodes[at + 3] ?? -1;
      // The node after the last of a shape's stays -1: the walk through that shape ends there.
      shapeNodes[at + 3] = after === -1 ? -1 : after + firstNode;
      shapeNodes[at + 8] = (shapeNodes[at + 8] ?? 0) + triangleAt;
    }
    for (let at = 0; at < hierarchy.order.length; at += 1) {
      const item = hierarchy.order[at] ?? 0;
      const base = (triangleAt + at) * TRIANGLE;
      if (shape._tag === 'Strands') {
        for (let axis = 0; axis < 3; axis += 1) {
          triangles[base + axis] = shape.segments[item * 7 + axis] ?? 0;
          triangles[base + 4 + axis] = shape.segments[item * 7 + 3 + axis] ?? 0;
        }
        triangles[base + 3] = 1;
        triangles[base + 7] = shape.segments[item * 7 + 6] ?? 0;
        continue;
      }
      for (let corner = 0; corner < 3; corner += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          triangles[base + corner * 4 + axis] = shape.positions[item * 9 + corner * 3 + axis] ?? 0;
        }
      }
    }
    nodeAt += thread.length;
    triangleAt += hierarchy.order.length;
  });
  return { shapeNodes, triangles, roots };
};

const corner = new Three.Vector3();
const inverse = new Three.Matrix4();

/** The box in the scene that holds `box`, a box in a shape's own space, placed by `matrix`. */
const placedBox = (box: Bvh.Box, matrix: Three.Matrix4) => {
  const least = [Infinity, Infinity, Infinity];
  const greatest = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < 8; index += 1) {
    corner
      .set(
        index & 1 ? box.max[0] : box.min[0],
        index & 2 ? box.max[1] : box.min[1],
        index & 4 ? box.max[2] : box.min[2],
      )
      .applyMatrix4(matrix);
    least[0] = Math.min(least[0] ?? 0, corner.x);
    least[1] = Math.min(least[1] ?? 0, corner.y);
    least[2] = Math.min(least[2] ?? 0, corner.z);
    greatest[0] = Math.max(greatest[0] ?? 0, corner.x);
    greatest[1] = Math.max(greatest[1] ?? 0, corner.y);
    greatest[2] = Math.max(greatest[2] ?? 0, corner.z);
  }
  return [...least, ...greatest];
};

/** Lays the shapes placed as `placed` flat, over `shapes` laid flat already: the hierarchy over them built anew, from where they stand now. A shape with no triangles is left out, as no ray meets it. */
export const flattenPlaced = (
  shapes: ReadonlyArray<Shape>,
  roots: ReadonlyArray<number>,
  placed: ReadonlyArray<Placed>,
): {
  readonly placed: Float32Array;
  readonly placedNodes: Float32Array;
  readonly count: number;
} => {
  const kept = placed.filter(({ shape }) => {
    const one = shapes[shape];
    return one !== undefined && countOf(one) > 0;
  });
  const boxes = new Float32Array(
    kept.flatMap(({ shape, matrix }) => {
      const hierarchy = shapes[shape]?.hierarchy;
      return hierarchy === undefined ? [0, 0, 0, 0, 0, 0] : placedBox(Bvh.boxOf(hierarchy), matrix);
    }),
  );
  const hierarchy = Bvh.build(boxes, kept.length);
  const flat = new Float32Array(kept.length * PLACED);
  hierarchy.order.forEach((index, at) => {
    const one = kept[index];
    if (one === undefined) {
      return;
    }
    inverse.copy(one.matrix).invert();
    const e = inverse.elements;
    const base = at * PLACED;
    // The rows of the inverse, as a shader multiplies a point by them: Three keeps its matrices by columns.
    flat.set([e[0] ?? 0, e[4] ?? 0, e[8] ?? 0, e[12] ?? 0], base);
    flat.set([e[1] ?? 0, e[5] ?? 0, e[9] ?? 0, e[13] ?? 0], base + 4);
    flat.set([e[2] ?? 0, e[6] ?? 0, e[10] ?? 0, e[14] ?? 0], base + 8);
    flat.set([...one.colour, roots[one.shape] ?? 0], base + 12);
    flat.set([...one.emissive, one.casts ? 1 : 0], base + 16);
    const material = one.material ?? matte;
    if (material._tag === 'Surface') {
      flat.set([0, material.roughness, material.metalness, 0, 0, 0, 0, 0], base + 20);
    } else {
      flat.set(
        [1, material.roughness, 0, material.ior, ...material.absorption, material.tilt],
        base + 20,
      );
    }
  });
  return { placed: flat, placedNodes: Bvh.threaded(hierarchy), count: kept.length };
};

/** `shapes` placed as `placed`, laid flat. */
export const flatten = (shapes: ReadonlyArray<Shape>, placed: ReadonlyArray<Placed>): Flat => {
  const { shapeNodes, triangles, roots } = flattenShapes(shapes);
  const top = flattenPlaced(shapes, roots, placed);
  return {
    shapeNodes,
    triangles,
    placed: top.placed,
    placedNodes: top.placedNodes,
    placedCount: top.count,
  };
};

/** How near a ray's start a triangle must be passed to count: nearer, it is the surface the ray left. */
export const NEAREST = 1e-4;

/** Whether the ray from `origin` going `invert`'s inverse meets the box of node `node` of `nodes`, threaded, before `far`. */
const entered = (
  nodes: Float32Array,
  node: number,
  origin: readonly [number, number, number],
  invert: readonly [number, number, number],
  far: number,
) => {
  const at = node * Bvh.THREADED;
  let near = 0;
  let farthest = far;
  for (let axis = 0; axis < 3; axis += 1) {
    const from = origin[axis] ?? 0;
    const by = invert[axis] ?? 0;
    const low = ((nodes[at + axis] ?? 0) - from) * by;
    const high = ((nodes[at + 4 + axis] ?? 0) - from) * by;
    near = Math.max(near, Math.min(low, high));
    farthest = Math.min(farthest, Math.max(low, high));
  }
  return near <= farthest;
};

/** The inverse of `part`, a part of nothing taken as the least there is, so a box's sides a ray runs along are never crossed. */
const inverseOf = (part: number) =>
  1 / (Math.abs(part) < 1e-12 ? (part < 0 ? -1e-12 : 1e-12) : part);

/** The inverse of each part of `direction`. */
const inverted = (
  direction: readonly [number, number, number],
): readonly [number, number, number] => [
  inverseOf(direction[0]),
  inverseOf(direction[1]),
  inverseOf(direction[2]),
];

/** How far along the ray from `origin` going `direction`, as long as `direction` is, it meets the link of a strand starting at `at` of `triangles`, a capsule about the line from its start to its end, if it does: by Quílez's test, its round ends as spheres. */
const meetsLink = (
  triangles: Float32Array,
  at: number,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
) => {
  const long = Math.hypot(direction[0], direction[1], direction[2]);
  if (long === 0) {
    return Infinity;
  }
  const way = [direction[0] / long, direction[1] / long, direction[2] / long];
  const a = [triangles[at] ?? 0, triangles[at + 1] ?? 0, triangles[at + 2] ?? 0];
  const b = [triangles[at + 4] ?? 0, triangles[at + 5] ?? 0, triangles[at + 6] ?? 0];
  const radius = triangles[at + 7] ?? 0;
  const dot = (u: ReadonlyArray<number>, v: ReadonlyArray<number>) =>
    (u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0);
  const ba = [0, 1, 2].map((axis) => (b[axis] ?? 0) - (a[axis] ?? 0));
  const oa = [0, 1, 2].map((axis) => (origin[axis] ?? 0) - (a[axis] ?? 0));
  const baba = dot(ba, ba);
  const bard = dot(ba, way);
  const baoa = dot(ba, oa);
  const rdoa = dot(way, oa);
  const oaoa = dot(oa, oa);
  const sideA = baba - bard * bard;
  const sideB = baba * rdoa - baoa * bard;
  const sideC = baba * oaoa - baoa * baoa - radius * radius * baba;
  const side = sideB * sideB - sideA * sideC;
  // Along its side, where the ray is not along the line itself; past either end, the nearer of its round ends.
  const alongSide = (() => {
    if (sideA <= 1e-12 || side < 0) {
      return Infinity;
    }
    const t = (-sideB - Math.sqrt(side)) / sideA;
    const along = baoa + t * bard;
    return along > 0 && along < baba ? t : Infinity;
  })();
  const roundEnd = (end: ReadonlyArray<number>) => {
    const from = [0, 1, 2].map((axis) => (origin[axis] ?? 0) - (end[axis] ?? 0));
    const endB = dot(way, from);
    const round = endB * endB - (dot(from, from) - radius * radius);
    return round > 0 ? -endB - Math.sqrt(round) : Infinity;
  };
  const found = Math.min(alongSide, roundEnd(a), roundEnd(b));
  const distance = found / long;
  return distance > NEAREST ? distance : Infinity;
};

/** How far along the ray from `origin` going `direction` it meets the triangle at `triangle` of `triangles`, if it does: by Möller and Trumbore's test. */
const meets = (
  triangles: Float32Array,
  triangle: number,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
) => {
  const at = triangle * TRIANGLE;
  if ((triangles[at + 3] ?? 0) === 1) {
    return meetsLink(triangles, at, origin, direction);
  }
  const a = [triangles[at] ?? 0, triangles[at + 1] ?? 0, triangles[at + 2] ?? 0];
  const e1 = [0, 1, 2].map((axis) => (triangles[at + 4 + axis] ?? 0) - (a[axis] ?? 0));
  const e2 = [0, 1, 2].map((axis) => (triangles[at + 8 + axis] ?? 0) - (a[axis] ?? 0));
  const cross = (u: ReadonlyArray<number>, v: ReadonlyArray<number>) => [
    (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
    (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
    (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
  ];
  const dot = (u: ReadonlyArray<number>, v: ReadonlyArray<number>) =>
    (u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0);
  const p = cross(direction, e2);
  const determinant = dot(e1, p);
  if (Math.abs(determinant) < 1e-12) {
    return Infinity;
  }
  const scale = 1 / determinant;
  const s = [origin[0] - (a[0] ?? 0), origin[1] - (a[1] ?? 0), origin[2] - (a[2] ?? 0)];
  const u = dot(s, p) * scale;
  if (u < 0 || u > 1) {
    return Infinity;
  }
  const q = cross(s, e1);
  const v = dot(direction, q) * scale;
  if (v < 0 || u + v > 1) {
    return Infinity;
  }
  const t = dot(e2, q) * scale;
  return t > NEAREST ? t : Infinity;
};

/** What a ray meets first: how far along it, and which placed shape, by its place in the flat scene. */
export interface Hit {
  readonly distance: number;
  readonly placed: number;
}

/** What a ray meets: anything placed, or, traced for a shadow, only what casts one. */
export type Meets = 'Anything' | 'Casting';

/**
 * What the ray from `origin` going `direction` meets first in `flat` before `far`, if anything, of what it is `seeking`, as far along it as `direction` is long: the top hierarchy walked to the shapes whose boxes the ray meets, the ray turned into each shape's own space, and the shape's hierarchy walked to the triangles in the boxes it meets, each walk threaded, with no stack. Boxes the ray meets only past what it already met are passed by.
 */
export const trace = (
  flat: Flat,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  far: number,
  seeking: Meets = 'Anything',
): Option.Option<Hit> => {
  if (flat.placedCount === 0) {
    return Option.none();
  }
  const found = { distance: far, placed: -1 };
  const invert = inverted(direction);
  let node = 0;
  while (node !== -1) {
    const at = node * Bvh.THREADED;
    const after = flat.placedNodes[at + 3] ?? -1;
    if (!entered(flat.placedNodes, node, origin, invert, found.distance)) {
      node = after;
      continue;
    }
    const count = flat.placedNodes[at + 7] ?? 0;
    if (count === 0) {
      node += 1;
      continue;
    }
    const first = flat.placedNodes[at + 8] ?? 0;
    for (let placed = first; placed < first + count; placed += 1) {
      const base = placed * PLACED;
      if (seeking === 'Casting' && (flat.placed[base + 19] ?? 0) === 0) {
        continue;
      }
      const row = (offset: number, point: readonly [number, number, number], w: number) =>
        (flat.placed[base + offset] ?? 0) * point[0] +
        (flat.placed[base + offset + 1] ?? 0) * point[1] +
        (flat.placed[base + offset + 2] ?? 0) * point[2] +
        (flat.placed[base + offset + 3] ?? 0) * w;
      const localOrigin = [row(0, origin, 1), row(4, origin, 1), row(8, origin, 1)] as const;
      const localDirection = [
        row(0, direction, 0),
        row(4, direction, 0),
        row(8, direction, 0),
      ] as const;
      const localInvert = inverted(localDirection);
      let shapeNode = flat.placed[base + 15] ?? 0;
      while (shapeNode !== -1) {
        const shapeAt = shapeNode * Bvh.THREADED;
        const shapeAfter = flat.shapeNodes[shapeAt + 3] ?? -1;
        if (!entered(flat.shapeNodes, shapeNode, localOrigin, localInvert, found.distance)) {
          shapeNode = shapeAfter;
          continue;
        }
        const triangles = flat.shapeNodes[shapeAt + 7] ?? 0;
        if (triangles === 0) {
          shapeNode += 1;
          continue;
        }
        const firstTriangle = flat.shapeNodes[shapeAt + 8] ?? 0;
        for (let triangle = firstTriangle; triangle < firstTriangle + triangles; triangle += 1) {
          const distance = meets(flat.triangles, triangle, localOrigin, localDirection);
          if (distance < found.distance) {
            found.distance = distance;
            found.placed = placed;
          }
        }
        shapeNode = shapeAfter;
      }
    }
    node = after;
  }
  return found.placed === -1
    ? Option.none()
    : Option.some({ distance: found.distance, placed: found.placed });
};

/** Gathers a scene as Three.js draws it into a scene for rays, frame after frame: each shape built once and kept while its geometry stays as it is, posed anew each frame where its bones or morphs bend it. */
export interface Gathering {
  /** `scene` as `camera` sees drawn now, laid flat: every visible mesh it draws whole, not see-through, on a layer the camera sees, each instance of an instanced mesh on its own. */
  readonly gather: (scene: Three.Scene, camera: Three.Camera) => Flat;
}

const vertex = new Three.Vector3();
const instance = new Three.Matrix4();

/** The triangles `mesh` draws, three corners of three numbers each, in its own space: as its geometry holds them, or posed as its bones and morphs bend them now when `posed`. */
const trianglesOf = (mesh: Three.Mesh, posed: boolean): Float32Array => {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const available = index === null ? position.count : index.count;
  const start = Math.max(geometry.drawRange.start, 0);
  const end = Math.min(available, start + geometry.drawRange.count);
  const corners = Math.max(Math.floor((end - start) / 3) * 3, 0);
  const positions = new Float32Array(corners * 3);
  for (let corner = 0; corner < corners; corner += 1) {
    const at = index === null ? start + corner : index.getX(start + corner);
    if (posed) {
      mesh.getVertexPosition(at, vertex);
    } else {
      vertex.fromBufferAttribute(position, at);
    }
    positions[corner * 3] = vertex.x;
    positions[corner * 3 + 1] = vertex.y;
    positions[corner * 3 + 2] = vertex.z;
  }
  return positions;
};

/** The material `mesh` draws its first triangles with. */
const materialOf = (mesh: Three.Mesh): Three.Material | undefined =>
  Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

/** A colour of `material`'s named `key`, in linear parts, if it has one, scaled by `scale`. */
const colourOf = (
  material: Three.Material,
  key: 'color' | 'emissive',
  scale: number,
): Option.Option<readonly [number, number, number]> => {
  const colour: unknown = Reflect.get(material, key);
  return colour instanceof Three.Color
    ? Option.some([colour.r * scale, colour.g * scale, colour.b * scale])
    : Option.none();
};

/** What `material` is made of as light meets it: a surface as rough and as metal as it says, wholly rough and not metal where it says not. */
const surfaceOf = (material: Three.Material): Material => {
  const roughness: unknown = Reflect.get(material, 'roughness');
  const metalness: unknown = Reflect.get(material, 'metalness');
  return {
    _tag: 'Surface',
    roughness: typeof roughness === 'number' ? roughness : 1,
    metalness: typeof metalness === 'number' ? metalness : 0,
  };
};

/** How bright `material` gives off its light, once if it says not. */
const emissiveIntensityOf = (material: Three.Material): number => {
  const intensity: unknown = Reflect.get(material, 'emissiveIntensity');
  return typeof intensity === 'number' ? intensity : 1;
};

/** Whether `mesh` is bent each frame, by bones or by morphs, so its shape is posed anew each frame. */
const isPosed = (mesh: Three.Mesh) =>
  mesh instanceof Three.SkinnedMesh || mesh.geometry.morphAttributes.position !== undefined;

/** How often `attribute` was written: an interleaved one, as often as the buffer it lies in. */
const writes = (attribute: Three.BufferAttribute | Three.InterleavedBufferAttribute) =>
  attribute instanceof Three.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;

/** How far a geometry has changed: its positions' and its index's versions, and what it draws of them. */
const versionOf = (geometry: Three.BufferGeometry) =>
  `${writes(geometry.getAttribute('position'))}:${geometry.getIndex()?.version ?? -1}:${geometry.drawRange.start}:${geometry.drawRange.count}`;

/** A gathering of scenes for rays, which keeps the shapes it built while they stay as they are. */
export const gathering = (): Gathering => {
  const built = new WeakMap<
    Three.BufferGeometry,
    { readonly shape: Triangles; readonly version: string }
  >();
  const posed = new WeakMap<Three.Mesh, Triangles>();
  const laid: {
    shapes: ReadonlyArray<Shape>;
    flat: ReturnType<typeof flattenShapes>;
  } = { shapes: [], flat: flattenShapes([]) };

  /** The shape `mesh` draws now: kept, posed anew, or built for a geometry that changed. */
  const drawnShapeOf = (mesh: Three.Mesh): Shape => {
    if (isPosed(mesh)) {
      const positions = trianglesOf(mesh, true);
      const before = posed.get(mesh);
      // Bent but the same triangles, it is refitted; with others, built anew.
      const shape =
        before !== undefined && before.positions.length === positions.length
          ? moved(before, positions)
          : shapeOf(positions);
      posed.set(mesh, shape);
      return shape;
    }
    const version = versionOf(mesh.geometry);
    const kept = built.get(mesh.geometry);
    if (kept !== undefined && kept.version === version) {
      return kept.shape;
    }
    const shape = shapeOf(trianglesOf(mesh, false));
    built.set(mesh.geometry, { shape, version });
    return shape;
  };

  return {
    gather: (scene, camera) => {
      scene.updateMatrixWorld();
      const shapes: Array<Shape> = [];
      const indices = new Map<Shape, number>();
      const placed: Array<Placed> = [];
      scene.traverseVisible((object) => {
        if (!(object instanceof Three.Mesh) || !object.layers.test(camera.layers)) {
          return;
        }
        const material = materialOf(object);
        if (material === undefined || material.transparent || !material.visible) {
          return;
        }
        const shape = drawnShapeOf(object);
        const known = indices.get(shape);
        const index = known ?? shapes.length;
        if (known === undefined) {
          indices.set(shape, index);
          shapes.push(shape);
        }
        const colour = Option.getOrElse(colourOf(material, 'color', 1), () => [1, 1, 1] as const);
        const emissive = Option.getOrElse(
          colourOf(material, 'emissive', emissiveIntensityOf(material)),
          () => [0, 0, 0] as const,
        );
        if (object instanceof Three.InstancedMesh) {
          for (let at = 0; at < object.count; at += 1) {
            object.getMatrixAt(at, instance);
            placed.push({
              shape: index,
              matrix: new Three.Matrix4().multiplyMatrices(object.matrixWorld, instance),
              colour,
              emissive,
              casts: object.castShadow,
              material: surfaceOf(material),
            });
          }
          return;
        }
        placed.push({
          shape: index,
          matrix: object.matrixWorld.clone(),
          colour,
          emissive,
          casts: object.castShadow,
          material: surfaceOf(material),
        });
      });
      // The shapes are laid flat again only when they changed: a moving scene of shapes that stay as they are lays only what is placed.
      const same =
        shapes.length === laid.shapes.length &&
        shapes.every((shape, index) => shape === laid.shapes[index]);
      if (!same) {
        laid.shapes = shapes;
        laid.flat = flattenShapes(shapes);
      }
      const top = flattenPlaced(shapes, laid.flat.roots, placed);
      return {
        shapeNodes: laid.flat.shapeNodes,
        triangles: laid.flat.triangles,
        placed: top.placed,
        placedNodes: top.placedNodes,
        placedCount: top.count,
      };
    },
  };
};
