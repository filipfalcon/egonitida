import {
  Fn,
  PI,
  clamp,
  cos,
  dot,
  float,
  max,
  normalize,
  pow,
  select,
  sin,
  sqrt,
  vec3,
} from 'three/tsl';
import type * as Three from 'three/webgpu';

/**
 * How a surface scatters light, as `SurfaceScattering` works it out, in the terms of a shader on the graphics device: each a function of its own in the shader, called wherever a path meets a shining surface. A surface is given as its colour and its finish: how rough it is and how metal. Ways are in the surface's own frame, z the way it faces.
 */

type Float = Three.Node<'float'>;
type Vec2 = Three.Node<'vec2'>;
type Vec3 = Three.Node<'vec3'>;

/** How smooth a surface may be, as `SurfaceScattering` has it. */
const SMOOTHEST = 0.002;

/** What scattering off a surface of `colour` and `finish` depends on, as `SurfaceScattering.prepare` works it out. */
const preparedOf = (colour: Vec3, finish: Vec2) => {
  const metalness = finish.y;
  return {
    matte: colour.mul(float(1).sub(metalness)),
    facing: vec3(0.04).add(colour.sub(0.04).mul(metalness)),
    alpha: max(finish.x.mul(finish.x), SMOOTHEST),
  };
};

const bright = (colour: Vec3) => dot(colour, vec3(0.2126, 0.7152, 0.0722));

const facets = (alpha: Float, cosine: Float) => {
  const squared = alpha.mul(alpha);
  const below = cosine.mul(cosine).mul(squared.sub(1)).add(1);
  return squared.div(below.mul(below).mul(Math.PI));
};

const unhidden = (alpha: Float, cosine: Float) =>
  cosine
    .mul(2)
    .div(
      cosine.add(
        sqrt(alpha.mul(alpha).add(float(1).sub(alpha.mul(alpha)).mul(cosine.mul(cosine)))),
      ),
    );

/** How likely a path is to follow the shine, as `SurfaceScattering` has it. */
const shineShare = (prepared: ReturnType<typeof preparedOf>, seen: Vec3) => {
  const glance = pow(float(1).sub(max(seen.z, 0)), 5);
  const facing = bright(prepared.facing);
  const shine = facing.add(float(1).sub(facing).mul(glance));
  const matte = bright(prepared.matte);
  return select(matte.lessThanEqual(0), float(1), clamp(shine.div(shine.add(matte)), 0.1, 0.9));
};

/** What `SurfaceScattering.scattered` works out: how much of the light from the way `lit` the surface sends toward `seen`, times the cosine it was lit at. */
export const scattered = Fn(([seen, lit, colour, finish]: [Vec3, Vec3, Vec3, Vec2]) => {
  const { matte, facing, alpha } = preparedOf(colour, finish);
  const cosSeen = seen.z;
  const cosLit = lit.z;
  const half = normalize(seen.add(lit));
  const cosHalf = max(half.z, 0);
  const onFacet = max(dot(half, lit), 0);
  const shine = facets(alpha, cosHalf)
    .mul(unhidden(alpha, max(cosSeen, 1e-6)))
    .mul(unhidden(alpha, max(cosLit, 1e-6)))
    .div(max(cosSeen, 1e-6).mul(4));
  const glance = pow(float(1).sub(onFacet), 5);
  const sent = matte
    .div(Math.PI)
    .mul(cosLit)
    .add(facing.add(vec3(1).sub(facing).mul(glance)).mul(shine));
  return select(cosSeen.greaterThan(0).and(cosLit.greaterThan(0)), sent, vec3(0));
}).setLayout({
  name: 'surfaceScattered',
  type: 'vec3',
  inputs: [
    { name: 'seen', type: 'vec3' },
    { name: 'lit', type: 'vec3' },
    { name: 'colour', type: 'vec3' },
    { name: 'finish', type: 'vec2' },
  ],
});

/** What `SurfaceScattering.likelihood` works out: how likely `chosen` is to choose the way `lit`, per steradian. */
export const likelihood = Fn(([seen, lit, colour, finish]: [Vec3, Vec3, Vec3, Vec2]) => {
  const prepared = preparedOf(colour, finish);
  const share = shineShare(prepared, seen);
  const half = normalize(seen.add(lit));
  const cosHalf = max(half.z, 0);
  const onFacet = max(dot(half, seen), 1e-8);
  const shine = facets(prepared.alpha, cosHalf).mul(cosHalf).div(onFacet.mul(4));
  const likely = share.mul(shine).add(float(1).sub(share).mul(lit.z.div(PI)));
  return select(seen.z.greaterThan(0).and(lit.z.greaterThan(0)), likely, float(0));
}).setLayout({
  name: 'surfaceLikelihood',
  type: 'float',
  inputs: [
    { name: 'seen', type: 'vec3' },
    { name: 'lit', type: 'vec3' },
    { name: 'colour', type: 'vec3' },
    { name: 'finish', type: 'vec2' },
  ],
});

/** The way `SurfaceScattering.sample` chooses light to come from toward `seen`, by the three numbers from 0 to 1 `numbers`. */
export const chosen = Fn(([seen, numbers, colour, finish]: [Vec3, Vec3, Vec3, Vec2]) => {
  const prepared = preparedOf(colour, finish);
  const angle = numbers.z.mul(2 * Math.PI);
  const squared = prepared.alpha.mul(prepared.alpha);
  const cosine = sqrt(
    float(1)
      .sub(numbers.y)
      .div(numbers.y.mul(squared.sub(1)).add(1)),
  ).toVar();
  const sine = sqrt(max(float(1).sub(cosine.mul(cosine)), 0));
  const facet = vec3(sine.mul(cos(angle)), sine.mul(sin(angle)), cosine).toVar();
  const mirrored = facet.mul(dot(seen, facet).mul(2)).sub(seen);
  const rise = sqrt(numbers.y);
  const across = sqrt(max(float(1).sub(numbers.y), 0));
  const matte = vec3(across.mul(cos(angle)), across.mul(sin(angle)), rise);
  return select(numbers.x.lessThan(shineShare(prepared, seen)), mirrored, matte);
}).setLayout({
  name: 'surfaceChosen',
  type: 'vec3',
  inputs: [
    { name: 'seen', type: 'vec3' },
    { name: 'numbers', type: 'vec3' },
    { name: 'colour', type: 'vec3' },
    { name: 'finish', type: 'vec2' },
  ],
});
