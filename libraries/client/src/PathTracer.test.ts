import { describe, expect, it } from '@effect/vitest';
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

describe('PathTracer.radiance', () => {
  it('is the sky where a ray meets nothing', () => {
    const lighting: PathTracer.Lighting = { sky: [0.2, 0.4, 0.8], suns: [] };
    const empty = TracedScene.flatten([], []);

    expect(PathTracer.radiance(empty, [0, 0, 0], [0, 0, -1], lighting, numbers(1))).toEqual([
      0.2, 0.4, 0.8,
    ]);
  });

  it('is a matte floor’s colour times the sky above it, however its light is sampled', () => {
    const lighting: PathTracer.Lighting = { sky: [1, 1, 1], suns: [] };
    const flat = TracedScene.flatten([floor], [placed(0, [0.5, 0.5, 0.5])]);

    for (let seed = 1; seed <= 20; seed++) {
      const [red] = PathTracer.radiance(flat, above, down, lighting, numbers(seed));
      expect(red).toBeCloseTo(0.5, 6);
    }
  });

  it('is lit by a sun straight above a matte floor as much as Lambert has it, and none of it in a box’s shadow', () => {
    const lighting: PathTracer.Lighting = {
      sky: [0, 0, 0],
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

  it('gives off the light of what glows', () => {
    const lighting: PathTracer.Lighting = { sky: [0, 0, 0], suns: [] };
    const flat = TracedScene.flatten([floor], [placed(0, [0, 0, 0], { emissive: [2, 1, 0.5] })]);

    expect(PathTracer.radiance(flat, above, down, lighting, numbers(5))).toEqual([2, 1, 0.5]);
  });
});
