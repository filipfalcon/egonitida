import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import { binary, glb } from '#src/fixtures.ts';
import * as Strands from '#src/Strands.ts';

/** Her hair as the model writes it: Chiang's values on the strands' material, the offset in degrees. */
const shading = {
  model: 'chiang',
  melanin: 0.9,
  melaninRedness: 0.42,
  tint: [1, 1, 1],
  roughness: 0.32,
  radialRoughness: 0.3,
  coat: 0,
  ior: 1.55,
  offset: 2,
  randomColor: 0.1,
  randomRoughness: 0.1,
};

/** Guides of two points: one over her scalp on her head, one down her ponytail on its bone, made 0.1 m long. */
const guides = binary([
  { type: 'VEC3', componentType: 5126, values: [0, 1.7, 0, 0, 1.6, 0, 0, 1.6, -0.1, 0, 1.5, -0.1] },
  { type: 'SCALAR', componentType: 5126, values: [0.00008, 0.00003, 0.00008, 0.00003] },
  { type: 'SCALAR', componentType: 5126, values: [1, 0.2, 0.6, 0.1] },
  { type: 'SCALAR', componentType: 5126, values: [0.25, 0.25, 0.75, 0.75] },
  { type: 'VEC4', componentType: 5121, values: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  {
    type: 'VEC4',
    componentType: 5126,
    values: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0],
  },
]);

/** A head with a ponytail, carrying her guides, and two drawn strands over her scalp, made of the same points; `change` changes what the model writes. */
const head = (
  change: (json: Record<string, unknown>) => Record<string, unknown> = (json) => json,
) =>
  glb(
    change({
      asset: { version: '2.0' },
      nodes: [
        { name: 'head', children: [1] },
        { name: 'ponytail_01' },
        { name: 'HairGuides', mesh: 0, skin: 0 },
        { name: 'HairStrands', mesh: 1, skin: 0 },
      ],
      skins: [{ joints: [0, 1] }],
      materials: [{ name: 'HairStrands', extras: { hair: shading } }],
      meshes: [
        {
          name: 'HairGuides',
          extras: { strands: { points: 2, scalp: 1, ponytail: 1 } },
          primitives: [
            {
              mode: 1,
              material: 0,
              attributes: {
                POSITION: 0,
                _WIDTH: 1,
                _STIFFNESS: 2,
                _RANDOM: 3,
                JOINTS_0: 4,
                WEIGHTS_0: 5,
              },
            },
          ],
        },
        {
          name: 'HairStrands',
          extras: { strands: { points: 2, scalp: 2, ponytail: 0 } },
          primitives: [{ mode: 1, material: 0, attributes: { POSITION: 0 } }],
        },
      ],
      accessors: guides.accessors,
      bufferViews: guides.bufferViews,
    }),
    guides.bytes,
  );

/** Why her hair could not be read, or that it was. */
const whyNot = (bytes: Uint8Array) =>
  Result.match(Strands.read(bytes), { onFailure: (reason) => reason, onSuccess: () => 'read' });

describe('Strands.read', () => {
  const hair = Result.getOrThrow(Strands.read(head()));

  it('reads her guides: how many points each has, how many over her scalp and down her ponytail, and where each point stands', () => {
    expect(hair.guides.points).toBe(2);
    expect(hair.guides.scalp).toBe(1);
    expect(hair.guides.ponytail).toBe(1);
    expect(hair.guides.at).toEqual([0, 1.7, 0, 0, 1.6, 0, 0, 1.6, -0.1, 0, 1.5, -0.1]);
  });

  it('reads each point as the shortest decimal that is the float the model stores', () => {
    expect(hair.guides.width).toEqual([0.00008, 0.00003, 0.00008, 0.00003]);
    expect(hair.guides.stiffness).toEqual([1, 0.2, 0.6, 0.1]);
  });

  it('reads one random number for each strand, from its root', () => {
    expect(hair.guides.random).toEqual([0.25, 0.75]);
  });

  it('reads the bones that carry each point by their names, with their weights', () => {
    expect(hair.guides.bones).toEqual(['head', 'ponytail_01']);
    expect(hair.guides.joints.slice(12, 16)).toEqual([1, 0, 0, 0]);
    expect(hair.guides.weights.slice(12, 16)).toEqual([0.5, 0.5, 0, 0]);
  });

  it('counts the strands drawn, over her scalp and down her ponytail, as the model counts them', () => {
    expect(hair.drawn).toEqual({ points: 2, scalp: 2, ponytail: 0 });
  });

  it('reads how her hair is shaded, its offset in radians', () => {
    expect(hair.shading.melanin).toBeCloseTo(0.9, 12);
    expect(hair.shading.tint).toEqual([1, 1, 1]);
    expect(hair.shading.offset).toBeCloseTo((2 * Math.PI) / 180, 12);
  });
});

describe('hair the reader refuses', () => {
  it('is no hair at all', () => {
    expect(whyNot(head((json) => ({ ...json, meshes: [] })))).toBe(
      'it has no mesh named HairGuides',
    );
  });

  it('is drawn as no lines', () => {
    expect(
      whyNot(
        head((json) => ({
          ...json,
          meshes: [
            {
              name: 'HairGuides',
              extras: { strands: { points: 2, scalp: 1, ponytail: 1 } },
              primitives: [{ mode: 4, material: 0, attributes: { POSITION: 0 } }],
            },
            { name: 'HairStrands', extras: { strands: { points: 16, scalp: 1, ponytail: 0 } } },
          ],
        })),
      ),
    ).toBe('its mesh HairGuides is drawn as no lines');
  });

  it('counts its strands as other than its points make', () => {
    expect(
      whyNot(
        head((json) => ({
          ...json,
          meshes: [
            {
              name: 'HairGuides',
              extras: { strands: { points: 2, scalp: 3, ponytail: 1 } },
              primitives: [{ mode: 1, material: 0, attributes: { POSITION: 0 } }],
            },
          ],
        })),
      ),
    ).toBe('its mesh HairGuides counts 4 strands of 2 points, but holds 4 points');
  });

  it('is shaded as no model it knows', () => {
    expect(
      whyNot(
        head((json) => ({
          ...json,
          materials: [
            { name: 'HairStrands', extras: { hair: { ...shading, model: 'marschner' } } },
          ],
        })),
      ),
    ).toBe('its hair is shaded by marschner, which is no model the reader knows');
  });
});

describe('Strands.sourceOf', () => {
  it.effect('is a module whose hair is what was read', () =>
    Effect.gen(function* () {
      const hair = Result.getOrThrow(Strands.read(head()));
      const file = join(mkdtempSync(join(tmpdir(), 'strands-')), 'head.strands.mjs');
      writeFileSync(file, Strands.sourceOf('/models/head.glb', hair));

      const given = yield* Effect.promise(() => import(pathToFileURL(file).href));

      expect(given.default).toEqual(hair);
    }),
  );
});

describe('Strands.plugin', () => {
  it('gives a model asked for its strands the module of them, watching its file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'strands-')), 'head.glb');
    writeFileSync(file, head());
    const watched: Array<string> = [];

    const source = Strands.plugin().load.call(
      { addWatchFile: (watching) => watched.push(watching) },
      `${file}?strands&import`,
    );

    expect(source).toContain('"drawn":{"points":2,"scalp":2,"ponytail":0}');
    expect(watched).toEqual([file]);
  });
});
