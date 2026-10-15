import { Strands } from '@egonitida/core';
import type { Quaternion } from '@egonitida/core';
import { Data, Effect, Option } from 'effect';
import {
  Fn,
  If,
  Loop,
  abs,
  asin,
  atomicAdd,
  atomicLoad,
  atomicStore,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  instanceIndex,
  int,
  length,
  log,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrixInverse,
  normalize,
  positionView,
  positionViewDirection,
  pow,
  saturate,
  screenSize,
  select,
  sqrt,
  storage,
  uint,
  uniform,
  varying,
  vec3,
  vec4,
  vertexIndex,
} from 'three/tsl';
import * as Three from 'three/webgpu';

/**
 * A model's hair drawn as strands after the guides a game swings, y = h(x): the model's own strands, the lines `HairStrands`, each point placed every frame on the graphics device as `Strands.follow` places it, along the guides it follows as far as it is along its own strand, beside them as it was made, turned as their roots have turned. Each strand is lit as hair is, by every light of the scene, as Marschner's model scatters light off it, through it, and back off its inside, along the way it runs (`lobes`, worked out the same on the graphics device), each strand varied in its colour and roughness by its own random number, as the model gives it (`varied`). The model's guides, the lines `HairGuides`, and its hair as cards are not shown. Which guides each strand follows is worked out once, as the drawing is built; each frame the drawing is given only where the guides swing and how their roots have turned.
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

/** How far a strand rough about it as `around` spreads light across it, as Blender's Principled Hair fits it, which its tint's absorption is worked out by. */
const roughnessScale = (around: number) =>
  ((((0.245 * around + 5.574) * around - 10.73) * around + 2.532) * around - 0.215) * around +
  5.969;

/** How much light hair shaded as `shading` takes in, red, green, and blue, for every strand's width it goes through, as Blender's Principled Hair has it: its melanin, as much of it red as its redness says, eumelanin and pheomelanin each taking light in as Blender has them; and as much more as leaves its tint as it is, white taking in nothing more. */
export const absorptionOf = (shading: Strands.Shading): Colour => {
  const concentration = -Math.log(Math.max(1 - shading.melanin, 0.0001));
  const eumelanin = concentration * (1 - shading.melaninRedness);
  const pheomelanin = concentration * shading.melaninRedness;
  const scale = roughnessScale(shading.radialRoughness);
  const tinted = (part: number) => (Math.log(Math.max(part, 0.0001)) / scale) ** 2;
  const [red, green, blue] = shading.tint;
  return {
    r: eumelanin * 0.506 + pheomelanin * 0.343 + tinted(red),
    g: eumelanin * 0.841 + pheomelanin * 0.733 + tinted(green),
    b: eumelanin * 1.653 + pheomelanin * 1.924 + tinted(blue),
  };
};

/** A box of voxels about hair, square to the model's axes: its least corner, how wide each voxel is, in metres, and how many voxels it has along each side. */
export interface Grid {
  readonly from: Direction;
  readonly voxel: number;
  readonly size: number;
}

/** A cube of `size` voxels a side about every point of `at`, three numbers each, half a voxel and as much as `margin` more on every side; a cube a millimetre wide about the origin if there are none. */
export const gridAbout = (at: ReadonlyArray<number>, size: number, margin = 0): Grid => {
  const least = [Infinity, Infinity, Infinity];
  const most = [-Infinity, -Infinity, -Infinity];
  for (let value = 0; value < at.length; value++) {
    const axis = value % 3;
    least[axis] = Math.min(least[axis] ?? Infinity, at[value] ?? 0);
    most[axis] = Math.max(most[axis] ?? -Infinity, at[value] ?? 0);
  }
  const middle = least.map((low, axis) =>
    Number.isFinite(low) ? (low + (most[axis] ?? low)) / 2 : 0,
  );
  const widest = Math.max(
    ...least.map((low, axis) => (Number.isFinite(low) ? (most[axis] ?? low) - low : 0)),
    0.001,
  );
  const side = (widest + 2 * margin) * (size / (size - 1));
  return {
    from: {
      x: (middle[0] ?? 0) - side / 2,
      y: (middle[1] ?? 0) - side / 2,
      z: (middle[2] ?? 0) - side / 2,
    },
    voxel: side / size,
    size,
  };
};

/** The voxel of `grid` the point `x`, `y`, `z` lies in, by its index, x fastest; none outside it. */
const voxelOf = (grid: Grid, x: number, y: number, z: number): number | undefined => {
  const across = Math.floor((x - grid.from.x) / grid.voxel);
  const up = Math.floor((y - grid.from.y) / grid.voxel);
  const along = Math.floor((z - grid.from.z) / grid.voxel);
  return across < 0 ||
    up < 0 ||
    along < 0 ||
    across >= grid.size ||
    up >= grid.size ||
    along >= grid.size
    ? undefined
    : across + grid.size * (up + grid.size * along);
};

/**
 * How much hair each voxel of `grid` holds, as the strands of `points` points each, through `at`, three numbers a point, `widths` wide at each, lie in it: each link, from a point to the next of its strand, as long as it is times as wide as the point it starts from, in the voxel that point lies in, over a voxel's volume, so that light going a metre through a voxel crosses as much of a strand's breadth as the voxel holds. The graphics device adds the same up every frame.
 */
export const density = (
  grid: Grid,
  at: ReadonlyArray<number>,
  widths: ReadonlyArray<number>,
  points: number,
): ReadonlyArray<number> => {
  const held = Array.from({ length: grid.size ** 3 }, () => 0);
  const count = at.length / 3;
  for (let point = 0; point < count; point++) {
    if (point % points === points - 1) {
      continue;
    }
    const x = at[point * 3] ?? 0;
    const y = at[point * 3 + 1] ?? 0;
    const z = at[point * 3 + 2] ?? 0;
    const voxel = voxelOf(grid, x, y, z);
    if (voxel === undefined) {
      continue;
    }
    const long = Math.hypot(
      (at[point * 3 + 3] ?? x) - x,
      (at[point * 3 + 4] ?? y) - y,
      (at[point * 3 + 5] ?? z) - z,
    );
    held[voxel] = (held[voxel] ?? 0) + (long * (widths[point] ?? 0)) / grid.voxel ** 3;
  }
  return held;
};

/**
 * How much light from the way `toLight`, of length one, reaches `from` through the hair `held` in `grid`: going a voxel at a time from a voxel beyond `from`, so a strand shades not itself, out of the grid, losing as much of it at each as the hair there covers, exponentially. All of it, where no hair lies between.
 */
export const transmittance = (
  grid: Grid,
  held: ReadonlyArray<number>,
  from: Direction,
  toLight: Direction,
): number => {
  let covered = 0;
  for (let step = 1; step <= grid.size * 2; step++) {
    const voxel = voxelOf(
      grid,
      from.x + toLight.x * grid.voxel * step,
      from.y + toLight.y * grid.voxel * step,
      from.z + toLight.z * grid.voxel * step,
    );
    if (voxel === undefined) {
      break;
    }
    covered += (held[voxel] ?? 0) * grid.voxel;
  }
  return Math.exp(-covered);
};

/** How much of a pixel a strand `width` wide covers, `distance` from the eye, where a pixel is a metre over `focal` at a metre away: its width over a pixel's there, a whole pixel at most. */
export const coverage = (width: number, distance: number, focal: number): number =>
  Math.min((width * focal) / distance, 1);

/** How a strand of hair shaded as `shading` is shaded, varied by its own random number `random`, from nothing to a whole, as Blender's Principled Hair varies it: its melanin by as much as its colour's randomness says, its roughness, along it and about it, by as much as its roughness's says, either way of a middling number. */
export const varied = (shading: Strands.Shading, random: number): Strands.Shading => {
  const colourBy = 1 + 2 * (random - 0.5) * Math.min(Math.max(shading.randomColor, 0), 1);
  const roughnessBy = 1 + 2 * (random - 0.5) * shading.randomRoughness;
  return {
    ...shading,
    melanin: shading.melanin * colourBy,
    roughness: shading.roughness * roughnessBy,
    radialRoughness: shading.radialRoughness * roughnessBy,
  };
};

/**
 * The colour of hair shaded as `shading` says, seen through twice, as light that goes into a strand and back out of it is: as much as it takes in, by its melanin and its tint. What light about it, coming from everywhere at once, makes of it.
 */
export const colourOf = (shading: Strands.Shading): Three.Color => {
  const taken = absorptionOf(shading);
  return new Three.Color(Math.exp(-2 * taken.r), Math.exp(-2 * taken.g), Math.exp(-2 * taken.b));
};

/** How light a strand scatters toward the eye comes off it: off its surface, white; through it, coloured by its melanin; back off its inside, coloured too; and scattered many times among strands and within them, softly, its colour. */
export interface Lobes {
  readonly reflected: Colour;
  readonly transmitted: Colour;
  readonly internal: Colour;
  readonly scattered: Colour;
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
 * How light from the way `toLight` scatters toward the eye, the way `toEye`, off a strand of hair shaded as `shading`, running along `tangent`, each of length one: as Marschner's model has it, in the shape Karis gives it for drawing every frame. Off its surface (R), white, in a cone about the mirror's angle shifted toward the root by twice its cuticle's tilt; through it (TT), coloured by twice the width of melanin it crosses, strongest lit from behind, shifted the other way by the tilt; back off its inside (TRT), coloured more, shifted by four times the tilt; and many times over among strands and within them, softly, its colour, more lit from before it than from behind. Each lobe is as narrow as the hair is smooth along it. The graphics device works the same out for every light, every pixel of every strand.
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
  const through = (path: number): Colour => ({
    r: Math.exp(-taken.r * path),
    g: Math.exp(-taken.g * path),
    b: Math.exp(-taken.b * path),
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

  // Many times over, as Karis approximates it: lit as a surface facing the eye across the strand is, wrapped, and as Kajiya and Kay light a strand, its colour seen through twice, softened.
  const across = Math.sqrt(dotOf(eyeAcross, eyeAcross));
  const wrapped = across === 0 ? 0.25 : clamped((dotOf(eyeAcross, toLight) / across + 1) / 4);
  const soft = ((1 - 0.33) * wrapped + 0.33 * (1 - Math.abs(sinLight))) / Math.PI;
  const seen = colourOf(shading);
  const scattered = {
    r: Math.sqrt(seen.r) * soft,
    g: Math.sqrt(seen.g) * soft,
    b: Math.sqrt(seen.b) * soft,
  };

  return {
    reflected: { r: reflected, g: reflected, b: reflected },
    transmitted,
    internal,
    scattered,
  };
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

/** A strand of hair shaded as `shading` on the graphics device, varied by its own random number `random` as `varied` varies it: how much light it takes in, how wide its lobes spread, and its colour seen through twice. */
const strandOf = (shading: Strands.Shading, random: Three.Node<'float'>) => {
  const colourBy = random
    .sub(0.5)
    .mul(2 * Math.min(Math.max(shading.randomColor, 0), 1))
    .add(1);
  const roughnessBy = random
    .sub(0.5)
    .mul(2 * shading.randomRoughness)
    .add(1);
  const concentration = log(max(float(1).sub(colourBy.mul(shading.melanin)), 0.0001)).negate();
  // What its tint takes in alone: as `absorptionOf` has it, of hair holding no melanin.
  const tinted = absorptionOf({ ...shading, melanin: 0 });
  const taken = vec3(0.506, 0.841, 1.653)
    .mul(concentration.mul(1 - shading.melaninRedness))
    .add(vec3(0.343, 0.733, 1.924).mul(concentration.mul(shading.melaninRedness)))
    .add(vec3(tinted.r, tinted.g, tinted.b));
  const rough = max(roughnessBy.mul(shading.roughness), 0.001);
  return { taken, width: rough.mul(rough), seen: exp(taken.mul(-2)) };
};

/** `lobes` on the graphics device: what light from `toLight` scatters toward the eye, along `toEye`, off a strand shaded as `shading` and as `strand` varies it, running along `tangent`, all their lobes added up. */
const scattered = (
  shading: Strands.Shading,
  strand: ReturnType<typeof strandOf>,
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
  const { width, taken } = strand;
  const along = sinLight.add(sinEye);
  const through = (path: Three.Node<'float'>) => exp(taken.mul(path).negate());

  const reflected = spreadOf(cosHalfAround.mul(width).mul(Math.SQRT2), along.add(2 * tilt))
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
    spreadOf(width.div(2), along.sub(tilt))
      .mul(exp(cosAround.mul(-3.65).sub(3.98)))
      .mul(float(1).sub(leaving).mul(float(1).sub(leaving))),
  );

  const inside = surface(cosHalfDifference.mul(0.5));
  const internal = through(float(3.2).div(cosHalfDifference)).mul(
    spreadOf(width.mul(2), along.sub(4 * tilt))
      .mul(exp(cosAround.mul(17).sub(16.78)))
      .mul(float(1).sub(inside).mul(float(1).sub(inside)).mul(inside)),
  );

  const across = sqrt(dot(eyeAcross, eyeAcross).add(1e-8));
  const wrapped = saturate(dot(eyeAcross, toLight).div(across).add(1).div(4));
  const soft = wrapped
    .mul(1 - 0.33)
    .add(float(1).sub(abs(sinLight)).mul(0.33))
    .div(Math.PI);
  const many = sqrt(strand.seen).mul(soft);

  return transmitted.add(internal).add(reflected).add(many);
};

/** How much of a light from the way given, in the camera's space, reaches a point of a strand through the hair about it. */
type Shadowed = (toLight: Three.Node<'vec3'>) => Three.Node<'float'>;

/** How a strand is lit, varied by its own random number: each light scattered off it as `lobes` has it, along the way the strand runs, as much of it as gets through the hair between it and the light; and the light from everywhere at once taken in and given back as its colour seen through twice. */
class HairLighting extends Three.LightingModel {
  readonly #shading: Strands.Shading;
  readonly #tangent: Three.Node<'vec3'>;
  readonly #random: Three.Node<'float'>;
  readonly #shadowed: Shadowed;

  constructor(
    shading: Strands.Shading,
    tangent: Three.Node<'vec3'>,
    random: Three.Node<'float'>,
    shadowed: Shadowed,
  ) {
    super();
    this.#shading = shading;
    this.#tangent = tangent;
    this.#random = random;
    this.#shadowed = shadowed;
  }

  override direct({
    lightDirection,
    lightColor,
    reflectedLight,
  }: Three.LightingModelDirectInput): void {
    const lit = scattered(
      this.#shading,
      strandOf(this.#shading, this.#random),
      normalize(this.#tangent),
      asVec3(lightDirection),
      positionViewDirection,
    )
      .mul(asVec3(lightColor))
      .mul(this.#shadowed(asVec3(lightDirection)));
    reflectedLight.directSpecular.assign(asVec3(reflectedLight.directSpecular).add(lit));
  }

  override indirect(builder: Three.NodeBuilder): void {
    const ambient = ambientOf(builder.context);
    if (ambient === undefined) {
      return;
    }
    const given = asVec3(ambient.irradiance)
      .mul(strandOf(this.#shading, this.#random).seen)
      .mul(1 / Math.PI);
    ambient.diffuse.assign(asVec3(ambient.diffuse).add(given));
  }
}

/** Where hair draws every strand now, in its lines' own space: each point, three numbers a point, `perStrand` points a strand; how wide the strand is at each, in metres; and how the hair is shaded. What rays meet of it, as a photograph traces them. */
export interface Traced {
  readonly points: Float32Array;
  readonly widths: Float32Array;
  readonly perStrand: number;
  readonly shading: Strands.Shading;
}

/** Strands drawn as lines, lit as hair is: by `HairLighting`, facing the eye across each strand for lights that ask which way it faces; and where it draws them, worked out as the graphics device places them, for rays to meet. */
class HairMaterial extends Three.LineBasicNodeMaterial {
  readonly traced: () => Traced;
  readonly #shading: Strands.Shading;
  readonly #tangent: Three.Node<'vec3'>;
  readonly #random: Three.Node<'float'>;
  readonly #shadowed: Shadowed;

  constructor(
    shading: Strands.Shading,
    tangent: Three.Node<'vec3'>,
    random: Three.Node<'float'>,
    shadowed: Shadowed,
    traced: () => Traced,
  ) {
    super();
    this.lights = true;
    this.traced = traced;
    this.#shading = shading;
    this.#tangent = tangent;
    this.#random = random;
    this.#shadowed = shadowed;
    // A strand has no surface of its own to face a way: lights that ask, such as the sky's, are given the way across it toward the eye.
    const running = normalize(tangent);
    this.normalNode = normalize(
      positionViewDirection.sub(running.mul(dot(running, positionViewDirection))),
    );
  }

  override setupLightingModel(): Three.LightingModel {
    return new HairLighting(this.#shading, this.#tangent, this.#random, this.#shadowed);
  }
}

/** Where `object` draws its strands now, if it is lines a hair was fitted to draw. */
export const tracedOf = (object: Three.Object3D): Option.Option<Traced> =>
  object instanceof Three.LineSegments && object.material instanceof HairMaterial
    ? Option.some(object.material.traced())
    : Option.none();

/** How many voxels a side the grid hair is added up in has, and how much hair, in square metres of a strand's length times its width, each count of a voxel stands for. */
const GRID = 64;
const COUNTED = 1e-9;

/** How many voxels a strand's light is looked for through, on the graphics device, and how many voxels apart: a few steps a pixel, as many as cross the hair about a head. */
const MARCHED = 16;
const STRIDE = 2;

/** Work the graphics device does once a frame before drawing what reads this node, which stands for a whole: hair added up in its grid, before the strands it shades are drawn. */
class EachFrame extends Three.Node {
  readonly #work: (renderer: Three.Renderer) => void;

  constructor(work: (renderer: Three.Renderer) => void) {
    super('float');
    this.#work = work;
    this.updateBeforeType = Three.NodeUpdateType.FRAME;
  }

  override updateBefore(frame: Three.NodeFrame): boolean {
    if (frame.renderer !== null) {
      this.#work(frame.renderer);
    }
    return true;
  }

  override setup(): Three.Node {
    return float(1);
  }
}

/** The grid hair is added up in, as the drawing has it: where its least corner is and how wide a voxel is, given to the graphics device; and the grid as worked out last. */
interface Kept {
  readonly from: Three.UniformNode<'vec3', Three.Vector3>;
  readonly voxel: Three.UniformNode<'float', number>;
  last: Grid;
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

  readonly #randoms: ReadonlyArray<number>;
  readonly #grid: Kept;

  constructor(
    bound: ReadonlyArray<Strands.Bound>,
    randoms: ReadonlyArray<number>,
    now: { readonly values: Float32Array; readonly attribute: Three.StorageBufferAttribute },
    turns: { readonly values: Float32Array; readonly attribute: Three.StorageBufferAttribute },
    grid: Kept,
  ) {
    this.bound = bound;
    this.#randoms = randoms;
    this.#now = now;
    this.#turns = turns;
    this.#grid = grid;
  }

  /** The grid the hair is added up in, about where its guides were last given, a decimetre more on every side for the strands about them. */
  grid(): Grid {
    return this.#grid.last;
  }

  /** Each drawn strand's own random number, which varies how it is shaded. */
  randoms(): ReadonlyArray<number> {
    return this.#randoms;
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
    const grid = gridAbout(now, GRID, 0.1);
    this.#grid.last = grid;
    this.#grid.from.value.set(grid.from.x, grid.from.y, grid.from.z);
    this.#grid.voxel.value = grid.voxel;
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

/** How a model's hair is drawn: which meshes of it are its hair as cards, not shown, `HairCards` unless named otherwise; and every how many strands are drawn, every one unless told otherwise, as a page drawing on a slower device, or still being worked on, may ask. */
export interface Options {
  readonly cards?: ReadonlyArray<string>;
  readonly every?: number;
}

/**
 * `model`'s hair, counted and shaded as `hair` says, drawn as its strands after its guides: the lines `HairStrands` placed on the graphics device each frame as their guides swing, lit as hair shaded as the hair says is, never culled, since where they are drawn is not where they were made, each as much of a pixel as it covers, over what is behind it; the lines `HairGuides`, and its hair as cards, not shown; only every so many strands drawn, each covering as much more, if `options` say so. Fails with `Unfitted` if the model has no lines `HairStrands`, or not as many points in them as the hair counts.
 */
export const fit = (
  model: Three.Object3D,
  hair: Strands.Hair,
  options: Options = {},
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

    // Where each point was made, and how wide it is, as the model has it, or as its guides' roots are.
    const widths = drawn.geometry.getAttribute('_width');
    const drawnMade = buffer(position.count);
    padded(madeAt, drawnMade.values);
    for (let point = 0; point < position.count; point++) {
      drawnMade.values[point * 4 + 3] =
        widths === undefined ? (guides.width[0] ?? 0.00008) : widths.getX(point);
    }
    // Each strand's own random number, as its root has it in the model, or a middling one.
    const random = drawn.geometry.getAttribute('_random');
    const randoms = Array.from({ length: strands }, (_, strand) =>
      random === undefined ? 0.5 : random.getX(strand * hair.drawn.points),
    );
    const following = buffer(strands * 2);
    bound.forEach(({ guides: of, weights }, strand) => {
      for (let which = 0; which < 3; which++) {
        following.values[strand * 8 + which] = of[which] ?? 0;
        following.values[strand * 8 + 4 + which] = weights[which] ?? 0;
      }
      following.values[strand * 8 + 7] = randoms[strand] ?? 0.5;
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

    const ownRandom = varying(
      Fn(() => following.node.element(int(vertexIndex).div(pointsDrawn).mul(2).add(1)).w)(),
      'vHairRandom',
    );

    // The hair about her added up in a grid every frame, as `density` adds it up, before her strands are drawn: each link counted, as long as it is times as wide as it starts, in the voxel it starts in.
    const cells = GRID ** 3;
    const counts = new Three.StorageBufferAttribute(new Uint32Array(cells), 1);
    // Added to atomically, and so read atomically too, wherever it is read.
    const counting = storage(counts, 'uint', cells).toAtomic();
    const grid: Kept = {
      from: uniform(new Three.Vector3()),
      voxel: uniform(0.01),
      last: gridAbout(guides.at, GRID, 0.1),
    };
    grid.from.value.set(grid.last.from.x, grid.last.from.y, grid.last.from.z);
    grid.voxel.value = grid.last.voxel;
    /** The voxel `at` lies in, by its index, and whether it lies in the grid at all. */
    const voxelAt = (at: Three.Node<'vec3'>) => {
      const cell = floor(at.sub(grid.from).div(grid.voxel));
      const inside = cell.x
        .greaterThanEqual(0)
        .and(cell.y.greaterThanEqual(0))
        .and(cell.z.greaterThanEqual(0))
        .and(cell.x.lessThan(GRID))
        .and(cell.y.lessThan(GRID))
        .and(cell.z.lessThan(GRID));
      const index = int(cell.x)
        .add(int(cell.y).mul(GRID))
        .add(int(cell.z).mul(GRID * GRID));
      return { inside, index };
    };
    const emptied = Fn(() => {
      atomicStore(counting.element(instanceIndex), 0);
    })().compute(cells);
    const added = Fn(() => {
      const point = int(instanceIndex);
      If(point.mod(pointsDrawn).notEqual(pointsDrawn.sub(1)), () => {
        const here = placedAt(point);
        const link = length(placedAt(point.add(1)).sub(here)).mul(drawnMade.node.element(point).w);
        const { inside, index } = voxelAt(here);
        If(inside, () => {
          atomicAdd(counting.element(index), uint(link.div(COUNTED)));
        });
      });
    })().compute(position.count);
    const addedUp = new Three.ConvertNode<'float'>(
      new EachFrame((renderer) => {
        // Drawing, the renderer is ready, so it computes at once and gives back no promise.
        void renderer.compute([emptied, added]);
      }),
      'float',
    );
    // Where each point of a strand is, in the model's space, for the light to go from it through the hair.
    const at = varying(placed, 'vHairAt');
    /** As `transmittance` has it, every other voxel: from a voxel beyond the point toward the light, each voxel's hair taking light away, for as long as a step a voxel's hair stands for. */
    // Marched in a function of its own on the graphics device, which a loop needs to be written in.
    const marched = Fn(([way]: [Three.Node<'vec3'>]) => {
      const covered = float(0).toVar();
      Loop(MARCHED, ({ i }) => {
        const { inside, index } = voxelAt(
          at.add(way.mul(grid.voxel.mul(float(i).mul(STRIDE).add(1)))),
        );
        If(inside, () => {
          covered.addAssign(float(atomicLoad(counting.element(index))).mul(STRIDE));
        });
      });
      return exp(covered.mul(COUNTED).div(grid.voxel.mul(grid.voxel)).negate());
    });
    const shadowed: Shadowed = (toLight) => {
      const inWorld = cameraWorldMatrix.mul(vec4(toLight, 0)).xyz;
      return marched(normalize(modelWorldMatrixInverse.mul(vec4(inWorld, 0)).xyz));
    };

    const colour = colourOf(hair.shading);
    // Where every strand is drawn now, as `placedAt` places it, worked out where rays meet it.
    const traced = (): Traced => {
      const now = Array.from(
        { length: guidePoints * 3 },
        (_, value) => guidesNow.values[Math.floor(value / 3) * 4 + (value % 3)] ?? 0,
      );
      const turned = Array.from({ length: guides.scalp + guides.ponytail }, (_, guide) => ({
        x: turns.values[guide * 4] ?? 0,
        y: turns.values[guide * 4 + 1] ?? 0,
        z: turns.values[guide * 4 + 2] ?? 0,
        w: turns.values[guide * 4 + 3] ?? 1,
      }));
      return {
        points: new Float32Array(
          Strands.follow(guides, now, turned, { ...hair.drawn, at: madeAt }, bound),
        ),
        widths: new Float32Array(
          Array.from(
            { length: position.count },
            (_, point) => drawnMade.values[point * 4 + 3] ?? 0,
          ),
        ),
        perStrand: hair.drawn.points,
        shading: hair.shading,
      };
    };
    const material = new HairMaterial(hair.shading, tangent, ownRandom, shadowed, traced);
    material.positionNode = placed;
    material.colorNode = vec3(colour.r, colour.g, colour.b);
    // Thinner than a pixel, each strand is drawn as much of one as it covers, as `coverage` has it, over what is behind it; its hair added up first.
    const width = varying(drawnMade.node.element(int(vertexIndex)).w, 'vHairWidth');
    const focal = cameraProjectionMatrix
      .mul(vec4(0, 1, 0, 0))
      .y.mul(screenSize.y)
      .mul(0.5);
    // Drawing only every so many strands, each covers as much more, so the hair is as thick.
    const every = Math.max(Math.round(options.every ?? 1), 1);
    material.opacityNode = clamp(
      width.mul(focal).mul(every).div(positionView.z.negate()),
      0,
      1,
    ).mul(addedUp);
    if (every > 1) {
      drawn.geometry.setIndex(
        Array.from({ length: Math.ceil(strands / every) }, (_, kept) =>
          Array.from({ length: hair.drawn.points - 1 }, (__, link) => {
            const point = kept * every * hair.drawn.points + link;
            return [point, point + 1];
          }).flat(),
        ).flat(),
      );
    }
    material.transparent = true;
    material.depthWrite = false;
    drawn.material = material;
    drawn.frustumCulled = false;
    drawn.visible = true;
    for (const hidden of [GUIDES, ...(options.cards ?? ['HairCards'])]) {
      const shown = model.getObjectByName(hidden);
      if (shown !== undefined) {
        shown.visible = false;
      }
    }
    return Effect.succeed(new Haired(bound, randoms, guidesNow, turns, grid));
  });
