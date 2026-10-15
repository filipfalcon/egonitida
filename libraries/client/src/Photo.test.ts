import { describe, expect, it } from '@effect/vitest';
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
  it('develops a photograph as the renderer puts out its frames, unless told otherwise', () => {
    const renderer = { toneMapping: Three.NoToneMapping, toneMappingExposure: 1.5 };

    expect(Photo.developingOf(renderer, {})).toEqual({
      toneMapping: Three.NoToneMapping,
      exposure: 1.5,
    });
    expect(Photo.developingOf(renderer, { toneMapping: Three.NeutralToneMapping })).toEqual({
      toneMapping: Three.NeutralToneMapping,
      exposure: 1.5,
    });
    expect(Photo.developingOf(renderer, { exposure: 2 })).toEqual({
      toneMapping: Three.NoToneMapping,
      exposure: 2,
    });
  });
});
