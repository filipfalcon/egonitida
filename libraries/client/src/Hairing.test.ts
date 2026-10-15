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

/** A model as delivered: her strands, each with a random number of its own, her guides, and her hair as cards. */
const model = () => {
  const made = new Three.Group();
  const strands = lines('HairStrands', drawnAt);
  strands.geometry.setAttribute(
    '_random',
    new Three.Float32BufferAttribute([0.25, 0.25, 0.25, 0.75, 0.75, 0.75], 1),
  );
  made.add(strands);
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
        const haired = yield* Hairing.fit(delivered, hair, { cards: ['HairCards', 'ponytail'] });

        const strands = delivered.getObjectByName('HairStrands');
        expect(strands?.visible).toBe(true);
        expect(strands?.frustumCulled).toBe(false);
        expect(strands).toBeInstanceOf(Three.LineSegments);
        expect(strands instanceof Three.LineSegments && strands.material).toBeInstanceOf(
          Three.LineBasicNodeMaterial,
        );
        expect(strands instanceof Three.LineSegments && strands.material.lights).toBe(true);
        // Thinner than a pixel, each strand covers as much of one as it is wide: drawn over what is behind it, never hiding the strands behind it.
        expect(strands instanceof Three.LineSegments && strands.material.transparent).toBe(true);
        expect(strands instanceof Three.LineSegments && strands.material.depthWrite).toBe(false);
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

  it.effect('draws only every so many strands, if asked, each covering as much more', () =>
    Effect.gen(function* () {
      const delivered = model();
      yield* Hairing.fit(delivered, hair, { every: 2 });

      const strands = delivered.getObjectByName('HairStrands');
      const index = strands instanceof Three.LineSegments ? strands.geometry.getIndex() : null;
      // The first of the two strands, its two links.
      expect(Array.from(index?.array ?? [])).toEqual([0, 1, 1, 2]);
    }),
  );

  it.effect(
    'gives each strand the random number its model gives it, or a middling one if none',
    () =>
      Effect.gen(function* () {
        const haired = yield* Hairing.fit(model(), hair);
        const plain = new Three.Group();
        plain.add(lines('HairStrands', drawnAt));

        expect(haired.randoms()).toEqual([0.25, 0.75]);
        expect((yield* Hairing.fit(plain, hair)).randoms()).toEqual([0.5, 0.5]);
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

describe('Hairing.coverage', () => {
  it('is as much of a pixel as a strand covers: its width over how wide a pixel is where it is', () => {
    // A thousand pixels a metre at a metre away: a strand 80 µm wide covers eight hundredths of one.
    expect(Hairing.coverage(0.00008, 1, 1000)).toBeCloseTo(0.08, 12);
    expect(Hairing.coverage(0.00008, 2, 1000)).toBeCloseTo(0.04, 12);
  });

  it('is a whole pixel at most, for a strand wider than one', () => {
    expect(Hairing.coverage(0.01, 1, 1000)).toBe(1);
  });
});

describe('Hairing.varied', () => {
  const varying = { ...hair.shading, randomColor: 0.2, randomRoughness: 0.1 };

  it('varies a strand as Blender’s Principled Hair does: its melanin by its colour’s randomness, its roughness by its own', () => {
    const most = Hairing.varied(varying, 1);
    const least = Hairing.varied(varying, 0);

    expect(most.melanin).toBeCloseTo(varying.melanin * 1.2, 12);
    expect(least.melanin).toBeCloseTo(varying.melanin * 0.8, 12);
    expect(most.roughness).toBeCloseTo(varying.roughness * 1.1, 12);
    expect(most.radialRoughness).toBeCloseTo(varying.radialRoughness * 1.1, 12);
  });

  it('leaves a strand of a middling random number as the hair is shaded', () => {
    expect(Hairing.varied(varying, 0.5)).toEqual(varying);
  });
});

describe('Hairing.absorptionOf', () => {
  it('takes light in as Blender’s Principled Hair does: its melanin as eumelanin and pheomelanin, and its tint', () => {
    const melanin = -Math.log(1 - 0.9);
    const taken = Hairing.absorptionOf({ ...hair.shading, melanin: 0.9, melaninRedness: 0.42 });

    expect(taken.r).toBeCloseTo(melanin * 0.58 * 0.506 + melanin * 0.42 * 0.343, 12);
    expect(taken.b).toBeCloseTo(melanin * 0.58 * 1.653 + melanin * 0.42 * 1.924, 12);
  });

  it('takes in more of what its tint lacks, nothing more for a white tint', () => {
    const white = Hairing.absorptionOf({ ...hair.shading, tint: [1, 1, 1] });
    const cyan = Hairing.absorptionOf({ ...hair.shading, tint: [0.5, 1, 1] });
    const x = hair.shading.radialRoughness;
    const scale = ((((0.245 * x + 5.574) * x - 10.73) * x + 2.532) * x - 0.215) * x + 5.969;

    expect(cyan.r - white.r).toBeCloseTo((Math.log(0.5) / scale) ** 2, 12);
    expect(cyan.g).toBeCloseTo(white.g, 12);
  });
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

describe('Hairing.lobes', () => {
  /** A strand standing along +y, seen from +z. */
  const along = { x: 0, y: 1, z: 0 };
  const toEye = { x: 0, y: 0, z: 1 };
  /** Light coming from the eye's side, `rise` up the strand from straight on, or from behind it. */
  const lit = (rise: number, behind = false) => {
    const unit = Math.hypot(rise, 1);
    return { x: 0, y: rise / unit, z: (behind ? -1 : 1) / unit };
  };
  const brown = hair.shading;
  const sum = ({ r, g, b }: { r: number; g: number; b: number }) => r + g + b;

  it('shines white off its surface, brightest where light glances back as from a mirror, shifted toward the root by its cuticle’s tilt', () => {
    const rises = Array.from({ length: 81 }, (_, step) => -0.4 + step / 100);
    const shine = rises.map((rise) => Hairing.lobes(brown, along, lit(rise), toEye).reflected);
    const brightest =
      rises[shine.reduce((best, now, at) => (sum(now) > sum(shine[best] ?? now) ? at : best), 0)];

    expect(shine[40]?.r).toBeCloseTo(shine[40]?.b ?? NaN, 12);
    // Its scales tilt toward the tip, so it glances brightest with light from below the mirror's angle.
    expect(brightest).toBeLessThan(0);
    expect(brightest).toBeCloseTo(-2 * Math.sin(brown.offset), 1);
  });

  it('glows through, its colour, when lit from behind, far more than when lit from before', () => {
    const behind = Hairing.lobes(brown, along, lit(0, true), toEye).transmitted;
    const before = Hairing.lobes(brown, along, lit(0), toEye).transmitted;

    expect(sum(behind)).toBeGreaterThan(sum(before) * 100);
    expect(behind.r).toBeGreaterThan(behind.g);
    expect(behind.g).toBeGreaterThan(behind.b);
  });

  it('shines a second time, coloured, from within', () => {
    const inner = Hairing.lobes(brown, along, lit(0.15), toEye).internal;

    expect(inner.r).toBeGreaterThan(inner.b);
    expect(sum(inner)).toBeGreaterThan(0);
  });

  it('scatters light many times within it, softly, its colour, wherever it is lit from', () => {
    const from = (light: { x: number; y: number; z: number }) =>
      Hairing.lobes(brown, along, light, toEye).scattered;
    const side = from({ x: 1, y: 0, z: 0 });

    expect(sum(side)).toBeGreaterThan(0);
    expect(side.r).toBeGreaterThan(side.g);
    expect(side.g).toBeGreaterThan(side.b);
    // Lit from before it, more than from behind it.
    expect(sum(from(lit(0)))).toBeGreaterThan(sum(from(lit(0, true))));
  });

  it('lets less light through and back the darker it is, its surface shining alike', () => {
    const dark = Hairing.lobes({ ...brown, melanin: 0.95 }, along, lit(0.1, true), toEye);
    const fair = Hairing.lobes({ ...brown, melanin: 0.3 }, along, lit(0.1, true), toEye);

    expect(sum(dark.transmitted)).toBeLessThan(sum(fair.transmitted));
    expect(sum(dark.reflected)).toBeCloseTo(sum(fair.reflected), 12);
  });
});

describe('Hairing.density and Hairing.transmittance', () => {
  /** Strands of two points standing up along +y, a centimetre long, at each of `xs` across, a slab of hair at z = 0. */
  const slab = (xs: ReadonlyArray<number>, z = 0) => ({
    at: xs.flatMap((x) => [x, 0, z, x, 0.01, z]),
    widths: xs.flatMap(() => [0.0001, 0.0001]),
  });
  const grid = Hairing.gridAbout([-0.1, -0.1, -0.1, 0.1, 0.1, 0.1], 8);
  const xs = Array.from({ length: 50 }, (_, at) => -0.05 + at * 0.002);

  it('holds as much hair, its length times its width, as the strands in it hold, over a voxel’s volume', () => {
    const { at, widths } = slab(xs);
    const held = Hairing.density(grid, at, widths, 2);
    const total = held.reduce((sum, value) => sum + value, 0) * grid.voxel ** 3;

    expect(total).toBeCloseTo(xs.length * 0.01 * 0.0001, 12);
  });

  it('lets all light through where no hair is between a point and the light', () => {
    const held = Hairing.density(grid, [], [], 2);

    expect(Hairing.transmittance(grid, held, { x: 0, y: 0, z: -0.05 }, { x: 0, y: 0, z: 1 })).toBe(
      1,
    );
  });

  it('lets less light through the more hair lies between a point and the light, and all of it from the other side', () => {
    const thin = Hairing.density(grid, slab(xs).at, slab(xs).widths, 2);
    const thick = Hairing.density(
      grid,
      [...slab(xs).at, ...slab(xs, 0.001).at, ...slab(xs, 0.002).at],
      [...slab(xs).widths, ...slab(xs).widths, ...slab(xs).widths],
      2,
    );
    const behind = { x: 0, y: 0, z: -0.05 };
    const towardSlab = { x: 0, y: 0, z: 1 };

    const throughThin = Hairing.transmittance(grid, thin, behind, towardSlab);
    expect(throughThin).toBeLessThan(1);
    expect(Hairing.transmittance(grid, thick, behind, towardSlab)).toBeLessThan(throughThin);
    expect(Hairing.transmittance(grid, thick, behind, { x: 0, y: 0, z: -1 })).toBe(1);
  });
});
