import { describe, expect, it } from '@effect/vitest';
import * as Three from 'three/webgpu';
import * as SceneTracer from '#src/SceneTracer.ts';

/** The numbers of the `index`th light laid flat. */
const lightAt = (flat: Float32Array, index: number) =>
  Array.from(flat.slice(index * SceneTracer.LIGHT, (index + 1) * SceneTracer.LIGHT));

describe('the direct lights a scene is shadowed from', () => {
  it('lays out a point light where it shines from, as bright as its colour and intensity, as far as it reaches and how it falls off', () => {
    const scene = new Three.Scene();
    const torch = new Three.PointLight(0xff8000, 12, 10, 2);
    torch.position.set(1, 2, 3);
    scene.add(torch);
    scene.updateMatrixWorld();

    const [x, y, z, kind, r, g, b, reach, , , , decay] = lightAt(
      SceneTracer.directLights(scene),
      0,
    );

    expect([x, y, z, kind]).toEqual([1, 2, 3, 0]);
    expect(r).toBeCloseTo(12);
    expect(g).toBeCloseTo(new Three.Color(0xff8000).g * 12);
    expect(b).toBeCloseTo(0);
    expect([reach, decay]).toEqual([10, 2]);
  });

  it('lays out a spot light with the way it points and its cone, and a directional light with the way its light comes from', () => {
    const scene = new Three.Scene();
    const spot = new Three.SpotLight(0xffffff, 5, 0, Math.PI / 4, 0.5);
    spot.position.set(0, 4, 0);
    spot.target.position.set(0, 0, 0);
    const sun = new Three.DirectionalLight(0xffffff, 2);
    sun.position.set(0, 10, 10);
    scene.add(spot, spot.target, sun);
    scene.updateMatrixWorld();

    const flat = SceneTracer.directLights(scene);
    const spotted = lightAt(flat, 0);
    const shone = lightAt(flat, 1);

    expect(spotted[3]).toBe(1);
    // Toward the light from where it points: straight up.
    expect([spotted[8], spotted[9], spotted[10]].map((part) => Math.abs(part ?? 9))).toEqual([
      0, 1, 0,
    ]);
    expect(spotted[12]).toBeCloseTo(Math.cos(Math.PI / 4));
    expect(spotted[13]).toBeCloseTo(Math.cos((Math.PI / 4) * 0.5));
    expect(shone[3]).toBe(2);
    expect(shone[9]).toBeCloseTo(Math.SQRT1_2);
    expect(shone[10]).toBeCloseTo(Math.SQRT1_2);
  });

  it('leaves out lights Three.js shadows with a map, lights not drawn, and lights giving none', () => {
    const scene = new Three.Scene();
    const mapped = new Three.PointLight(0xffffff, 1);
    mapped.castShadow = true;
    const hidden = new Three.PointLight(0xffffff, 1);
    hidden.visible = false;
    const dark = new Three.PointLight(0xffffff, 0);
    scene.add(mapped, hidden, dark, new Three.AmbientLight(0xffffff, 1));
    scene.updateMatrixWorld();

    expect(SceneTracer.directLights(scene)).toHaveLength(0);
  });
});
