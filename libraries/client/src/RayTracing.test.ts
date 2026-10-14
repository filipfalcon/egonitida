import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as RayTracing from '#src/RayTracing.ts';

describe('ray tracing', () => {
  it('traces light and reflections through the screen, at half the resolution, unless told otherwise', () => {
    expect(RayTracing.screen()).toEqual({
      _tag: 'Screen',
      light: Option.some(RayTracing.light()),
      reflections: Option.some(RayTracing.reflections()),
      resolution: 0.5,
    });
  });

  it('traces them through the scene, a ray or two a pixel each frame, when told', () => {
    expect(RayTracing.scene()).toEqual({
      _tag: 'Scene',
      light: Option.some(RayTracing.light()),
      reflections: Option.some(RayTracing.reflections()),
      resolution: 0.5,
      rays: 2,
    });
  });

  it('traces only what it is told to', () => {
    const onlyLight = RayTracing.scene({ reflections: Option.none() });

    expect(Option.isSome(onlyLight.light)).toBe(true);
    expect(onlyLight.reflections).toEqual(Option.none());
  });

  it('keeps what it is told within what can be traced', () => {
    expect(RayTracing.light({ strength: -1, occlusion: -2, radius: -3 })).toEqual({
      strength: 0,
      occlusion: 0,
      radius: 0,
    });
    expect(RayTracing.reflections({ strength: -1, distance: -1 })).toEqual({
      strength: 0,
      distance: 0,
    });
    expect(RayTracing.scene({ resolution: 3, rays: 0 })).toMatchObject({ resolution: 1, rays: 1 });
    expect(RayTracing.scene({ resolution: 0, rays: 100 })).toMatchObject({
      resolution: 0.1,
      rays: 16,
    });
  });
});
