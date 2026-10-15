import { Strands } from '@egonitida/core';
import type { Quaternion } from '@egonitida/core';
import { Data, Effect } from 'effect';
import {
  Fn,
  cross,
  float,
  floor,
  int,
  min,
  mix,
  select,
  storage,
  uniform,
  vec3,
  vertexIndex,
} from 'three/tsl';
import * as Three from 'three/webgpu';

/**
 * A model's hair drawn as strands after the guides a game swings, y = h(x): the model's own strands, the lines `HairStrands`, each point placed every frame on the graphics device as `Strands.follow` places it, along the guides it follows as far as it is along its own strand, beside them as it was made, turned as their roots have turned. The model's guides, the lines `HairGuides`, and its hair as cards are not shown. Which guides each strand follows is worked out once, as the drawing is built; each frame the drawing is given only where the guides swing and how their roots have turned.
 */

/** The model has no strands to draw, or not as many as the hair counts, and why. */
export class Unfitted extends Data.TaggedError('Unfitted')<{ readonly reason: string }> {}

/** The lines of a model its hair is drawn as, and the lines of its guides, as the model names them. */
const STRANDS = 'HairStrands';
const GUIDES = 'HairGuides';

/** A buffer of four numbers at a time on the graphics device, `count` groups, which a shader reads. */
const buffer = (count: number) => {
  const values = new Float32Array(Math.max(count, 1) * 4);
  const attribute = new Three.StorageBufferAttribute(values, 4);
  return { values, attribute, node: storage(attribute, 'vec4', attribute.count).toReadOnly() };
};

/** `values`, three numbers each, as four each, the fourth nothing. */
const padded = (values: ReadonlyArray<number>, into: Float32Array) => {
  const count = values.length / 3;
  for (let point = 0; point < count; point++) {
    into[point * 4] = values[point * 3] ?? 0;
    into[point * 4 + 1] = values[point * 3 + 1] ?? 0;
    into[point * 4 + 2] = values[point * 3 + 2] ?? 0;
  }
};

/**
 * The colour of hair shaded as `shading` says, seen through twice, as light that goes into a strand and back out of it is: its melanin, as much of it red as its redness says, taking in light as Chiang's model has eumelanin and pheomelanin take it in, tinted. The drawing's colour until hair is shaded as that model shades it.
 */
export const colourOf = (shading: Strands.Shading): Three.Color => {
  const concentration = -Math.log(Math.max(1 - shading.melanin, 0.0001));
  const eumelanin = concentration * (1 - shading.melaninRedness);
  const pheomelanin = concentration * shading.melaninRedness;
  const [red, green, blue] = shading.tint;
  return new Three.Color(
    red * Math.exp(-2 * (eumelanin * 0.419 + pheomelanin * 0.187)),
    green * Math.exp(-2 * (eumelanin * 0.697 + pheomelanin * 0.4)),
    blue * Math.exp(-2 * (eumelanin * 1.37 + pheomelanin * 1.05)),
  );
};

/** `vector` turned by the quaternion `turn`, its axis in x, y, and z and its angle in w. */
const rotate = (turn: Three.Node<'vec4'>, vector: Three.Node<'vec3'>) => {
  const axis = turn.xyz;
  return vector.add(cross(axis, cross(axis, vector).add(vector.mul(turn.w))).mul(2));
};

/**
 * A model's hair drawn after its guides, made by `fit`: which guides each strand follows, and `draw`, which gives the drawing where they swing.
 */
export class Haired {
  /** Which guides each drawn strand follows, by its index, and by how much. */
  readonly bound: ReadonlyArray<Strands.Bound>;
  readonly #now: {
    readonly values: Float32Array;
    readonly attribute: Three.StorageBufferAttribute;
  };
  readonly #turns: {
    readonly values: Float32Array;
    readonly attribute: Three.StorageBufferAttribute;
  };

  constructor(
    bound: ReadonlyArray<Strands.Bound>,
    now: { readonly values: Float32Array; readonly attribute: Three.StorageBufferAttribute },
    turns: { readonly values: Float32Array; readonly attribute: Three.StorageBufferAttribute },
  ) {
    this.bound = bound;
    this.#now = now;
    this.#turns = turns;
  }

  /** Draws the strands after the guides swung to `now`, three numbers a point, the bone carrying each guide's root turned as `turns` say since it was made. */
  draw(now: ReadonlyArray<number>, turns: ReadonlyArray<Quaternion.Quaternion>): void {
    padded(now, this.#now.values);
    this.#now.attribute.needsUpdate = true;
    turns.forEach((turn, guide) => {
      this.#turns.values[guide * 4] = turn.x;
      this.#turns.values[guide * 4 + 1] = turn.y;
      this.#turns.values[guide * 4 + 2] = turn.z;
      this.#turns.values[guide * 4 + 3] = turn.w;
    });
    this.#turns.attribute.needsUpdate = true;
  }

  /** Where the drawing was last given the guides, four numbers a point. */
  guidesNow(): Float32Array {
    return this.#now.values;
  }

  /** How far the drawing was last given each guide's root as turned, four numbers a guide. */
  turnsNow(): Float32Array {
    return this.#turns.values;
  }
}

/**
 * `model`'s hair, counted and shaded as `hair` says, drawn as its strands after its guides: the lines `HairStrands` placed on the graphics device each frame as their guides swing, coloured as the hair is shaded, never culled, since where they are drawn is not where they were made; the lines `HairGuides`, and the meshes `cards` names, its hair as cards, `HairCards` unless named otherwise, not shown. Fails with `Unfitted` if the model has no lines `HairStrands`, or not as many points in them as the hair counts.
 */
export const fit = (
  model: Three.Object3D,
  hair: Strands.Hair,
  cards: ReadonlyArray<string> = ['HairCards'],
): Effect.Effect<Haired, Unfitted> =>
  Effect.suspend(() => {
    const drawn = model.getObjectByName(STRANDS);
    if (!(drawn instanceof Three.LineSegments)) {
      return Effect.fail(new Unfitted({ reason: `the model has no lines ${STRANDS}` }));
    }
    const position = drawn.geometry.getAttribute('position');
    const counted = (hair.drawn.scalp + hair.drawn.ponytail) * hair.drawn.points;
    if (position.count !== counted) {
      return Effect.fail(
        new Unfitted({
          reason: `${STRANDS} has ${position.count} points; the hair counts ${counted}`,
        }),
      );
    }
    const { guides } = hair;
    const strands = hair.drawn.scalp + hair.drawn.ponytail;
    const madeAt = Array.from({ length: position.count * 3 }, (_, value) =>
      value % 3 === 0
        ? position.getX(value / 3)
        : value % 3 === 1
          ? position.getY((value - 1) / 3)
          : position.getZ((value - 2) / 3),
    );
    const roots = Array.from({ length: strands }, (_, strand) =>
      madeAt.slice(strand * hair.drawn.points * 3, strand * hair.drawn.points * 3 + 3),
    ).flat();
    const bound = Strands.bind(guides, hair.drawn, roots);

    const drawnMade = buffer(position.count);
    padded(madeAt, drawnMade.values);
    const following = buffer(strands * 2);
    bound.forEach(({ guides: of, weights }, strand) => {
      for (let which = 0; which < 3; which++) {
        following.values[strand * 8 + which] = of[which] ?? 0;
        following.values[strand * 8 + 4 + which] = weights[which] ?? 0;
      }
    });
    const guidePoints = guides.at.length / 3;
    const guidesMade = buffer(guidePoints);
    padded(guides.at, guidesMade.values);
    const guidesNow = buffer(guidePoints);
    padded(guides.at, guidesNow.values);
    const turns = buffer(guides.scalp + guides.ponytail);
    for (let guide = 0; guide < guides.scalp + guides.ponytail; guide++) {
      turns.values[guide * 4 + 3] = 1;
    }

    const pointsDrawn = uniform(hair.drawn.points, 'int');
    const pointsGuided = uniform(guides.points, 'int');
    const placed = Fn(() => {
      const point = int(vertexIndex);
      const strand = point.div(pointsDrawn);
      const index = point.mod(pointsDrawn);
      const lastGuide = float(pointsGuided.sub(1));
      const along = float(index)
        .div(float(pointsDrawn.sub(1)))
        .mul(lastGuide);
      const below = min(floor(along), lastGuide.sub(1).max(0));
      const share = along.sub(below);
      const above = min(below.add(1), lastGuide);
      const made = drawnMade.node.element(point).xyz;
      const of = following.node.element(strand.mul(2));
      const weights = following.node.element(strand.mul(2).add(1));
      const total = weights.x.add(weights.y).add(weights.z);
      const towards = (guide: Three.Node<'float'>, weight: Three.Node<'float'>) => {
        const at = int(guide).mul(pointsGuided);
        const from = at.add(int(below));
        const to = at.add(int(above));
        const guideMade = mix(
          guidesMade.node.element(from).xyz,
          guidesMade.node.element(to).xyz,
          share,
        );
        const guideNow = mix(
          guidesNow.node.element(from).xyz,
          guidesNow.node.element(to).xyz,
          share,
        );
        return guideNow
          .add(rotate(turns.node.element(int(guide)), made.sub(guideMade)))
          .mul(weight);
      };
      const sum = towards(of.x, weights.x)
        .add(towards(of.y, weights.y))
        .add(towards(of.z, weights.z));
      return select(total.greaterThan(0), sum.div(total), made);
    })();

    const material = new Three.LineBasicNodeMaterial();
    material.positionNode = placed;
    const colour = colourOf(hair.shading);
    material.colorNode = vec3(colour.r, colour.g, colour.b);
    drawn.material = material;
    drawn.frustumCulled = false;
    drawn.visible = true;
    for (const hidden of [GUIDES, ...cards]) {
      const shown = model.getObjectByName(hidden);
      if (shown !== undefined) {
        shown.visible = false;
      }
    }
    return Effect.succeed(new Haired(bound, guidesNow, turns));
  });
