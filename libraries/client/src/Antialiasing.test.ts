import { describe, expect, it } from '@effect/vitest';
import * as Antialiasing from '#src/Antialiasing.ts';

describe('Antialiasing.supersample', () => {
  it('draws the scene four times a frame unless told otherwise', () => {
    expect(Antialiasing.supersample()).toEqual({ _tag: 'Supersample', samples: 4 });
  });

  it('draws it as many times as told, a power of two', () => {
    expect(Antialiasing.supersample(16)).toEqual({ _tag: 'Supersample', samples: 16 });
  });

  it('draws it the nearest power of two times, from two to thirty-two', () => {
    expect(Antialiasing.supersample(5).samples).toBe(4);
    expect(Antialiasing.supersample(7).samples).toBe(8);
    expect(Antialiasing.supersample(1).samples).toBe(2);
    expect(Antialiasing.supersample(100).samples).toBe(32);
  });
});

describe('Antialiasing.temporal', () => {
  it('draws the scene at the whole resolution unless told otherwise', () => {
    expect(Antialiasing.temporal()).toEqual({ _tag: 'Temporal', resolution: 1 });
  });

  it('draws it at a share of the resolution as told, and brings it to the whole', () => {
    expect(Antialiasing.temporal({ resolution: 0.67 })).toEqual({
      _tag: 'Temporal',
      resolution: 0.67,
    });
  });

  it('never draws it at less than half the resolution, nor more than all of it', () => {
    expect(Antialiasing.temporal({ resolution: 0.1 }).resolution).toBe(0.5);
    expect(Antialiasing.temporal({ resolution: 2 }).resolution).toBe(1);
  });
});

describe('Antialiasing.multisampled', () => {
  it('is whether the scene is drawn with several samples a pixel, which only multisampling does', () => {
    expect(Antialiasing.multisampled(Antialiasing.multisample)).toBe(true);
    expect(
      [
        Antialiasing.none,
        Antialiasing.morphological,
        Antialiasing.supersample(),
        Antialiasing.temporal(),
      ].map(Antialiasing.multisampled),
    ).toEqual([false, false, false, false]);
  });
});
