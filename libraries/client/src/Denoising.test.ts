import { describe, expect, it } from '@effect/vitest';
import * as Denoising from '#src/Denoising.ts';

/** A stream of numbers from 0 to 1 that is the same for the same seed. */
const numbers = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

const width = 48;
const height = 48;
const count = width * height;

/** A photograph of a wall facing the camera, a metre away, as white as `albedo` says and lit as `lit` says, every pixel as noisy as `noise` says, its paths so far averaged, and how far its brightness may stray from what it is. */
const wall = (options: {
  readonly lit: (x: number, y: number) => number;
  readonly albedo?: (x: number, y: number) => number;
  readonly normal?: (x: number) => readonly [number, number, number];
  readonly depth?: (x: number) => number;
  readonly noise: number;
}): Denoising.Image => {
  const random = numbers(5);
  const radiance = new Float32Array(count * 3);
  const albedo = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const spread = new Float32Array(count);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const colour = options.albedo?.(x, y) ?? 1;
      const light = options.lit(x, y) * (1 + (random() * 2 - 1) * options.noise);
      const facing = options.normal?.(x) ?? [0, 0, 1];
      for (let part = 0; part < 3; part++) {
        radiance[pixel * 3 + part] = light * colour;
        albedo[pixel * 3 + part] = colour;
        normal[pixel * 3 + part] = facing[part] ?? 0;
      }
      depth[pixel] = options.depth?.(x) ?? 1;
      spread[pixel] = (options.lit(x, y) * colour * options.noise) ** 2 / 3;
    }
  }
  return { width, height, radiance, albedo, normal, depth, variance: spread };
};

/** How far `image`'s red strays from `truth`, as a root mean square, over the pixels `within` keeps. */
const straying = (
  red: (pixel: number) => number,
  truth: (x: number, y: number) => number,
  within: (x: number, y: number) => boolean = () => true,
) => {
  let sum = 0;
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (within(x, y)) {
        sum += (red(y * width + x) - truth(x, y)) ** 2;
        pixels++;
      }
    }
  }
  return Math.sqrt(sum / pixels);
};

describe('Denoising.denoised', () => {
  it('smooths the noise of a wall lit evenly to a tenth of what it was', () => {
    const image = wall({ lit: () => 0.5, noise: 0.5 });

    const smooth = Denoising.denoised(image);

    const before = straying(
      (pixel) => image.radiance[pixel * 3] ?? 0,
      () => 0.5,
    );
    const after = straying(
      (pixel) => smooth[pixel * 3] ?? 0,
      () => 0.5,
    );
    expect(after).toBeLessThan(before / 10);
  });

  it('keeps the picture painted on a wall sharp, smoothing only the light on it', () => {
    const checks = (x: number, y: number) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 0.9 : 0.1);
    const image = wall({ lit: () => 0.5, albedo: checks, noise: 0.3 });

    const smooth = Denoising.denoised(image);

    expect(
      straying(
        (pixel) => smooth[pixel * 3] ?? 0,
        (x, y) => 0.5 * checks(x, y),
      ),
    ).toBeLessThan(0.02);
  });

  it('keeps the edge between two walls facing apart, light not bleeding across it', () => {
    const lit = (x: number) => (x < width / 2 ? 1 : 0.1);
    const image = wall({
      lit,
      normal: (x) => (x < width / 2 ? [0, 0, 1] : [1, 0, 0]),
      noise: 0.2,
    });

    const smooth = Denoising.denoised(image);

    // Right beside the edge, the darker wall stays as dark as it is.
    expect(
      straying(
        (pixel) => smooth[pixel * 3] ?? 0,
        lit,
        (x) => x === width / 2,
      ),
    ).toBeLessThan(0.03);
  });

  it('keeps the edge of a shadow on a wall, where the light changes far more than its noise', () => {
    const lit = (x: number) => (x < width / 2 ? 1 : 0.05);
    const image = wall({ lit, noise: 0.1 });

    const smooth = Denoising.denoised(image);

    expect(
      straying(
        (pixel) => smooth[pixel * 3] ?? 0,
        lit,
        (x) => Math.abs(x - width / 2) <= 1,
      ),
    ).toBeLessThan(0.05);
  });

  it('leaves what meets nothing, such as the sky, as it is', () => {
    const image = wall({ lit: () => 0.7, depth: () => 0, noise: 0.4 });

    const smooth = Denoising.denoised(image);

    expect(Array.from(smooth)).toEqual(Array.from(image.radiance));
  });
});
