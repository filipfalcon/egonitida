import * as Maths from '#src/Maths.ts';
import type * as Ray from '#src/Ray.ts';

/**
 * Hair as strands, as plain data: polylines of points, each strand as many points as every other, root first, read from a model's file as the game is built (`?strands`, through `@egonitida/vite-plugin`). A figure's hair is drawn as many strands and swung as few guides, each drawn strand following the guides nearest its root; the strands over her scalp come first, then those down her ponytail, each kind following guides of its own. Where a point stands as the model was made, how wide it is, how stiff, and which bones carry it, are flat arrays, as a step and a view read them alike.
 */

/** Strands of hair as the model was made: how many points each strand has; how many lie over the scalp, coming first, and how many down a ponytail, after them; where each point stands, three numbers each, in the model's space; how wide each point is, in metres; how stiff, from nothing to a whole; one random number for each strand, from nothing to a whole; and which bones carry each point, four indices into `bones` each, with their four weights. */
export interface Strands {
  readonly points: number;
  readonly scalp: number;
  readonly ponytail: number;
  readonly at: ReadonlyArray<number>;
  readonly width: ReadonlyArray<number>;
  readonly stiffness: ReadonlyArray<number>;
  readonly random: ReadonlyArray<number>;
  readonly bones: ReadonlyArray<string>;
  readonly joints: ReadonlyArray<number>;
  readonly weights: ReadonlyArray<number>;
}

/** How hair is shaded, as Chiang's model has it, the way Blender's Principled Hair BSDF writes it: how much melanin it holds and how red that is, from nothing to a whole; the colour it is tinted, red, green, and blue; how rough along a strand and about it; how much it shines as a coat; how it bends light; how far its cuticle's scales tilt, in radians; and how much its colour and roughness vary, strand by strand. */
export interface Shading {
  readonly melanin: number;
  readonly melaninRedness: number;
  readonly tint: readonly [red: number, green: number, blue: number];
  readonly roughness: number;
  readonly radialRoughness: number;
  readonly coat: number;
  readonly ior: number;
  readonly offset: number;
  readonly randomColor: number;
  readonly randomRoughness: number;
}

/** A figure's hair as strands: the guides it swings as, every point of them; how many strands are drawn, of how many points, over the scalp and down a ponytail, whose points the drawing reads from the model itself; and how it is shaded. */
export interface Hair {
  readonly guides: Strands;
  readonly drawn: { readonly points: number; readonly scalp: number; readonly ponytail: number };
  readonly shading: Shading;
}

/** How a drawn strand follows its guides: up to three of them, by their index, each by its weight, the weights adding up to a whole. */
export interface Bound {
  readonly guides: ReadonlyArray<number>;
  readonly weights: ReadonlyArray<number>;
}

/** How many guides a drawn strand follows at most. */
const NEAREST = 3;

/** Where strand `strand` of `strands` is rooted: its first point. */
export const rootOf = (strands: Strands, strand: number): Ray.Point => {
  const at = strand * strands.points * 3;
  return {
    x: strands.at[at] ?? 0,
    y: strands.at[at + 1] ?? 0,
    z: strands.at[at + 2] ?? 0,
  };
};

/**
 * How each of the strands `drawn` counts follows `guides`, its roots, three numbers each, in `roots`: each the three guides of its own kind nearest its root, or every guide if none is of its kind, weighted by how near each is, the inverse of its distance; a strand rooted on a guide's root follows it alone. Worked out once, as a drawing is built.
 */
export const bind = (
  guides: Strands,
  drawn: { readonly scalp: number; readonly ponytail: number },
  roots: ReadonlyArray<number>,
): ReadonlyArray<Bound> => {
  const guideRoots = Array.from({ length: guides.scalp + guides.ponytail }, (_, guide) =>
    rootOf(guides, guide),
  );
  const ofKind = (ponytail: boolean) => {
    const kind = guideRoots
      .map((_, guide) => guide)
      .filter((guide) => guide >= guides.scalp === ponytail);
    return kind.length > 0 ? kind : guideRoots.map((_, guide) => guide);
  };
  const scalpGuides = ofKind(false);
  const ponytailGuides = ofKind(true);
  return Array.from({ length: drawn.scalp + drawn.ponytail }, (_, strand): Bound => {
    const x = roots[strand * 3] ?? 0;
    const y = roots[strand * 3 + 1] ?? 0;
    const z = roots[strand * 3 + 2] ?? 0;
    const nearest = (strand < drawn.scalp ? scalpGuides : ponytailGuides)
      .map((guide) => {
        const root = guideRoots[guide] ?? { x: 0, y: 0, z: 0 };
        return { guide, distance: Maths.hypot(root.x - x, root.y - y, root.z - z) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEAREST);
    const [first] = nearest;
    if (first !== undefined && first.distance === 0) {
      return {
        guides: nearest.map(({ guide }) => guide),
        weights: nearest.map((_, at) => (at === 0 ? 1 : 0)),
      };
    }
    const inverse = nearest.map(({ distance }) => 1 / distance);
    const total = inverse.reduce((sum, weight) => sum + weight, 0);
    return {
      guides: nearest.map(({ guide }) => guide),
      weights: inverse.map((weight) => weight / total),
    };
  });
};
