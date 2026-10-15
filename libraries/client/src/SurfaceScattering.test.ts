import { describe, expect, it } from '@effect/vitest';
import * as SurfaceScattering from '#src/SurfaceScattering.ts';

/** A stream of numbers from 0 to 1 that is the same for the same seed. */
const numbers = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

/** A way chosen evenly over the half of the sphere the surface faces, of 2π. */
const anyWayOut = (random: () => number): SurfaceScattering.Way => {
  const z = random();
  const across = Math.sqrt(Math.max(1 - z * z, 0));
  const angle = 2 * Math.PI * random();
  return [across * Math.cos(angle), across * Math.sin(angle), z];
};

/** All the light a surface sends toward `seen`, lit evenly from everywhere above it, by `count` ways chosen evenly. */
const sentInAll = (
  surface: SurfaceScattering.Prepared,
  seen: SurfaceScattering.Way,
  random: () => number,
  count = 60000,
) => {
  const sum = [0, 0, 0];
  for (let sample = 0; sample < count; sample++) {
    const sent = SurfaceScattering.scattered(surface, seen, anyWayOut(random));
    for (let part = 0; part < 3; part++) {
      sum[part] = (sum[part] ?? 0) + (sent[part] ?? 0);
    }
  }
  return sum.map((part) => (part / count) * 2 * Math.PI);
};

const seenAslant: SurfaceScattering.Way = [Math.sin(0.6), 0, Math.cos(0.6)];

describe('SurfaceScattering', () => {
  it('sends on as much as a white matte surface lit evenly from everywhere, as Lambert has it', () => {
    const matte = SurfaceScattering.prepare({ colour: [1, 1, 1], roughness: 1, metalness: 0 });

    const [sent = 0] = sentInAll(matte, seenAslant, numbers(1));

    // All of it, but for what its surface sends off as shine rather than taking it in.
    expect(sent).toBeGreaterThan(0.95);
    expect(sent).toBeLessThan(1.1);
  });

  it('sends a rough metal’s light coloured as the metal is, and never more than reached it', () => {
    const gold = SurfaceScattering.prepare({ colour: [1, 0.8, 0.3], roughness: 0.5, metalness: 1 });

    const [red = 0, green = 0, blue = 0] = sentInAll(gold, seenAslant, numbers(2));

    expect(red).toBeLessThan(1.02);
    expect(red).toBeGreaterThan(0.8);
    expect(green / red).toBeCloseTo(0.8, 1);
    expect(blue).toBeLessThan(green);
  });

  it('shines a smooth metal as a mirror does, every way it chooses about the mirrored one', () => {
    const mirror = SurfaceScattering.prepare({ colour: [1, 1, 1], roughness: 0.05, metalness: 1 });
    const random = numbers(3);

    for (let sample = 0; sample < 200; sample++) {
      const chosen = SurfaceScattering.sample(mirror, seenAslant, [random(), random(), random()]);
      const mirrored = -seenAslant[0] * chosen.way[0] + seenAslant[2] * chosen.way[2];
      expect(mirrored).toBeGreaterThan(0.99);
    }
  });

  it('chooses ways as likely as it says, each carrying what it scatters there over how likely it is', () => {
    const random = numbers(4);
    for (const surface of [
      { colour: [0.8, 0.2, 0.2] as const, roughness: 0.3, metalness: 0 },
      { colour: [0.9, 0.9, 0.9] as const, roughness: 0.6, metalness: 1 },
    ]) {
      const prepared = SurfaceScattering.prepare(surface);
      const [expected = 0] = sentInAll(prepared, seenAslant, random);
      let sum = 0;
      const count = 40000;
      for (let sample = 0; sample < count; sample++) {
        const chosen = SurfaceScattering.sample(prepared, seenAslant, [
          random(),
          random(),
          random(),
        ]);
        sum += chosen.carried[0];
        if (chosen.likelihood > 0) {
          expect(SurfaceScattering.likelihood(prepared, seenAslant, chosen.way)).toBeCloseTo(
            chosen.likelihood,
            4,
          );
        }
      }
      expect(sum / count).toBeCloseTo(expected, 1);
    }
  });

  it('sends nothing toward a way below its surface, nor from one', () => {
    const shiny = SurfaceScattering.prepare({ colour: [1, 1, 1], roughness: 0.3, metalness: 0 });

    expect(SurfaceScattering.scattered(shiny, seenAslant, [0, 0, -1])).toEqual([0, 0, 0]);
  });
});
