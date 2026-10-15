import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Photo from '#src/Photo.ts';

/** Where `uv` lies in the `index`th picture, as `placings` moves it. */
const placedAt = (placings: Float32Array, index: number, uv: readonly [number, number]) => {
  const at = index * Photo.PLACING;
  const part = (offset: number) =>
    (placings[at + offset] ?? 0) * uv[0] +
    (placings[at + offset + 1] ?? 0) * uv[1] +
    (placings[at + offset + 2] ?? 0);
  return [part(0), part(4)];
};

describe('Photo.placingsOf', () => {
  it('moves a place in each picture as Three moves it: by its offset, repeat, and turn, and upside down where it is drawn so', () => {
    const plain = new Three.Texture();
    plain.flipY = false;
    const moved = new Three.Texture();
    moved.flipY = false;
    moved.offset.set(0.5, 0);
    moved.repeat.set(2, 1);
    const flipped = new Three.Texture();
    flipped.flipY = true;

    const placings = Photo.placingsOf([plain, moved, flipped]);

    const [u, v] = placedAt(placings, 0, [0.25, 0.5]);
    expect(u).toBeCloseTo(0.25, 6);
    expect(v).toBeCloseTo(0.5, 6);
    const [movedU, movedV] = placedAt(placings, 1, [0.25, 0.5]);
    expect(movedU).toBeCloseTo(1, 6);
    expect(movedV).toBeCloseTo(0.5, 6);
    // Its picture laid in the photograph's top row first, a picture Three turns upside down has its bottom at the top.
    const [flippedU, flippedV] = placedAt(placings, 2, [0.25, 0.2]);
    expect(flippedU).toBeCloseTo(0.25, 6);
    expect(flippedV).toBeCloseTo(0.8, 6);
  });
});

describe('Photo.developingOf', () => {
  it('develops a photograph as the renderer puts out its frames, its noise left as it is and never done, unless told otherwise', () => {
    const renderer = { toneMapping: Three.NoToneMapping, toneMappingExposure: 1.5 };

    expect(Photo.developingOf(renderer, {})).toEqual({
      toneMapping: Three.NoToneMapping,
      exposure: 1.5,
      denoised: false,
      samples: Option.none(),
    });
    expect(Photo.developingOf(renderer, { toneMapping: Three.NeutralToneMapping })).toEqual({
      toneMapping: Three.NeutralToneMapping,
      exposure: 1.5,
      denoised: false,
      samples: Option.none(),
    });
    expect(Photo.developingOf(renderer, { exposure: 2, denoised: true, samples: 64 })).toEqual({
      toneMapping: Three.NoToneMapping,
      exposure: 2,
      denoised: true,
      samples: Option.some(64),
    });
  });
});

describe('Photo.batched', () => {
  const width = 100;
  const total = width * 50;

  it('follows the next rows after a batch, as many more as it had time for, whole rows at a time', () => {
    const first = Photo.batchesOf(width);
    const quick = Photo.batched(first, { width, total, took: Photo.BUDGET / 4 });
    const slow = Photo.batched(quick, { width, total, took: Photo.BUDGET * 2 });

    expect(quick.first).toBe(first.size);
    expect(quick.size).toBe(first.size * 4);
    expect(slow.size).toBe(quick.size / 2);
    expect(slow.size % width).toBe(0);
  });

  it('never follows less than a row or more than the photograph, and starts the next pass after its last row', () => {
    const tiny = Photo.batched(Photo.batchesOf(width), { width, total, took: Photo.BUDGET * 1000 });
    const whole = Photo.batched(
      { pass: 0, first: total - width, size: total },
      { width, total, took: 0 },
    );

    expect(tiny.size).toBe(width);
    expect(whole).toEqual({ pass: 1, first: 0, size: total });
  });
});

describe('Photo.viewOf', () => {
  it('moves as its camera moves, turns, or changes its lens, and not otherwise', () => {
    const camera = new Three.PerspectiveCamera(50, 1.5, 0.1, 100);
    camera.position.set(0, 1.6, 3);
    camera.updateMatrixWorld();
    const seen = Photo.viewOf(camera);

    camera.updateMatrixWorld();
    const still = Photo.viewOf(camera);
    camera.position.x += 0.01;
    camera.updateMatrixWorld();
    const moved = Photo.viewOf(camera);
    camera.position.x -= 0.01;
    camera.rotation.y = 0.1;
    camera.updateMatrixWorld();
    const turned = Photo.viewOf(camera);
    camera.rotation.y = 0;
    camera.fov = 40;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const zoomed = Photo.viewOf(camera);

    expect(Photo.moved(seen, still)).toBe(false);
    expect(Photo.moved(seen, moved)).toBe(true);
    expect(Photo.moved(seen, turned)).toBe(true);
    expect(Photo.moved(seen, zoomed)).toBe(true);
  });

  it('is not moved by its camera shifted less than a pixel, as temporal antialiasing shifts it every frame', () => {
    const camera = new Three.PerspectiveCamera(50, 1.5, 0.1, 100);
    camera.updateMatrixWorld();
    const seen = Photo.viewOf(camera);

    camera.setViewOffset(1500, 1000, 0.3, -0.2, 1500, 1000);
    camera.updateMatrixWorld();

    expect(Photo.moved(seen, Photo.viewOf(camera))).toBe(false);
  });
});

describe('Photo.smoothsAfter', () => {
  it('smooths a photograph after a pass as many as a power of two, and after its last, ever less often', () => {
    const smoothed = Array.from({ length: 40 }, (_, at) => at + 1).filter((pass) =>
      Photo.smoothsAfter(pass, Option.some(24)),
    );

    expect(smoothed).toEqual([1, 2, 4, 8, 16, 24, 32]);
    expect(Photo.smoothsAfter(64, Option.none())).toBe(true);
    expect(Photo.smoothsAfter(65, Option.none())).toBe(false);
  });
});
