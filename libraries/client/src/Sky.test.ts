import { describe, expect, it } from '@effect/vitest';
import * as Three from 'three/webgpu';
import * as PathTracer from '#src/PathTracer.ts';
import * as Sky from '#src/Sky.ts';

describe('Sky.gradient', () => {
  it('is as bright as a hemisphere light of its colours is, straight up, straight down, and halfway at the horizon', () => {
    const up = new Three.Color(1, 0.5, 0.25);
    const down = new Three.Color(0, 0, 0.5);
    const sky = Sky.gradient(up, down, Math.PI);
    const scene = new Three.Scene();
    scene.environment = sky;

    const lighting = PathTracer.lightingOf(scene);

    const [upRed, upGreen] = PathTracer.skyAt(lighting, [0, 1, 0]);
    const [, , downBlue] = PathTracer.skyAt(lighting, [0, -1, 0]);
    const [horizonRed] = PathTracer.skyAt(lighting, [1, 0, 0]);
    expect(upRed).toBeCloseTo(1, 1);
    expect(upGreen).toBeCloseTo(0.5, 1);
    expect(downBlue).toBeCloseTo(0.5, 1);
    expect(horizonRed).toBeCloseTo(0.5, 1);
  });

  it('lies about the scene as Three reads an environment: a picture all round it, every way once', () => {
    const sky = Sky.gradient(new Three.Color(1, 1, 1), new Three.Color(0, 0, 0), 1);

    expect(sky.mapping).toBe(Three.EquirectangularReflectionMapping);
    expect(sky.image.width).toBe(2 * sky.image.height);
  });
});
