import { describe, expect, it } from '@effect/vitest';
import { Quaternion, Strands } from '@egonitida/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Hairing from '#src/Hairing.ts';
import * as TracedScene from '#src/TracedScene.ts';

/** A stream of numbers from 0 to 1 that is the same for the same seed. */
const numbers = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

/** `count` small triangles scattered through a cube two units across about the middle. */
const scatteredTriangles = (count: number, next: () => number) =>
  new Float32Array(
    Array.from({ length: count }, () => {
      const at = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1];
      return Array.from({ length: 3 }, () => at.map((part) => part + (next() - 0.5) * 0.4)).flat();
    }).flat(),
  );

/** Where the ray from `origin` going `direction` meets the triangle `a`, `b`, `c` in the scene, by Three's own test, if it does. */
const meetsByThree = (
  origin: Three.Vector3,
  direction: Three.Vector3,
  a: Three.Vector3,
  b: Three.Vector3,
  c: Three.Vector3,
) => {
  const at = new Three.Ray(origin, direction).intersectTriangle(
    a,
    b,
    c,
    false,
    new Three.Vector3(),
  );
  return at === null ? Infinity : at.sub(origin).length() / direction.length();
};

/** What the ray meets first among every placed shape's every triangle, each tried in turn. */
const bruteForce = (
  shapes: ReadonlyArray<Float32Array>,
  placed: ReadonlyArray<TracedScene.Placed>,
  origin: Three.Vector3,
  direction: Three.Vector3,
  far: number,
) => {
  let best = { distance: far, shape: -1, matrix: -1 };
  placed.forEach(({ shape, matrix }, index) => {
    const positions = shapes[shape] ?? new Float32Array(0);
    for (let triangle = 0; triangle < positions.length / 9; triangle += 1) {
      const [a, b, c] = [0, 1, 2].map((corner) =>
        new Three.Vector3().fromArray(positions, triangle * 9 + corner * 3).applyMatrix4(matrix),
      );
      if (a === undefined || b === undefined || c === undefined) {
        continue;
      }
      const distance = meetsByThree(origin, direction, a, b, c);
      if (distance > TracedScene.NEAREST && distance < best.distance) {
        best = { distance, shape, matrix: index };
      }
    }
  });
  return best;
};

/** A matrix turning, stretching, and moving a shape somewhere in a cube ten units across. */
const placement = (next: () => number) =>
  new Three.Matrix4().compose(
    new Three.Vector3(next() * 10 - 5, next() * 10 - 5, next() * 10 - 5),
    new Three.Quaternion().setFromEuler(new Three.Euler(next() * 6, next() * 6, next() * 6)),
    new Three.Vector3(0.5 + next(), 0.5 + next(), 0.5 + next()),
  );

describe('a scene as rays are traced through it', () => {
  it('meets first what every triangle tried in turn meets first, however the shapes are placed', () => {
    const next = numbers(3);
    const shapes = [scatteredTriangles(60, next), scatteredTriangles(25, next)];
    const placed = Array.from({ length: 12 }, (_, index) => ({
      shape: index % 2,
      matrix: placement(next),
      colour: [index / 12, 0.5, 1] as const,
      emissive: [0, 0, 0] as const,
      casts: true,
    }));
    const flat = TracedScene.flatten(
      shapes.map((positions) => TracedScene.shapeOf(positions)),
      placed,
    );

    for (let ray = 0; ray < 400; ray += 1) {
      const origin = new Three.Vector3(next() * 16 - 8, next() * 16 - 8, next() * 16 - 8);
      const direction = new Three.Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize();
      const expected = bruteForce(shapes, placed, origin, direction, 30);
      const traced = TracedScene.trace(
        flat,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
        30,
      );

      expect(Option.isSome(traced)).toBe(expected.shape !== -1);
      if (Option.isSome(traced)) {
        expect(traced.value.distance).toBeCloseTo(expected.distance, 3);
        const colour = flat.placed[traced.value.placed * TracedScene.PLACED + 12];
        expect(colour).toBeCloseTo(placed[expected.matrix]?.colour[0] ?? -1, 5);
      }
    }
  });

  it('meets nothing past how far it looks, nor the surface it starts on', () => {
    const square = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const flat = TracedScene.flatten(
      [TracedScene.shapeOf(square)],
      [
        {
          shape: 0,
          matrix: new Three.Matrix4(),
          colour: [1, 1, 1],
          emissive: [0, 0, 0],
          casts: true,
        },
      ],
    );

    const ahead = TracedScene.trace(flat, [0, 0, 5], [0, 0, -1], 10);
    const tooFar = TracedScene.trace(flat, [0, 0, 5], [0, 0, -1], 4);
    const leaving = TracedScene.trace(flat, [0, 0, 0], [0, 0, 1], 10);
    const along = TracedScene.trace(flat, [-5, 0, 1], [1, 0, 0], 10);

    expect(Option.map(ahead, ({ distance }) => distance)).toEqual(Option.some(5));
    expect(tooFar).toEqual(Option.none());
    expect(leaving).toEqual(Option.none());
    expect(along).toEqual(Option.none());
  });

  it('meets nothing in a scene with nothing placed, or nothing but shapes with no triangles', () => {
    const empty = TracedScene.flatten([TracedScene.shapeOf(new Float32Array(0))], []);
    const hollow = TracedScene.flatten(
      [TracedScene.shapeOf(new Float32Array(0))],
      [
        {
          shape: 0,
          matrix: new Three.Matrix4(),
          colour: [1, 1, 1],
          emissive: [0, 0, 0],
          casts: true,
        },
      ],
    );

    expect(TracedScene.trace(empty, [0, 0, 0], [0, 0, 1], 10)).toEqual(Option.none());
    expect(hollow.placedCount).toBe(0);
    expect(TracedScene.trace(hollow, [0, 0, 0], [0, 0, 1], 10)).toEqual(Option.none());
  });

  it('follows a shape whose triangles moved, its hierarchy refitted', () => {
    const square = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const shape = TracedScene.shapeOf(square);
    const lifted = TracedScene.moved(
      shape,
      square.map((value, index) => (index % 3 === 2 ? value + 3 : value)),
    );
    const flat = TracedScene.flatten(
      [lifted],
      [
        {
          shape: 0,
          matrix: new Three.Matrix4(),
          colour: [1, 1, 1],
          emissive: [0, 0, 0],
          casts: true,
        },
      ],
    );

    const traced = TracedScene.trace(flat, [0, 0, 5], [0, 0, -1], 10);

    expect(Option.map(traced, ({ distance }) => distance)).toEqual(Option.some(2));
  });
});

describe('a scene gathered from what Three.js draws', () => {
  /** A box a unit across, coloured `colour`, standing at `at`. */
  const box = (colour: number, at: readonly [number, number, number]) => {
    const mesh = new Three.Mesh(
      new Three.BoxGeometry(1, 1, 1),
      new Three.MeshStandardMaterial({ color: colour, emissive: 0x000000 }),
    );
    mesh.position.set(...at);
    return mesh;
  };
  const camera = new Three.PerspectiveCamera();

  /** How far the ray from `origin` going `direction` meets something in `flat`, if it does. */
  const distanceIn = (
    flat: TracedScene.Flat,
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
  ) => Option.map(TracedScene.trace(flat, origin, direction, 100), ({ distance }) => distance);

  it('holds every mesh that is drawn, where it stands now, in its colour', () => {
    const scene = new Three.Scene();
    const red = box(0xff0000, [0, 0, -5]);
    scene.add(red);
    const gathering = TracedScene.gathering();

    const first = gathering.gather(scene, camera);
    red.position.z = -8;
    const moved = gathering.gather(scene, camera);

    expect(Option.getOrThrow(distanceIn(first, [0, 0, 0], [0, 0, -1]))).toBeCloseTo(4.5);
    expect(Option.getOrThrow(distanceIn(moved, [0, 0, 0], [0, 0, -1]))).toBeCloseTo(7.5);
    const hit = Option.getOrThrow(TracedScene.trace(moved, [0, 0, 0], [0, 0, -1], 100));
    expect(moved.placed[hit.placed * TracedScene.PLACED + 12]).toBeCloseTo(1);
    expect(moved.placed[hit.placed * TracedScene.PLACED + 13]).toBeCloseTo(0);
  });

  it('leaves out what is not drawn: hidden, see-through, or on a layer the camera does not see', () => {
    const scene = new Three.Scene();
    const hidden = box(0xffffff, [0, 0, -3]);
    hidden.visible = false;
    const glass = box(0xffffff, [0, 0, -4]);
    glass.material.transparent = true;
    const elsewhere = box(0xffffff, [0, 0, -5]);
    elsewhere.layers.set(3);
    const shown = box(0xffffff, [0, 0, -6]);
    scene.add(hidden, glass, elsewhere, shown);

    const flat = TracedScene.gathering().gather(scene, camera);

    expect(flat.placedCount).toBe(1);
    expect(Option.getOrThrow(distanceIn(flat, [0, 0, 0], [0, 0, -1]))).toBeCloseTo(5.5);
  });

  it('holds each instance of an instanced mesh where its matrix places it', () => {
    const scene = new Three.Scene();
    const boxes = new Three.InstancedMesh(
      new Three.BoxGeometry(1, 1, 1),
      new Three.MeshStandardMaterial(),
      2,
    );
    boxes.setMatrixAt(0, new Three.Matrix4().makeTranslation(0, 0, -5));
    boxes.setMatrixAt(1, new Three.Matrix4().makeTranslation(3, 0, -5));
    scene.add(boxes);

    const flat = TracedScene.gathering().gather(scene, camera);

    expect(flat.placedCount).toBe(2);
    expect(Option.getOrThrow(distanceIn(flat, [3, 0, 0], [0, 0, -1]))).toBeCloseTo(4.5);
  });

  it('holds a skinned mesh as its bones bend it now', () => {
    const scene = new Three.Scene();
    const geometry = new Three.BoxGeometry(1, 1, 1);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'skinIndex',
      new Three.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new Three.Float32BufferAttribute(
        new Float32Array(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()),
        4,
      ),
    );
    const bone = new Three.Bone();
    const body = new Three.SkinnedMesh(geometry, new Three.MeshStandardMaterial());
    body.add(bone);
    body.bind(new Three.Skeleton([bone]));
    body.position.z = -5;
    scene.add(body);
    const gathering = TracedScene.gathering();

    const still = gathering.gather(scene, camera);
    bone.position.z = -2;
    const bent = gathering.gather(scene, camera);

    expect(Option.getOrThrow(distanceIn(still, [0, 0, 0], [0, 0, -1]))).toBeCloseTo(4.5);
    expect(Option.getOrThrow(distanceIn(bent, [0, 0, 0], [0, 0, -1]))).toBeCloseTo(6.5);
  });

  it('builds a shape once for a geometry however many meshes draw it, and again once it changes', () => {
    const scene = new Three.Scene();
    const shared = new Three.BoxGeometry(1, 1, 1);
    const left = new Three.Mesh(shared, new Three.MeshStandardMaterial());
    const right = new Three.Mesh(shared, new Three.MeshStandardMaterial());
    left.position.set(-2, 0, -5);
    right.position.set(2, 0, -5);
    scene.add(left, right);
    const gathering = TracedScene.gathering();

    const first = gathering.gather(scene, camera);
    const again = gathering.gather(scene, camera);
    shared.getAttribute('position').setZ(0, 9);
    shared.getAttribute('position').needsUpdate = true;
    const changed = gathering.gather(scene, camera);

    expect(first.triangles.length / TracedScene.TRIANGLE).toBe(12);
    expect(again.shapeNodes).toBe(first.shapeNodes);
    expect(changed.shapeNodes).not.toBe(first.shapeNodes);
  });
});

describe('a scene traced for its shadows', () => {
  const square = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);

  it('meets only what casts a shadow, when it traces for one, and everything otherwise', () => {
    const flat = TracedScene.flatten(
      [TracedScene.shapeOf(square)],
      [
        {
          shape: 0,
          matrix: new Three.Matrix4().makeTranslation(0, 0, -2),
          colour: [1, 1, 1],
          emissive: [0, 0, 0],
          casts: false,
        },
        {
          shape: 0,
          matrix: new Three.Matrix4().makeTranslation(0, 0, -5),
          colour: [1, 1, 1],
          emissive: [0, 0, 0],
          casts: true,
        },
      ],
    );

    const anything = TracedScene.trace(flat, [0, 0, 0], [0, 0, -1], 10);
    const casting = TracedScene.trace(flat, [0, 0, 0], [0, 0, -1], 10, 'Casting');

    expect(Option.map(anything, ({ distance }) => distance)).toEqual(Option.some(2));
    expect(Option.map(casting, ({ distance }) => distance)).toEqual(Option.some(5));
  });

  it('gathers whether each mesh casts a shadow, as Three.js marks it', () => {
    const scene = new Three.Scene();
    const glow = new Three.Mesh(new Three.BoxGeometry(1, 1, 1), new Three.MeshBasicMaterial());
    glow.position.z = -2;
    const wall = new Three.Mesh(new Three.BoxGeometry(1, 1, 1), new Three.MeshStandardMaterial());
    wall.position.z = -5;
    wall.castShadow = true;
    scene.add(glow, wall);

    const flat = TracedScene.gathering().gather(scene, new Three.PerspectiveCamera());
    const casting = TracedScene.trace(flat, [0, 0, 0], [0, 0, -1], 10, 'Casting');

    expect(Option.map(casting, ({ distance }) => distance)).toEqual(Option.some(4.5));
  });
});

describe('strands as rays meet them', () => {
  /** One strand of two points, along x from -1 to 1, two tenths wide. */
  const strand = TracedScene.strandsOf(
    new Float32Array([-1, 0, 0, 1, 0, 0]),
    new Float32Array([0.2, 0.2]),
    2,
  );
  const placedAt = (shape: number, matrix = new Three.Matrix4()): TracedScene.Placed => ({
    shape,
    matrix,
    colour: [1, 1, 1],
    emissive: [0, 0, 0],
    casts: true,
  });
  const alone = TracedScene.flatten([strand], [placedAt(0)]);
  const hit = (
    flat: TracedScene.Flat,
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
  ) => Option.map(TracedScene.trace(flat, origin, direction, 100), ({ distance }) => distance);

  it('meets a strand from beside it, at its surface', () => {
    expect(hit(alone, [0, 0, 5], [0, 0, -1])).toEqual(Option.some(expect.closeTo(4.9, 6)));
  });

  it('meets a strand at its end, as round as it is wide', () => {
    expect(hit(alone, [3, 0, 0], [-1, 0, 0])).toEqual(Option.some(expect.closeTo(1.9, 6)));
  });

  it('passes a strand by beside it', () => {
    expect(hit(alone, [0, 0.2, 5], [0, 0, -1])).toEqual(Option.none());
  });

  it('meets a strand where it is placed, along a ray of any length', () => {
    const raised = TracedScene.flatten(
      [strand],
      [placedAt(0, new Three.Matrix4().makeTranslation(0, 1, 0))],
    );

    // Two units a step: the surface half as many steps away.
    expect(hit(raised, [0, 1, 5], [0, 0, -2])).toEqual(Option.some(expect.closeTo(2.45, 6)));
  });

  it('meets a strand before a triangle behind it, and the triangle where no strand is', () => {
    const wall = TracedScene.shapeOf(new Float32Array([-5, -5, -1, 5, -5, -1, 0, 5, -1]));
    const both = TracedScene.flatten([strand, wall], [placedAt(0), placedAt(1)]);
    const shapeHit = (origin: readonly [number, number, number]) =>
      Option.map(TracedScene.trace(both, origin, [0, 0, -1], 100), ({ distance }) => distance);

    expect(shapeHit([0, 0, 5])).toEqual(Option.some(expect.closeTo(4.9, 6)));
    expect(shapeHit([0, 2, 5])).toEqual(Option.some(expect.closeTo(6, 6)));
  });
});

describe('what a traced scene holds of how its shapes are made', () => {
  const square = TracedScene.shapeOf(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]));
  const placedWith = (material: TracedScene.Material): TracedScene.Placed => ({
    shape: 0,
    matrix: new Three.Matrix4(),
    colour: [1, 1, 1],
    emissive: [0, 0, 0],
    casts: true,
    material,
  });
  const materialOf = (flat: TracedScene.Flat) =>
    Array.from(flat.placed.slice(TracedScene.PLACED - 8, TracedScene.PLACED));

  it('holds a surface as rough and as metal as it is', () => {
    const flat = TracedScene.flatten(
      [square],
      [placedWith({ _tag: 'Surface', roughness: 0.4, metalness: 0.25 })],
    );

    expect(materialOf(flat)).toEqual(
      [0, 0.4, 0.25, 0, 0, 0, 0, 0].map((value) => Math.fround(value)),
    );
  });

  it('holds hair as it takes light in, how rough it is along and about itself, how its cuticle tilts, and how it bends light', () => {
    const flat = TracedScene.flatten(
      [square],
      [
        placedWith({
          _tag: 'Hair',
          absorption: [1, 1.5, 2.5],
          roughness: 0.3,
          radialRoughness: 0.4,
          tilt: 0.035,
          ior: 1.55,
        }),
      ],
    );

    expect(materialOf(flat)).toEqual(
      [1, 0.3, 0.4, 1.55, 1, 1.5, 2.5, 0.035].map((value) => Math.fround(value)),
    );
  });

  it('gathers a mesh as rough and as metal as its material is, and a whole rough if it says not', () => {
    const scene = new Three.Scene();
    const shiny = new Three.Mesh(
      new Three.BoxGeometry(1, 1, 1),
      new Three.MeshStandardMaterial({ roughness: 0.2, metalness: 0.7 }),
    );
    shiny.position.z = -5;
    scene.add(shiny);

    const flat = TracedScene.gathering().gather(scene, new Three.PerspectiveCamera());

    expect(materialOf(flat).slice(0, 3)).toEqual([0, 0.2, 0.7].map((value) => Math.fround(value)));
  });

  it('gathers a mesh whose material says nothing of how rough it is as matte, with no shine, as Lambert has it', () => {
    const scene = new Three.Scene();
    const plain = new Three.Mesh(new Three.BoxGeometry(1, 1, 1), new Three.MeshLambertMaterial());
    plain.position.z = -5;
    scene.add(plain);

    const flat = TracedScene.gathering().gather(scene, new Three.PerspectiveCamera());

    expect(materialOf(flat)[0]).toBe(2);
  });
});

describe('which way what a ray meets faces', () => {
  const placedAt = (shape: number, matrix = new Three.Matrix4()): TracedScene.Placed => ({
    shape,
    matrix,
    colour: [1, 1, 1],
    emissive: [0, 0, 0],
    casts: true,
  });
  const normalOf = (
    flat: TracedScene.Flat,
    origin: readonly [number, number, number],
    direction: readonly [number, number, number],
  ) => Option.map(TracedScene.trace(flat, origin, direction, 100), ({ normal }) => normal);
  const flatTriangle = TracedScene.shapeOf(new Float32Array([-5, -5, 0, 5, -5, 0, 0, 5, 0]));

  it('faces a triangle back toward the ray, from either side', () => {
    const flat = TracedScene.flatten([flatTriangle], [placedAt(0)]);
    const [from, below] = [
      normalOf(flat, [0, 0, 5], [0, 0, -1]),
      normalOf(flat, [0, 0, -5], [0, 0, 1]),
    ];

    expect(
      Option.map(from, ([x, y, z]) => [x, y, z].map((part) => Math.round(part * 1e6) / 1e6)),
    ).toEqual(Option.some([0, 0, 1]));
    expect(Option.map(below, ([, , z]) => z)).toEqual(Option.some(expect.closeTo(-1, 9)));
  });

  it('turns as the shape is turned where it is placed', () => {
    // Laid on its back: facing +y.
    const flat = TracedScene.flatten(
      [flatTriangle],
      [placedAt(0, new Three.Matrix4().makeRotationX(-Math.PI / 2))],
    );

    expect(Option.map(normalOf(flat, [0, 5, 0], [0, -1, 0]), ([, y]) => y)).toEqual(
      Option.some(expect.closeTo(1, 9)),
    );
  });

  it('faces out of a strand where the ray meets it', () => {
    const strand = TracedScene.strandsOf(
      new Float32Array([-1, 0, 0, 1, 0, 0]),
      new Float32Array([0.2, 0.2]),
      2,
    );
    const flat = TracedScene.flatten([strand], [placedAt(0)]);

    expect(Option.map(normalOf(flat, [0, 0, 5], [0, 0, -1]), ([, , z]) => z)).toEqual(
      Option.some(expect.closeTo(1, 9)),
    );
    expect(Option.map(normalOf(flat, [3, 0, 0], [-1, 0, 0]), ([x]) => x)).toEqual(
      Option.some(expect.closeTo(1, 9)),
    );
  });

  it('runs along a strand where the ray meets it, from its root toward its tip, as it is placed', () => {
    const strand = TracedScene.strandsOf(
      new Float32Array([-1, 0, 0, 1, 0, 0]),
      new Float32Array([0.2, 0.2]),
      2,
    );
    // Turned a quarter about z, and twice as large: it runs up.
    const turned = new Three.Matrix4()
      .makeRotationZ(Math.PI / 2)
      .multiply(new Three.Matrix4().makeScale(2, 2, 2));
    const flat = TracedScene.flatten([strand], [placedAt(0, turned)]);
    const hit = Option.getOrThrow(TracedScene.trace(flat, [0, 0.5, 5], [0, 0, -1], 100));
    const plain = TracedScene.flatten([flatTriangle], [placedAt(0)]);

    const [x, y, z] = Option.getOrThrow(hit.along);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
    expect(
      Option.map(TracedScene.trace(plain, [0, 0, 5], [0, 0, -1], 100), ({ along }) => along),
    ).toEqual(Option.some(Option.none()));
  });
});

describe('a triangle’s corners as a ray meets it between them', () => {
  const placedAt = (shape: number): TracedScene.Placed => ({
    shape,
    matrix: new Three.Matrix4(),
    colour: [1, 1, 1],
    emissive: [0, 0, 0],
    casts: true,
  });
  /** A triangle lying flat facing +z, its corners' faces leaning out, and its corners at three corners of a picture. */
  const leaning = TracedScene.shapeOf(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), {
    normals: new Float32Array([-0.6, 0, 0.8, 0.6, 0, 0.8, 0, 0.6, 0.8]),
    uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
  });
  const flat = TracedScene.flatten([leaning], [placedAt(0)]);
  const hitAt = (x: number, y: number) =>
    Option.getOrThrow(TracedScene.trace(flat, [x, y, 5], [0, 0, -1], 100));

  it('faces as its corners face, weighted by how near each is', () => {
    const middle = hitAt(0, -1 / 3);
    const nearLeft = hitAt(-0.9, -0.95);

    expect(middle.normal[0]).toBeCloseTo(0, 6);
    expect(middle.normal[2]).toBeCloseTo(1, 1);
    expect(nearLeft.normal[0]).toBeLessThan(-0.4);
  });

  it('lies where its corners lie in their picture, weighted alike', () => {
    expect(hitAt(0, -1 / 3).uv[0]).toBeCloseTo(0.5, 6);
    expect(hitAt(0, -1 / 3).uv[1]).toBeCloseTo(1 / 3, 6);
  });

  it('faces as the triangle does, and lies at the picture’s corner, where its corners say nothing', () => {
    const bare = TracedScene.flatten(
      [TracedScene.shapeOf(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]))],
      [placedAt(0)],
    );
    const hit = Option.getOrThrow(TracedScene.trace(bare, [0, -0.3, 5], [0, 0, -1], 100));

    expect(hit.normal[2]).toBeCloseTo(1, 9);
    expect(hit.uv).toEqual([0, 0]);
  });
});

describe('a scene gathered with how its surfaces face and its pictures', () => {
  const camera = new Three.PerspectiveCamera();

  it('gathers how a mesh’s corners face and where they lie in its picture, and the picture its material paints', () => {
    const picture = new Three.Texture();
    const scene = new Three.Scene();
    const box = new Three.Mesh(
      new Three.BoxGeometry(1, 1, 1),
      new Three.MeshStandardMaterial({ map: picture }),
    );
    box.position.z = -5;
    scene.add(box);

    const flat = TracedScene.gathering().gather(scene, camera);
    const hit = Option.getOrThrow(TracedScene.trace(flat, [0.2, 0.1, 0], [0, 0, -1], 100));

    expect(hit.normal[2]).toBeCloseTo(1, 6);
    expect(hit.uv[0]).toBeCloseTo(0.7, 6);
    expect(hit.uv[1]).toBeCloseTo(0.6, 6);
    expect(flat.pictures).toEqual([picture]);
    // A surface painted with the first picture.
    expect(flat.placed[hit.placed * TracedScene.PLACED + 24]).toBe(1);
    expect(flat.placed[hit.placed * TracedScene.PLACED + 25]).toBe(0);
  });

  it('gathers the picture a material’s finish is painted with, rough as its green and metal as its blue', () => {
    const colours = new Three.Texture();
    const finish = new Three.Texture();
    const scene = new Three.Scene();
    const painted = new Three.Mesh(
      new Three.BoxGeometry(1, 1, 1),
      new Three.MeshStandardMaterial({ map: colours, roughnessMap: finish, metalnessMap: finish }),
    );
    const roughOnly = new Three.Mesh(
      new Three.BoxGeometry(1, 1, 1),
      new Three.MeshStandardMaterial({ roughnessMap: finish }),
    );
    painted.position.z = -5;
    roughOnly.position.set(3, 0, -5);
    scene.add(painted, roughOnly);

    const flat = TracedScene.gathering().gather(scene, camera);
    const finishOf = (origin: readonly [number, number, number]) => {
      const hit = Option.getOrThrow(TracedScene.trace(flat, origin, [0, 0, -1], 100));
      return [26, 27].map((at) => flat.placed[hit.placed * TracedScene.PLACED + at]);
    };

    expect(flat.pictures).toEqual([colours]);
    expect(flat.finishes).toEqual([finish]);
    // Both its roughness and its metalness painted, by the first of the finishes.
    expect(finishOf([0, 0, 0])).toEqual([3, 0]);
    expect(finishOf([3, 0, 0])).toEqual([1, 0]);
  });

  it('faces a mesh bent each frame as its corners turn, smoothly between them', () => {
    const geometry = new Three.SphereGeometry(1, 32, 16);
    geometry.morphAttributes['position'] = [
      new Three.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count * 3),
        3,
      ),
    ];
    const ball = new Three.Mesh(geometry, new Three.MeshStandardMaterial());
    ball.morphTargetInfluences = [0];
    ball.position.z = -5;
    const scene = new Three.Scene();
    scene.add(ball);

    const flat = TracedScene.gathering().gather(scene, camera);
    // Met off its middle, a sphere faces out from its centre there.
    const hit = Option.getOrThrow(TracedScene.trace(flat, [0.5, 0.3, 0], [0, 0, -1], 100));
    const out = new Three.Vector3(0.5, 0.3, 5 - hit.distance).normalize();

    expect(hit.normal[0] * out.x + hit.normal[1] * out.y + hit.normal[2] * out.z).toBeGreaterThan(
      0.9995,
    );
  });

  it.effect(
    'gathers the hair a model draws as its strands where they are drawn now, when asked',
    () =>
      Effect.gen(function* () {
        const made = new Three.Group();
        const geometry = new Three.BufferGeometry();
        // One strand of three points, hanging from 1.7 m to 1.6 m, five metres ahead.
        geometry.setAttribute(
          'position',
          new Three.Float32BufferAttribute([0, 1.7, -5, 0, 1.65, -5, 0, 1.6, -5], 3),
        );
        geometry.setIndex([0, 1, 1, 2]);
        const strands = new Three.LineSegments(geometry, new Three.LineBasicMaterial());
        strands.name = 'HairStrands';
        made.add(strands);
        const guides: Strands.Strands = {
          points: 2,
          scalp: 1,
          ponytail: 0,
          at: [0, 1.7, -5, 0, 1.6, -5],
          width: [0.002, 0.002],
          stiffness: [1, 0.2],
          random: [0.5],
          bones: ['head'],
          joints: Array.from({ length: 8 }, () => 0),
          weights: [1, 0, 0, 0, 1, 0, 0, 0],
        };
        const shading: Strands.Shading = {
          melanin: 0.8,
          melaninRedness: 0.3,
          tint: [1, 1, 1],
          roughness: 0.3,
          radialRoughness: 0.3,
          coat: 0,
          ior: 1.55,
          offset: 0.035,
          randomColor: 0,
          randomRoughness: 0,
        };
        const haired = yield* Hairing.fit(made, {
          guides,
          drawn: { points: 3, scalp: 1, ponytail: 0 },
          shading,
        });
        // Swung a decimetre aside since it was made.
        haired.draw(
          guides.at.map((value, index) => value + (index % 3 === 0 ? 0.1 : 0)),
          [Quaternion.identity],
        );
        const scene = new Three.Scene();
        scene.add(made);

        const asked = TracedScene.gathering({ strands: true }).gather(scene, camera);
        const hit = Option.getOrThrow(TracedScene.trace(asked, [0.1, 1.65, 0], [0, 0, -1], 100));
        const plain = TracedScene.gathering().gather(scene, camera);
        const base = hit.placed * TracedScene.PLACED;
        const absorption = Hairing.absorptionOf(shading);

        expect(hit.distance).toBeCloseTo(5 - 0.001, 6);
        // Hair, shaded as the hair is.
        expect(asked.placed[base + 20]).toBe(1);
        expect(asked.placed[base + 24]).toBeCloseTo(absorption.r, 5);
        expect(asked.placed[base + 12]).toBeCloseTo(Hairing.colourOf(shading).r, 5);
        expect(Option.isNone(TracedScene.trace(plain, [0.1, 1.65, 0], [0, 0, -1], 100))).toBe(true);
      }),
  );
});
