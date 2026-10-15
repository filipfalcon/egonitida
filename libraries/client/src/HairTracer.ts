import {
  Fn,
  abs,
  asin,
  atan,
  clamp,
  cos,
  exp,
  float,
  floor,
  log,
  max,
  pow,
  select,
  sin,
  sinh,
  sqrt,
  vec3,
} from 'three/tsl';
import type * as Three from 'three/webgpu';

/**
 * How a strand of hair scatters light, as `HairScattering` works it out, in the terms of a shader on the graphics device: each a function of its own in the shader, called wherever a path meets hair. A strand is given as two groups of four numbers: how far across it the light meets it, how it bends light, and how rough it is along and about itself; and how much light it takes in, red, green, and blue, and how far its cuticle tilts. Ways are in the strand's own frame, as `HairScattering` has them.
 */

type Float = Three.Node<'float'>;
type Vec3 = Three.Node<'vec3'>;
type Vec4 = Three.Node<'vec4'>;

const square = (value: Float) => value.mul(value);
const safeSqrt = (value: Float) => sqrt(max(value, 0));
const safeAsin = (value: Float) => asin(clamp(value, -1, 1));
const TWO_PI = 2 * Math.PI;

/** The modified Bessel function of the first kind, of order nought, as ten terms of its series. */
const besselI0 = (x: Float) => {
  const quarter = square(x).div(4).toVar();
  const term = float(1).toVar();
  const sum = float(1).toVar();
  for (let i = 1; i < 10; i++) {
    term.assign(term.mul(quarter).div(i * i));
    sum.addAssign(term);
  }
  return sum;
};

/** How light is spread along a strand, as `HairScattering` spreads it. */
const longitudinal = (
  cosIn: Float,
  cosOut: Float,
  sinIn: Float,
  sinOut: Float,
  variance: Float,
) => {
  const a = cosIn.mul(cosOut).div(variance).toVar();
  const b = sinIn.mul(sinOut).div(variance).toVar();
  const i0 = besselI0(a);
  const logI0 = select(
    a.greaterThan(12),
    a.add(
      float(-Math.log(TWO_PI))
        .add(log(float(1).div(a)))
        .add(float(1).div(a.mul(8)))
        .mul(0.5),
    ),
    log(i0),
  );
  const narrow = exp(
    logI0
      .sub(b)
      .sub(float(1).div(variance))
      .add(0.6931)
      .add(log(float(1).div(variance.mul(2)))),
  );
  const wide = exp(b.negate())
    .mul(i0)
    .div(sinh(float(1).div(variance)).mul(2).mul(variance));
  return select(variance.lessThanEqual(0.1), narrow, wide);
};

/** How much light meeting a dielectric at the cosine `cosine` it reflects, entering it from air. */
const fresnel = (cosine: Float, ior: Float) => {
  const sinThrough = safeSqrt(float(1).sub(square(cosine)))
    .div(ior)
    .toVar();
  const cosThrough = safeSqrt(float(1).sub(square(sinThrough)));
  const parallel = ior.mul(cosine).sub(cosThrough).div(ior.mul(cosine).add(cosThrough));
  const perpendicular = cosine.sub(ior.mul(cosThrough)).div(cosine.add(ior.mul(cosThrough)));
  return select(
    sinThrough.greaterThanEqual(1),
    float(1),
    square(parallel).add(square(perpendicular)).div(2),
  );
};

const logisticBelow = (x: Float, scale: Float) => float(1).div(exp(x.negate().div(scale)).add(1));

/** The logistic distribution kept to one turn about the strand, as a whole. */
const trimmed = (x: Float, scale: Float) => {
  const away = exp(abs(x).negate().div(scale));
  const whole = logisticBelow(float(Math.PI), scale).sub(logisticBelow(float(-Math.PI), scale));
  return away.div(scale.mul(square(away.add(1)))).div(whole);
};

/** A turn about the strand drawn from `trimmed`, by the number `u`. */
const trimmedSample = (u: Float, scale: Float) => {
  const below = logisticBelow(float(-Math.PI), scale);
  const whole = logisticBelow(float(Math.PI), scale).sub(below);
  const x = scale.negate().mul(log(float(1).div(u.mul(whole).add(below)).sub(1)));
  return clamp(x, -Math.PI, Math.PI);
};

/** How far about the strand light leaving the way `way` turns. */
const turned = (way: number, gammaOut: Float, gammaThrough: Float) =>
  gammaThrough
    .mul(2 * way)
    .sub(gammaOut.mul(2))
    .add(way * Math.PI);

/** How light is spread about a strand, leaving the way `way`, turned `around` from where it was seen. */
const azimuthal = (
  around: Float,
  way: number,
  scale: Float,
  gammaOut: Float,
  gammaThrough: Float,
) => {
  const off = around.sub(turned(way, gammaOut, gammaThrough)).toVar();
  return trimmed(off.sub(floor(off.div(TWO_PI).add(0.5)).mul(TWO_PI)), scale);
};

/** Everything light leaving a strand depends on, seen from `seen`. */
const geometryOf = (seen: Vec3, shape: Vec4, taking: Vec4) => {
  const offset = shape.x;
  const ior = shape.y;
  const roughness = shape.z;
  const radialRoughness = shape.w;
  const sinOut = seen.x.toVar();
  const cosOut = safeSqrt(float(1).sub(square(sinOut))).toVar();
  const phiOut = atan(seen.z, seen.y).toVar();
  const sinThrough = sinOut.div(ior);
  const cosThrough = safeSqrt(float(1).sub(square(sinThrough)));
  const bent = safeSqrt(square(ior).sub(square(sinOut))).div(max(cosOut, 1e-6));
  const sinGammaThrough = offset.div(bent);
  const cosGammaThrough = safeSqrt(float(1).sub(square(sinGammaThrough)));
  const gammaThrough = safeAsin(sinGammaThrough).toVar();
  const gammaOut = safeAsin(offset).toVar();
  const path = cosGammaThrough.mul(2).div(max(cosThrough, 1e-6));
  const kept = exp(taking.xyz.negate().mul(path)).toVar();
  const reflected = fresnel(cosOut.mul(safeSqrt(float(1).sub(square(offset)))), ior).toVar();
  const surface = vec3(reflected).toVar();
  const through = kept.mul(square(float(1).sub(reflected))).toVar();
  const inside = through.mul(kept).mul(reflected).toVar();
  const after = inside
    .mul(reflected)
    .mul(kept)
    .div(vec3(1).sub(kept.mul(reflected)))
    .toVar();
  const first = square(
    roughness.mul(0.726).add(square(roughness).mul(0.812)).add(pow(roughness, 20).mul(3.7)),
  ).toVar();
  const variances = [first, first.mul(0.25), first.mul(4), first.mul(4)];
  const scale = radialRoughness
    .mul(0.265)
    .add(square(radialRoughness).mul(1.194))
    .add(pow(radialRoughness, 22).mul(5.372))
    .mul(Math.sqrt(Math.PI / 8))
    .toVar();
  // The cuticle turned toward the root, as `HairScattering` turns it.
  const sine0 = sin(taking.w.negate()).toVar();
  const cosine0 = safeSqrt(float(1).sub(square(sine0))).toVar();
  const sine1 = cosine0.mul(sine0).mul(2).toVar();
  const cosine1 = square(cosine0).sub(square(sine0)).toVar();
  const sine2 = cosine1.mul(sine1).mul(2).toVar();
  const cosine2 = square(cosine1).sub(square(sine1)).toVar();
  const tilted = [
    {
      sin: sinOut.mul(cosine1).sub(cosOut.mul(sine1)),
      cos: abs(cosOut.mul(cosine1).add(sinOut.mul(sine1))),
    },
    {
      sin: sinOut.mul(cosine0).add(cosOut.mul(sine0)),
      cos: abs(cosOut.mul(cosine0).sub(sinOut.mul(sine0))),
    },
    {
      sin: sinOut.mul(cosine2).add(cosOut.mul(sine2)),
      cos: abs(cosOut.mul(cosine2).sub(sinOut.mul(sine2))),
    },
    { sin: sinOut, cos: cosOut },
  ];
  const ways = [surface, through, inside, after];
  const bright = ways.map((way) => way.dot(vec3(0.2126, 0.7152, 0.0722)));
  const total = bright.reduce((sum, each) => sum.add(each)).toVar();
  const choices = bright.map((each) =>
    select(total.greaterThan(0), each.div(total), float(0.25)).toVar(),
  );
  return { phiOut, gammaOut, gammaThrough, ways, variances, scale, tilted, choices };
};

/** What `HairScattering.scattered` works out: how much of the light from the way `lit` the strand sends toward `seen`, times the cosine it was lit at. */
export const scattered = Fn(([seen, lit, shape, taking]: [Vec3, Vec3, Vec4, Vec4]) => {
  const { phiOut, gammaOut, gammaThrough, ways, variances, scale, tilted } = geometryOf(
    seen,
    shape,
    taking,
  );
  const sinIn = lit.x.toVar();
  const cosIn = safeSqrt(float(1).sub(square(sinIn))).toVar();
  const around = atan(lit.z, lit.y).sub(phiOut).toVar();
  const sum = vec3(0).toVar();
  for (let way = 0; way < 4; way++) {
    const { sin: tiltedSin, cos: tiltedCos } = tilted[way] ?? { sin: sinIn, cos: cosIn };
    const spread = longitudinal(cosIn, tiltedCos, sinIn, tiltedSin, variances[way] ?? float(1)).mul(
      way < 3 ? azimuthal(around, way, scale, gammaOut, gammaThrough) : float(1 / TWO_PI),
    );
    sum.addAssign((ways[way] ?? vec3(0)).mul(spread));
  }
  return sum;
}).setLayout({
  name: 'hairScattered',
  type: 'vec3',
  inputs: [
    { name: 'seen', type: 'vec3' },
    { name: 'lit', type: 'vec3' },
    { name: 'shape', type: 'vec4' },
    { name: 'taking', type: 'vec4' },
  ],
});

/** What `HairScattering.likelihood` works out: how likely `chosen` is to choose the way `lit`, per steradian. */
export const likelihood = Fn(([seen, lit, shape, taking]: [Vec3, Vec3, Vec4, Vec4]) => {
  const { phiOut, gammaOut, gammaThrough, variances, scale, tilted, choices } = geometryOf(
    seen,
    shape,
    taking,
  );
  const sinIn = lit.x.toVar();
  const cosIn = safeSqrt(float(1).sub(square(sinIn))).toVar();
  const around = atan(lit.z, lit.y).sub(phiOut).toVar();
  const sum = float(0).toVar();
  for (let way = 0; way < 4; way++) {
    const { sin: tiltedSin, cos: tiltedCos } = tilted[way] ?? { sin: sinIn, cos: cosIn };
    sum.addAssign(
      longitudinal(cosIn, tiltedCos, sinIn, tiltedSin, variances[way] ?? float(1))
        .mul(choices[way] ?? float(0))
        .mul(way < 3 ? azimuthal(around, way, scale, gammaOut, gammaThrough) : float(1 / TWO_PI)),
    );
  }
  return sum;
}).setLayout({
  name: 'hairLikelihood',
  type: 'float',
  inputs: [
    { name: 'seen', type: 'vec3' },
    { name: 'lit', type: 'vec3' },
    { name: 'shape', type: 'vec4' },
    { name: 'taking', type: 'vec4' },
  ],
});

/** The way `HairScattering.sample` chooses light to come from toward `seen`, by the four numbers from 0 to 1 `numbers`. */
export const chosen = Fn(([seen, numbers, shape, taking]: [Vec3, Vec4, Vec4, Vec4]) => {
  const { phiOut, gammaOut, gammaThrough, variances, scale, tilted, choices } = geometryOf(
    seen,
    shape,
    taking,
  );
  const [c0 = float(0), c1 = float(0), c2 = float(0)] = choices;
  const upToFirst = c0;
  const upToSecond = c0.add(c1);
  const upToThird = upToSecond.add(c2);
  /** Of the four ways, the one `numbers.x` falls on. */
  const pick = (each: readonly [Float, Float, Float, Float]): Float =>
    float(
      select(
        numbers.x.lessThan(upToFirst),
        each[0],
        select(
          numbers.x.lessThan(upToSecond),
          each[1],
          select(numbers.x.lessThan(upToThird), each[2], each[3]),
        ),
      ),
    );
  const [t0, t1, t2, t3] = [tilted[0], tilted[1], tilted[2], tilted[3]].map(
    (each) => each ?? { sin: float(0), cos: float(1) },
  );
  const [v0, v1, v2, v3] = variances;
  const tiltedSin = pick([
    t0?.sin ?? float(0),
    t1?.sin ?? float(0),
    t2?.sin ?? float(0),
    t3?.sin ?? float(0),
  ]).toVar();
  const tiltedCos = pick([
    t0?.cos ?? float(1),
    t1?.cos ?? float(1),
    t2?.cos ?? float(1),
    t3?.cos ?? float(1),
  ]).toVar();
  const variance = pick([v0 ?? float(1), v1 ?? float(1), v2 ?? float(1), v3 ?? float(1)]).toVar();
  const u = max(numbers.y, 1e-5);
  const cosTheta = float(1)
    .add(
      variance.mul(
        log(
          u.add(
            float(1)
              .sub(u)
              .mul(exp(float(-2).div(variance))),
          ),
        ),
      ),
    )
    .toVar();
  const sinTheta = safeSqrt(float(1).sub(square(cosTheta)));
  const cosPhi = cos(numbers.z.mul(TWO_PI));
  const sinIn = cosTheta.negate().mul(tiltedSin).add(sinTheta.mul(cosPhi).mul(tiltedCos)).toVar();
  const cosIn = safeSqrt(float(1).sub(square(sinIn)));
  const spun = trimmedSample(numbers.w, scale);
  const around = pick([
    turned(0, gammaOut, gammaThrough).add(spun),
    turned(1, gammaOut, gammaThrough).add(spun),
    turned(2, gammaOut, gammaThrough).add(spun),
    numbers.w.mul(TWO_PI),
  ]);
  const phiIn = phiOut.add(around).toVar();
  return vec3(sinIn, cosIn.mul(cos(phiIn)), cosIn.mul(sin(phiIn)));
}).setLayout({
  name: 'hairChosen',
  type: 'vec3',
  inputs: [
    { name: 'seen', type: 'vec3' },
    { name: 'numbers', type: 'vec4' },
    { name: 'shape', type: 'vec4' },
    { name: 'taking', type: 'vec4' },
  ],
});
