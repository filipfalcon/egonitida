import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Three from 'three/webgpu';
import * as PathTracer from '#src/PathTracer.ts';
import * as TracedScene from '#src/TracedScene.ts';

/** A floor ten metres across at y = 0, facing up, as two triangles. */
const floor = TracedScene.shapeOf(
  new Float32Array([-5, 0, -5, 5, 0, 5, 5, 0, -5, -5, 0, -5, -5, 0, 5, 5, 0, 5]),
);

/** A box a metre across, as twelve triangles. */
const box = TracedScene.shapeOf(
  (() => {
    const geometry = new Three.BoxGeometry(1, 1, 1).toNonIndexed();
    return new Float32Array(geometry.getAttribute('position').array);
  })(),
);

const placed = (
  shape: number,
  colour: readonly [number, number, number],
  options: {
    readonly at?: readonly [number, number, number];
    readonly emissive?: readonly [number, number, number];
  } = {},
): TracedScene.Placed => ({
  shape,
  matrix: new Three.Matrix4().makeTranslation(...(options.at ?? [0, 0, 0])),
  colour,
  emissive: options.emissive ?? [0, 0, 0],
  casts: true,
});

/** A stream of numbers from 0 to 1 that is the same for the same seed. */
const numbers = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const down: readonly [number, number, number] = [0, -1, 0];
const above: readonly [number, number, number] = [0.3, 2, 0.2];

describe('PathTracer.skyAt', () => {
  it('is as bright as the sky straight up, as the ground straight down, and between them halfway at the horizon', () => {
    const lighting: PathTracer.Lighting = {
      up: [1, 1, 1],
      down: [0, 0, 0],
      environment: Option.none(),
      suns: [],
    };

    expect(PathTracer.skyAt(lighting, [0, 1, 0])).toEqual([1, 1, 1]);
    expect(PathTracer.skyAt(lighting, [0, -1, 0])).toEqual([0, 0, 0]);
    expect(PathTracer.skyAt(lighting, [1, 0, 0])).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('PathTracer.radiance', () => {
  it('is the sky where a ray meets nothing', () => {
    const lighting: PathTracer.Lighting = {
      up: [0.2, 0.4, 0.8],
      down: [0.2, 0.4, 0.8],
      environment: Option.none(),
      suns: [],
    };
    const empty = TracedScene.flatten([], []);

    expect(PathTracer.radiance(empty, [0, 0, 0], [0, 0, -1], lighting, numbers(1))).toEqual([
      0.2, 0.4, 0.8,
    ]);
  });

  it('is a matte floor’s colour times the sky above it, however its light is sampled', () => {
    const lighting: PathTracer.Lighting = {
      up: [1, 1, 1],
      down: [1, 1, 1],
      environment: Option.none(),
      suns: [],
    };
    const flat = TracedScene.flatten([floor], [placed(0, [0.5, 0.5, 0.5])]);

    for (let seed = 1; seed <= 20; seed++) {
      const [red] = PathTracer.radiance(flat, above, down, lighting, numbers(seed));
      expect(red).toBeCloseTo(0.5, 6);
    }
  });

  it('is lit by a sun straight above a matte floor as much as Lambert has it, and none of it in a box’s shadow', () => {
    const lighting: PathTracer.Lighting = {
      up: [0, 0, 0],
      down: [0, 0, 0],
      environment: Option.none(),
      suns: [{ toward: [0, 1, 0], irradiance: [1, 1, 1] }],
    };
    const flat = TracedScene.flatten(
      [floor, box],
      [placed(0, [0.5, 0.5, 0.5]), placed(1, [0, 0, 0], { at: [3, 1, 0] })],
    );

    const [lit] = PathTracer.radiance(flat, above, down, lighting, numbers(3));
    const [shaded] = PathTracer.radiance(flat, [3, 0.3, 0], down, lighting, numbers(3));
    expect(lit).toBeCloseTo(0.5 / Math.PI, 6);
    expect(shaded).toBeCloseTo(0, 6);
  });

  it('carries light through as many bounces as it takes, inside a closed box glowing as much as it sends back', () => {
    const lighting: PathTracer.Lighting = {
      up: [0, 0, 0],
      down: [0, 0, 0],
      environment: Option.none(),
      suns: [],
    };
    // Each wall gives off 1 and sends on 0.8 of what reaches it: 1 + 0.8 + 0.64 + … = 5 in all.
    const flat = TracedScene.flatten(
      [box],
      [placed(0, [0.8, 0.8, 0.8], { emissive: [1, 1, 1], at: [0, 0, 0] })],
    );
    const random = numbers(9);
    const count = 4000;
    let sum = 0;
    for (let path = 0; path < count; path++) {
      const z = 1 - 2 * random();
      const across = Math.sqrt(1 - z * z);
      const angle = 2 * Math.PI * random();
      const way: readonly [number, number, number] = [
        across * Math.cos(angle),
        across * Math.sin(angle),
        z,
      ];
      sum += PathTracer.radiance(flat, [0, 0, 0], way, lighting, random)[0];
    }

    expect(sum / count).toBeGreaterThan(4.85);
    expect(sum / count).toBeLessThan(5.15);
  });

  it('shines off a smooth floor where a sun glances off it toward the eye, more than off a matte one', () => {
    const lighting: PathTracer.Lighting = {
      up: [0, 0, 0],
      down: [0, 0, 0],
      environment: Option.none(),
      suns: [{ toward: [0, 1, 0], irradiance: [1, 1, 1] }],
    };
    const smooth = TracedScene.flatten(
      [floor],
      [
        {
          ...placed(0, [0.5, 0.5, 0.5]),
          material: { _tag: 'Surface', roughness: 0.2, metalness: 0 },
        },
      ],
    );

    const [shine] = PathTracer.radiance(smooth, above, down, lighting, numbers(3));

    expect(shine).toBeGreaterThan(2 * (0.5 / Math.PI));
  });

  it('gives off the light of what glows', () => {
    const lighting: PathTracer.Lighting = {
      up: [0, 0, 0],
      down: [0, 0, 0],
      environment: Option.none(),
      suns: [],
    };
    const flat = TracedScene.flatten([floor], [placed(0, [0, 0, 0], { emissive: [2, 1, 0.5] })]);

    expect(PathTracer.radiance(flat, above, down, lighting, numbers(5))).toEqual([2, 1, 0.5]);
  });
});

describe('PathTracer.radiance through hair', () => {
  /** One strand along x, a centimetre thick, lying at y = 0. */
  const strand = TracedScene.strandsOf(
    new Float32Array([-1, 0, 0, 1, 0, 0]),
    new Float32Array([0.02, 0.02]),
    2,
  );
  const sunAbove: PathTracer.Lighting = {
    up: [0, 0, 0],
    down: [0, 0, 0],
    environment: Option.none(),
    suns: [{ toward: [0, 1, 0], irradiance: [1, 1, 1] }],
  };
  const madeOf = (material: TracedScene.Material): TracedScene.Placed => ({
    shape: 0,
    matrix: new Three.Matrix4(),
    colour: [0, 0, 0],
    emissive: [0, 0, 0],
    casts: true,
    material,
  });

  it('shines white off a strand of black hair where a sun glances off it, as nothing matte of its colour does', () => {
    const black: TracedScene.Material = {
      _tag: 'Hair',
      absorption: [50, 50, 50],
      roughness: 0.3,
      radialRoughness: 0.3,
      tilt: 0,
      ior: 1.55,
    };
    const hair = TracedScene.flatten([strand], [madeOf(black)]);
    const matte = TracedScene.flatten([strand], [madeOf(TracedScene.matte)]);

    const [shine] = PathTracer.radiance(hair, [0, 1, 0], down, sunAbove, numbers(2));
    const [dull] = PathTracer.radiance(matte, [0, 1, 0], down, sunAbove, numbers(2));

    expect(shine).toBeGreaterThan(0.05);
    expect(dull).toBeCloseTo(0, 6);
  });
});

describe('PathTracer.lightingOf', () => {
  it('lights a path as Three lights the scene: its hemisphere as the sky, its directional lights as suns', () => {
    const scene = new Three.Scene();
    scene.add(new Three.HemisphereLight(0xffffff, 0x000000, Math.PI));
    const sun = new Three.DirectionalLight(0xffffff, 2);
    sun.position.set(0, 4, 3);
    scene.add(sun);

    const lighting = PathTracer.lightingOf(scene);

    expect(lighting.up[0]).toBeCloseTo(1, 6);
    expect(lighting.down[0]).toBeCloseTo(0, 6);
    expect(lighting.suns).toHaveLength(1);
    expect(lighting.suns[0]?.toward[1]).toBeCloseTo(0.8, 6);
    expect(lighting.suns[0]?.toward[2]).toBeCloseTo(0.6, 6);
    expect(lighting.suns[0]?.irradiance[0]).toBeCloseTo(2, 6);
  });
});
