import { describe, expect, it } from '@effect/vitest';
import * as HairScattering from '#src/HairScattering.ts';

/** A stream of numbers from 0 to 1 that is the same for the same seed. */
const numbers = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

/** A way chosen evenly over the whole sphere. */
const anyWay = (random: () => number): HairScattering.Way => {
  const z = 1 - 2 * random();
  const across = Math.sqrt(Math.max(1 - z * z, 0));
  const angle = 2 * Math.PI * random();
  return [across * Math.cos(angle), across * Math.sin(angle), z];
};

/** A fibre that takes in no light, as rough as given, met `offset` across. */
const clear = (offset: number, roughness: number, radialRoughness: number) =>
  HairScattering.prepare({
    offset,
    ior: 1.55,
    absorption: [0, 0, 0],
    roughness,
    radialRoughness,
    tilt: 0,
  });

describe('HairScattering', () => {
  it('sends on all the light that meets a fibre taking none in, however rough, lit evenly from everywhere', () => {
    const random = numbers(7);
    for (const roughness of [0.2, 0.5, 0.8]) {
      for (const radialRoughness of [0.3, 0.7]) {
        const seen = anyWay(random);
        const count = 60000;
        let sum = 0;
        for (let sample = 0; sample < count; sample++) {
          const fibre = clear(-1 + 2 * random(), roughness, radialRoughness);
          sum += HairScattering.scattered(fibre, seen, anyWay(random))[0];
        }
        // Each way as likely as any other over the sphere, of 4π.
        expect((sum / count) * 4 * Math.PI).toBeGreaterThan(0.95);
        expect((sum / count) * 4 * Math.PI).toBeLessThan(1.05);
      }
    }
  });

  it('chooses ways as likely as it says, each carrying what it scatters there over how likely it is', () => {
    const random = numbers(11);
    const count = 40000;
    let sum = 0;
    for (let sample = 0; sample < count; sample++) {
      const fibre = clear(-1 + 2 * random(), 0.4, 0.5);
      const seen = anyWay(random);
      const chosen = HairScattering.sample(fibre, seen, [random(), random(), random(), random()]);
      sum += chosen.carried[0];
      // The likelihood it gives is the one it works out for that way.
      expect(HairScattering.likelihood(fibre, seen, chosen.way)).toBeCloseTo(chosen.likelihood, 3);
    }
    expect(sum / count).toBeGreaterThan(0.98);
    expect(sum / count).toBeLessThan(1.02);
  });

  it('takes in more of what dark hair takes in, so the light it sends on is coloured, and less of it', () => {
    const random = numbers(3);
    const brown = HairScattering.prepare({
      offset: 0.2,
      ior: 1.55,
      absorption: [0.4, 0.7, 1.4],
      roughness: 0.3,
      radialRoughness: 0.3,
      tilt: 0.035,
    });
    const seen: HairScattering.Way = [0, 0, 1];
    const sums = [0, 0, 0];
    const count = 40000;
    for (let sample = 0; sample < count; sample++) {
      const sent = HairScattering.scattered(brown, seen, anyWay(random));
      for (let part = 0; part < 3; part++) {
        sums[part] = (sums[part] ?? 0) + (sent[part] ?? 0);
      }
    }
    const [red = 0, green = 0, blue = 0] = sums.map((sum) => (sum / count) * 4 * Math.PI);

    expect(red).toBeLessThan(1);
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    // What shines off its surface is white, so even blue is never wholly taken.
    expect(blue).toBeGreaterThan(0.03);
  });

  it('shines brightest off its surface as a mirror would, shifted toward the root by its cuticle’s tilt', () => {
    const tilted = HairScattering.prepare({
      offset: 0,
      ior: 1.55,
      absorption: [50, 50, 50],
      roughness: 0.2,
      radialRoughness: 0.3,
      tilt: 0.05,
    });
    // Seen from a little toward the tip, lit from the mirrored way, and from as far the other way.
    const rise = 0.3;
    const seen: HairScattering.Way = [Math.sin(rise), 0, Math.cos(rise)];
    const mirrored: HairScattering.Way = [-Math.sin(rise), 0, Math.cos(rise)];
    const shine = (lift: number) =>
      HairScattering.scattered(tilted, seen, [
        Math.sin(-rise + lift),
        0,
        Math.cos(-rise + lift),
      ])[0];

    expect(HairScattering.scattered(tilted, seen, mirrored)[0]).toBeGreaterThan(0);
    // The shine is toward the root, the fibre running along +x toward its tip.
    expect(shine(-0.1)).toBeGreaterThan(shine(0.1));
  });
});
