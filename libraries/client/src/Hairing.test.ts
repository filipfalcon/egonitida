import { describe, expect, it } from '@effect/vitest';
import { Quaternion, Strands } from '@egonitida/core';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Hairing from '#src/Hairing.ts';

/** Two guides of two points, a decimetre apart across, hanging a decimetre down from 1.7 m. */
const guides: Strands.Strands = {
  points: 2,
  scalp: 2,
  ponytail: 0,
  at: [-0.05, 1.7, 0.1, -0.05, 1.6, 0.1, 0.05, 1.7, 0.1, 0.05, 1.6, 0.1],
  width: [0.00008, 0.00003, 0.00008, 0.00003],
  stiffness: [1, 0.2, 1, 0.2],
  random: [0.3, 0.7],
  bones: ['head'],
  joints: Array.from({ length: 16 }, () => 0),
  weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
};

const hair: Strands.Hair = {
  guides,
  drawn: { points: 3, scalp: 2, ponytail: 0 },
  shading: {
    melanin: 0.8,
    melaninRedness: 0.3,
    tint: [1, 1, 1],
    roughness: 0.3,
    radialRoughness: 0.3,
    coat: 0,
    ior: 1.55,
    offset: 0.035,
    randomColor: 0,
    randomRoughness: 0,
  },
};

/** Two drawn strands of three points, one on each guide's root, as lines between their points. */
const drawnAt = [
  -0.05, 1.7, 0.1, -0.05, 1.65, 0.1, -0.05, 1.6, 0.1, 0.05, 1.7, 0.1, 0.05, 1.65, 0.1, 0.05, 1.6,
  0.1,
];

/** Lines through `at`, three points a strand, named `name`. */
const lines = (name: string, at: ReadonlyArray<number>) => {
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute('position', new Three.Float32BufferAttribute([...at], 3));
  const strands = at.length / 9;
  geometry.setIndex(
    Array.from({ length: strands }, (_, strand) => [
      strand * 3,
      strand * 3 + 1,
      strand * 3 + 1,
      strand * 3 + 2,
    ]).flat(),
  );
  const drawn = new Three.LineSegments(geometry, new Three.LineBasicMaterial());
  drawn.name = name;
  return drawn;
};

/** A model as delivered: her strands, her guides, and her hair as cards. */
const model = () => {
  const made = new Three.Group();
  made.add(lines('HairStrands', drawnAt));
  made.add(lines('HairGuides', guides.at));
  for (const name of ['HairCards', 'ponytail']) {
    const cards = new Three.Mesh(new Three.BufferGeometry(), new Three.MeshBasicMaterial());
    cards.name = name;
    made.add(cards);
  }
  return made;
};

describe('Hairing.fit', () => {
  it.effect(
    'draws her strands after her guides, never culled, and shows neither her guides nor the cards named',
    () =>
      Effect.gen(function* () {
        const delivered = model();
        const haired = yield* Hairing.fit(delivered, hair, ['HairCards', 'ponytail']);

        const strands = delivered.getObjectByName('HairStrands');
        expect(strands?.visible).toBe(true);
        expect(strands?.frustumCulled).toBe(false);
        expect(strands).toBeInstanceOf(Three.LineSegments);
        expect(strands instanceof Three.LineSegments && strands.material).toBeInstanceOf(
          Three.LineBasicNodeMaterial,
        );
        expect(delivered.getObjectByName('HairGuides')?.visible).toBe(false);
        expect(delivered.getObjectByName('HairCards')?.visible).toBe(false);
        expect(delivered.getObjectByName('ponytail')?.visible).toBe(false);
        // Each strand on a guide's root follows that guide, as the core binds it from where the model holds its roots.
        const expected = Strands.bind(
          guides,
          hair.drawn,
          drawnAt.filter((_, index) => index % 9 < 3).map((value) => Math.fround(value)),
        );
        expect(haired.bound.map(({ guides: of }) => of)).toEqual(
          expected.map(({ guides: of }) => of),
        );
        haired.bound.forEach(({ weights }, strand) =>
          weights.forEach((weight, which) =>
            expect(weight).toBeCloseTo(expected[strand]?.weights[which] ?? NaN, 6),
          ),
        );
      }),
  );

  it.effect('gives the drawing where her guides swing and how far their roots have turned', () =>
    Effect.gen(function* () {
      const haired = yield* Hairing.fit(model(), hair);
      const swung = guides.at.map((value, index) => value + (index % 3 === 0 ? 0.1 : 0));
      const turn = Quaternion.about({ x: 0, y: 1, z: 0 }, 0.5);

      haired.draw(swung, [turn, Quaternion.identity]);

      const now = Array.from(haired.guidesNow());
      expect(now.filter((_, index) => index % 4 !== 3)).toEqual(
        swung.map((value) => Math.fround(value)),
      );
      expect(Array.from(haired.turnsNow()).slice(0, 4)).toEqual(
        [turn.x, turn.y, turn.z, turn.w].map((value) => Math.fround(value)),
      );
    }),
  );

  it.effect('refuses a model with no strands, or strands the hair counts otherwise', () =>
    Effect.gen(function* () {
      const bare = new Three.Group();
      const short = new Three.Group();
      short.add(lines('HairStrands', drawnAt.slice(0, 9)));

      expect((yield* Effect.flip(Hairing.fit(bare, hair)))._tag).toBe('Unfitted');
      expect((yield* Effect.flip(Hairing.fit(short, hair))).reason).toBe(
        'HairStrands has 3 points; the hair counts 6',
      );
    }),
  );
});

describe('Hairing.colourOf', () => {
  it('is dark brown for hair as dark as the baller’s, seen through twice', () => {
    const brown = Hairing.colourOf({ ...hair.shading, melanin: 0.9, melaninRedness: 0.42 });

    expect(brown.r).toBeLessThan(0.3);
    expect(brown.r).toBeGreaterThan(brown.g);
    expect(brown.g).toBeGreaterThan(brown.b);
  });

  it('is darker the more melanin hair holds, and redder the more of it is red', () => {
    const dark = Hairing.colourOf({ ...hair.shading, melanin: 0.9, melaninRedness: 0 });
    const fair = Hairing.colourOf({ ...hair.shading, melanin: 0.2, melaninRedness: 0 });
    const red = Hairing.colourOf({ ...hair.shading, melanin: 0.6, melaninRedness: 1 });

    expect(dark.r + dark.g + dark.b).toBeLessThan(fair.r + fair.g + fair.b);
    expect(red.r - red.b).toBeGreaterThan(0.2);
  });
});
