import { Strands } from '@egonitida/core';
import type { Quaternion } from '@egonitida/core';
import { Data, Effect } from 'effect';
import {
  Fn,
  abs,
  asin,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  int,
  min,
  mix,
  modelViewMatrix,
  normalize,
  positionViewDirection,
  pow,
  saturate,
  select,
  sqrt,
  storage,
  uniform,
  varying,
  vec3,
  vec4,
  vertexIndex,
} from 'three/tsl';
import * as Three from 'three/webgpu';

/**
 * A model's hair drawn as strands after the guides a game swings, y = h(x): the model's own strands, the lines `HairStrands`, each point placed every frame on the graphics device as `Strands.follow` places it, along the guides it follows as far as it is along its own strand, beside them as it was made, turned as their roots have turned. Each strand is lit as hair is, by every light of the scene, as Marschner's model scatters light off it, through it, and back off its inside, along the way it runs (`lobes`, worked out the same on the graphics device). The model's guides, the lines `HairGuides`, and its hair as cards are not shown. Which guides each strand follows is worked out once, as the drawing is built; each frame the drawing is given only where the guides swing and how their roots have turned.
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

/** A colour, as much red, green, and blue as it has, each from nothing. */
export interface Colour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** How much light hair shaded as `shading` takes in, red, green, and blue, for every strand's width it goes through: its melanin, as much of it red as its redness says, eumelanin and pheomelanin each taking light in as Chiang's model has them. */
export const absorptionOf = (shading: Strands.Shading): Colour => {
  const concentration = -Math.log(Math.max(1 - shading.melanin, 0.0001));
  const eumelanin = concentration * (1 - shading.melaninRedness);
  const pheomelanin = concentration * shading.melaninRedness;
  return {
    r: eumelanin * 0.419 + pheomelanin * 0.187,
    g: eumelanin * 0.697 + pheomelanin * 0.4,
    b: eumelanin * 1.37 + pheomelanin * 1.05,
  };
};

/**
 * The colour of hair shaded as `shading` says, seen through twice, as light that goes into a strand and back out of it is: its melanin taking light in, tinted. What light about it, coming from everywhere at once, makes of it.
 */
export const colourOf = (shading: Strands.Shading): Three.Color => {
  const taken = absorptionOf(shading);
  const [red, green, blue] = shading.tint;
  return new Three.Color(
    red * Math.exp(-2 * taken.r),
    green * Math.exp(-2 * taken.g),
    blue * Math.exp(-2 * taken.b),
  );
};

/** How light a strand scatters toward the eye comes off it: off its surface, white; through it, coloured by its melanin; and back off its inside, coloured too. */
export interface Lobes {
  readonly reflected: Colour;
  readonly transmitted: Colour;
  readonly internal: Colour;
}

type Direction = { readonly x: number; readonly y: number; readonly z: number };

const dotOf = (a: Direction, b: Direction) => a.x * b.x + a.y * b.y + a.z * b.z;
const clamped = (value: number) => Math.min(Math.max(value, 0), 1);

/** How wide a lobe spreads at `width`, `angle` from its middle: a Gaussian, of area a whole. */
const spread = (width: number, angle: number) =>
  Math.exp((-0.5 * angle * angle) / (width * width)) / (Math.sqrt(2 * Math.PI) * width);

/** How much light a surface turns back, of `facing` straight on, at the cosine `cosine` from it, as Schlick has it. */
const fresnel = (facing: number, cosine: number) => facing + (1 - facing) * (1 - cosine) ** 5;

/**
 * How light from the way `toLight` scatters toward the eye, the way `toEye`, off a strand of hair shaded as `shading`, running along `tangent`, each of length one: as Marschner's model has it, in the shape Karis gives it for drawing every frame. Off its surface (R), white, in a cone about the mirror's angle shifted toward the root by twice its cuticle's tilt; through it (TT), coloured by twice the width of melanin it crosses, strongest lit from behind, shifted the other way by the tilt; and back off its inside (TRT), coloured more, shifted by four times the tilt. Each lobe is as narrow as the hair is smooth along it. The graphics device works the same out for every light, every pixel of every strand.
 */
export const lobes = (
  shading: Strands.Shading,
  tangent: Direction,
  toLight: Direction,
  toEye: Direction,
): Lobes => {
  const sinLight = clamped(dotOf(tangent, toLight) * 0.5 + 0.5) * 2 - 1;
  const sinEye = clamped(dotOf(tangent, toEye) * 0.5 + 0.5) * 2 - 1;
  const cosHalfDifference = Math.cos(0.5 * Math.abs(Math.asin(sinEye) - Math.asin(sinLight)));
  const lightAcross = {
    x: toLight.x - tangent.x * sinLight,
    y: toLight.y - tangent.y * sinLight,
    z: toLight.z - tangent.z * sinLight,
  };
  const eyeAcross = {
    x: toEye.x - tangent.x * sinEye,
    y: toEye.y - tangent.y * sinEye,
    z: toEye.z - tangent.z * sinEye,
  };
  const cosAround =
    dotOf(lightAcross, eyeAcross) /
    Math.sqrt(dotOf(lightAcross, lightAcross) * dotOf(eyeAcross, eyeAcross) + 1e-4);
  const cosHalfAround = Math.sqrt(clamped(0.5 + 0.5 * cosAround));
  const facing = ((1 - shading.ior) / (1 + shading.ior)) ** 2;
  const bending = 1 / (1.19 / cosHalfDifference + 0.36 * cosHalfDifference);
  const tilt = Math.sin(shading.offset);
  const width = Math.max(shading.roughness, 0.001) ** 2;
  const along = sinLight + sinEye;
  const taken = absorptionOf(shading);
  const [red, green, blue] = shading.tint;
  const through = (path: number): Colour => ({
    r: red * Math.exp(-taken.r * path),
    g: green * Math.exp(-taken.g * path),
    b: blue * Math.exp(-taken.b * path),
  });
  const times = (colour: Colour, by: number): Colour => ({
    r: colour.r * by,
    g: colour.g * by,
    b: colour.b * by,
  });

  const reflected =
    spread(width * Math.SQRT2 * cosHalfAround, along + 2 * tilt) *
    0.25 *
    cosHalfAround *
    fresnel(facing, Math.sqrt(clamped(0.5 + 0.5 * dotOf(toLight, toEye))));

  const entering = cosHalfAround * (1 + bending * (0.6 - 0.8 * cosAround));
  const leaving = fresnel(facing, cosHalfDifference * Math.sqrt(clamped(1 - entering * entering)));
  const transmitted = times(
    through((2 * Math.sqrt(clamped(1 - (entering * bending) ** 2))) / cosHalfDifference),
    spread(width / 2, along - tilt) * Math.exp(-3.65 * cosAround - 3.98) * (1 - leaving) ** 2,
  );

  const inside = fresnel(facing, cosHalfDifference * 0.5);
  const internal = times(
    through(3.2 / cosHalfDifference),
    spread(width * 2, along - 4 * tilt) *
      Math.exp(17 * cosAround - 16.78) *
      (1 - inside) ** 2 *
      inside,
  );

  return { reflected: { r: reflected, g: reflected, b: reflected }, transmitted, internal };
};

/** `vector` turned by the quaternion `turn`, its axis in x, y, and z and its angle in w. */
const rotate = (turn: Three.Node<'vec4'>, vector: Three.Node<'vec3'>) => {
  const axis = turn.xyz;
  return vector.add(cross(axis, cross(axis, vector).add(vector.mul(turn.w))).mul(2));
};

/** `node`, whatever it holds, converted on the graphics device to three numbers. */
const asVec3 = (node: Three.Node) => new Three.ConvertNode<'vec3'>(node, 'vec3');

/** `node` is a node of the graphics device's. */
const isNode = (node: unknown): node is Three.Node => node instanceof Three.Node;

/** The light about a strand as a material's lighting has it, where the light coming from everywhere at once is added up: what falls on it, and what it gives back. */
const ambientOf = (context: unknown) => {
  if (typeof context !== 'object' || context === null) {
    return undefined;
  }
  const irradiance = 'irradiance' in context ? context.irradiance : undefined;
  const reflected = 'reflectedLight' in context ? context.reflectedLight : undefined;
  const diffuse =
    typeof reflected === 'object' && reflected !== null && 'indirectDiffuse' in reflected
      ? reflected.indirectDiffuse
      : undefined;
  return isNode(irradiance) && isNode(diffuse) ? { irradiance, diffuse } : undefined;
};

/** `lobes` on the graphics device: what light from `toLight` scatters toward the eye, along `toEye`, off a strand shaded as `shading` running along `tangent`, all their lobes added up. */
const scattered = (
  shading: Strands.Shading,
  tangent: Three.Node<'vec3'>,
  toLight: Three.Node<'vec3'>,
  toEye: Three.Node<'vec3'>,
) => {
  const sinLight = clamp(dot(tangent, toLight), -1, 1);
  const sinEye = clamp(dot(tangent, toEye), -1, 1);
  const cosHalfDifference = cos(abs(asin(sinEye).sub(asin(sinLight))).mul(0.5));
  const lightAcross = toLight.sub(tangent.mul(sinLight));
  const eyeAcross = toEye.sub(tangent.mul(sinEye));
  const cosAround = dot(lightAcross, eyeAcross).div(
    sqrt(dot(lightAcross, lightAcross).mul(dot(eyeAcross, eyeAcross)).add(1e-4)),
  );
  const cosHalfAround = sqrt(saturate(cosAround.mul(0.5).add(0.5)));
  const facing = ((1 - shading.ior) / (1 + shading.ior)) ** 2;
  const surface = (cosine: Three.Node<'float'>) =>
    float(1 - facing)
      .mul(pow(float(1).sub(cosine), 5))
      .add(facing);
  const spreadOf = (width: Three.Node<'float'>, angle: Three.Node<'float'>) =>
    exp(angle.mul(angle).mul(-0.5).div(width.mul(width))).div(width.mul(Math.sqrt(2 * Math.PI)));
  const bending = float(1).div(float(1.19).div(cosHalfDifference).add(cosHalfDifference.mul(0.36)));
  const tilt = Math.sin(shading.offset);
  const width = Math.max(shading.roughness, 0.001) ** 2;
  const along = sinLight.add(sinEye);
  const taken = absorptionOf(shading);
  const [red, green, blue] = shading.tint;
  const through = (path: Three.Node<'float'>) =>
    vec3(red, green, blue).mul(exp(vec3(taken.r, taken.g, taken.b).mul(path).negate()));

  const reflected = spreadOf(cosHalfAround.mul(width * Math.SQRT2), along.add(2 * tilt))
    .mul(cosHalfAround.mul(0.25))
    .mul(surface(sqrt(saturate(dot(toLight, toEye).mul(0.5).add(0.5)))));

  const entering = cosHalfAround.mul(bending.mul(float(0.6).sub(cosAround.mul(0.8))).add(1));
  const leaving = surface(
    cosHalfDifference.mul(sqrt(saturate(float(1).sub(entering.mul(entering))))),
  );
  const transmitted = through(
    sqrt(saturate(float(1).sub(entering.mul(bending).mul(entering.mul(bending)))))
      .mul(2)
      .div(cosHalfDifference),
  ).mul(
    spreadOf(float(width / 2), along.sub(tilt))
      .mul(exp(cosAround.mul(-3.65).sub(3.98)))
      .mul(float(1).sub(leaving).mul(float(1).sub(leaving))),
  );

  const inside = surface(cosHalfDifference.mul(0.5));
  const internal = through(float(3.2).div(cosHalfDifference)).mul(
    spreadOf(float(width * 2), along.sub(4 * tilt))
      .mul(exp(cosAround.mul(17).sub(16.78)))
      .mul(float(1).sub(inside).mul(float(1).sub(inside)).mul(inside)),
  );

  return transmitted.add(internal).add(reflected);
};

/** How a strand is lit: each light scattered off it as `lobes` has it, along the way the strand runs; and the light from everywhere at once taken in and given back as its colour seen through twice. */
class HairLighting extends Three.LightingModel {
  readonly #shading: Strands.Shading;
  readonly #tangent: Three.Node<'vec3'>;

  constructor(shading: Strands.Shading, tangent: Three.Node<'vec3'>) {
    super();
    this.#shading = shading;
    this.#tangent = tangent;
  }

  override direct({
    lightDirection,
    lightColor,
    reflectedLight,
  }: Three.LightingModelDirectInput): void {
    const lit = scattered(
      this.#shading,
      normalize(this.#tangent),
      asVec3(lightDirection),
      positionViewDirection,
    ).mul(asVec3(lightColor));
    reflectedLight.directSpecular.assign(asVec3(reflectedLight.directSpecular).add(lit));
  }

  override indirect(builder: Three.NodeBuilder): void {
    const ambient = ambientOf(builder.context);
    if (ambient === undefined) {
      return;
    }
    const colour = colourOf(this.#shading);
    const given = asVec3(ambient.irradiance)
      .mul(vec3(colour.r, colour.g, colour.b))
      .mul(1 / Math.PI);
    ambient.diffuse.assign(asVec3(ambient.diffuse).add(given));
  }
}

/** Strands drawn as lines, lit as hair is: by `HairLighting`. */
class HairMaterial extends Three.LineBasicNodeMaterial {
  readonly #shading: Strands.Shading;
  readonly #tangent: Three.Node<'vec3'>;

  constructor(shading: Strands.Shading, tangent: Three.Node<'vec3'>) {
    super();
    this.lights = true;
    this.#shading = shading;
    this.#tangent = tangent;
  }

  override setupLightingModel(): Three.LightingModel {
    return new HairLighting(this.#shading, this.#tangent);
  }
}

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
 * `model`'s hair, counted and shaded as `hair` says, drawn as its strands after its guides: the lines `HairStrands` placed on the graphics device each frame as their guides swing, lit as hair shaded as the hair says is, never culled, since where they are drawn is not where they were made; the lines `HairGuides`, and the meshes `cards` names, its hair as cards, `HairCards` unless named otherwise, not shown. Fails with `Unfitted` if the model has no lines `HairStrands`, or not as many points in them as the hair counts.
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
    /** Where the drawn point `point` is placed now, as `Strands.follow` places it. */
    const placedAt = (point: Three.Node<'int'>) => {
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
    };
    const placed = Fn(() => placedAt(int(vertexIndex)))();
    // The way the strand runs at each point, toward its tip, in the camera's space, for its shading.
    const tangent = varying(
      Fn(() => {
        const point = int(vertexIndex);
        const here = placedAt(point);
        const last = point.mod(pointsDrawn).equal(pointsDrawn.sub(1));
        const way = select(
          last,
          here.sub(placedAt(point.sub(1))),
          placedAt(point.add(1)).sub(here),
        );
        return modelViewMatrix.mul(vec4(way, 0)).xyz;
      })(),
      'vHairTangent',
    );

    const colour = colourOf(hair.shading);
    const material = new HairMaterial(hair.shading, tangent);
    material.positionNode = placed;
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
