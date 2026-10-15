/**
 * How a strand of hair scatters light, as Chiang, Bitterli, Tappan, and Burley model it for path tracing (2016), as pbrt and Blender's Principled Hair have it: a rough dielectric cylinder that takes light in as it goes through. Light leaves it off its surface (R), white; through it (TT) and back off its inside (TRT), coloured by what it took in on the way; and after more bounces within it, all together. Each way is spread along the strand as rough as it is, and around it as rough as it is about it; the cuticle's tilt shifts each. Worked out in the strand's own frame: x along it, toward its tip; z across it, toward where it is seen from; y across it the other way. Here as a path tracer on the graphics device works it out, so what it finds can be told against it.
 */

/** An amount of light, red, green, and blue. */
export type Colour = readonly [number, number, number];

/** A way, of length one, in a strand's frame: x along it toward its tip, z toward where it is seen from. */
export type Way = readonly [number, number, number];

/** A strand as light meets it: how far across it, from -1 to 1, the light meets it; how it bends light; how much light it takes in, for every width of it light crosses, red, green, and blue; how rough it is along itself, and about itself, from nothing to a whole; and how far its cuticle tilts toward its tip, in radians. */
export interface Fibre {
  readonly offset: number;
  readonly ior: number;
  readonly absorption: Colour;
  readonly roughness: number;
  readonly radialRoughness: number;
  readonly tilt: number;
}

/** How many ways light leaves a strand on its own: off its surface, through it, and back off its inside; all the rest leave together. */
const WAYS = 3;

/** A strand, with what light leaving it each way depends on worked out once. */
export interface Prepared {
  readonly fibre: Fibre;
  /** How widely each way spreads along the strand, as a variance. */
  readonly variances: readonly [number, number, number, number];
  /** How widely each way spreads about the strand, as a logistic's scale. */
  readonly scale: number;
  /** The sine and cosine of twice, four times, and eight times the cuticle's tilt, turned toward the root. */
  readonly sines: readonly [number, number, number];
  readonly cosines: readonly [number, number, number];
}

const square = (value: number) => value * value;
const safeSqrt = (value: number) => Math.sqrt(Math.max(value, 0));
const safeAsin = (value: number) => Math.asin(Math.min(Math.max(value, -1), 1));

/** `fibre`, ready to scatter light. */
export const prepare = (fibre: Fibre): Prepared => {
  const along = fibre.roughness;
  const first = square(0.726 * along + 0.812 * square(along) + 3.7 * along ** 20);
  const about = fibre.radialRoughness;
  // Turned toward the root, so the shine off its surface is shifted toward the root, as the realtime hair has it.
  const tilt = -fibre.tilt;
  const sines: Array<number> = [Math.sin(tilt)];
  const cosines: Array<number> = [safeSqrt(1 - square(Math.sin(tilt)))];
  for (let k = 1; k < 3; k++) {
    const sine = sines[k - 1] ?? 0;
    const cosine = cosines[k - 1] ?? 1;
    sines.push(2 * cosine * sine);
    cosines.push(square(cosine) - square(sine));
  }
  return {
    fibre,
    variances: [first, 0.25 * first, 4 * first, 4 * first],
    scale: Math.sqrt(Math.PI / 8) * (0.265 * about + 1.194 * square(about) + 5.372 * about ** 22),
    sines: [sines[0] ?? 0, sines[1] ?? 0, sines[2] ?? 0],
    cosines: [cosines[0] ?? 1, cosines[1] ?? 1, cosines[2] ?? 1],
  };
};

/** The modified Bessel function of the first kind, of order nought. */
const besselI0 = (x: number) => {
  let sum = 0;
  let term = 1;
  const quarter = (x * x) / 4;
  for (let i = 0; i < 10; i++) {
    if (i > 0) {
      term *= quarter / (i * i);
    }
    sum += term;
  }
  return sum;
};

/** Its logarithm, kept finite for large `x`. */
const logBesselI0 = (x: number) =>
  x > 12
    ? x + 0.5 * (-Math.log(2 * Math.PI) + Math.log(1 / x) + 1 / (8 * x))
    : Math.log(besselI0(x));

/** How light is spread along a strand: from the way at `sinIn`, `cosIn` to the way at `sinOut`, `cosOut`, as wide as `variance`. */
const longitudinal = (
  cosIn: number,
  cosOut: number,
  sinIn: number,
  sinOut: number,
  variance: number,
) => {
  const a = (cosIn * cosOut) / variance;
  const b = (sinIn * sinOut) / variance;
  return variance <= 0.1
    ? Math.exp(logBesselI0(a) - b - 1 / variance + 0.6931 + Math.log(1 / (2 * variance)))
    : (Math.exp(-b) * besselI0(a)) / (Math.sinh(1 / variance) * 2 * variance);
};

/** How much light meeting a dielectric at the cosine `cosine` it reflects, entering it from air. */
const fresnel = (cosine: number, ior: number) => {
  const sinIn = safeSqrt(1 - square(cosine));
  const sinThrough = sinIn / ior;
  if (sinThrough >= 1) {
    return 1;
  }
  const cosThrough = safeSqrt(1 - square(sinThrough));
  const parallel = (ior * cosine - cosThrough) / (ior * cosine + cosThrough);
  const perpendicular = (cosine - ior * cosThrough) / (cosine + ior * cosThrough);
  return (square(parallel) + square(perpendicular)) / 2;
};

/** The scale's logistic distribution, centred on nothing, and the share of it below `x`. */
const logistic = (x: number, scale: number) => {
  const away = Math.exp(-Math.abs(x) / scale);
  return away / (scale * square(1 + away));
};
const logisticBelow = (x: number, scale: number) => 1 / (1 + Math.exp(-x / scale));

/** The logistic distribution kept to one turn about the strand, from -π to π, as a whole. */
const trimmed = (x: number, scale: number) =>
  logistic(x, scale) / (logisticBelow(Math.PI, scale) - logisticBelow(-Math.PI, scale));

/** A turn about the strand drawn from `trimmed`, by the number `u`. */
const trimmedSample = (u: number, scale: number) => {
  const whole = logisticBelow(Math.PI, scale) - logisticBelow(-Math.PI, scale);
  const x = -scale * Math.log(1 / (u * whole + logisticBelow(-Math.PI, scale)) - 1);
  return Math.min(Math.max(x, -Math.PI), Math.PI);
};

/** How far about the strand light leaving the way `way` turns, met `gammaOut` about it, bent to `gammaThrough` within it. */
const turned = (way: number, gammaOut: number, gammaThrough: number) =>
  2 * way * gammaThrough - 2 * gammaOut + way * Math.PI;

/** How light is spread about a strand, leaving the way `way`, turned `around` from where it was seen. */
const azimuthal = (
  around: number,
  way: number,
  scale: number,
  gammaOut: number,
  gammaThrough: number,
) => {
  let off = around - turned(way, gammaOut, gammaThrough);
  while (off > Math.PI) off -= 2 * Math.PI;
  while (off < -Math.PI) off += 2 * Math.PI;
  return trimmed(off, scale);
};

/** What a strand met as `prepared` seen from `seen` depends on: the angles light leaves and goes through it at, and how much leaves each way. */
const geometryOf = (prepared: Prepared, seen: Way) => {
  const { fibre } = prepared;
  const sinOut = seen[0];
  const cosOut = safeSqrt(1 - square(sinOut));
  const phiOut = Math.atan2(seen[2], seen[1]);
  const sinThrough = sinOut / fibre.ior;
  const cosThrough = safeSqrt(1 - square(sinThrough));
  const bent = safeSqrt(square(fibre.ior) - square(sinOut)) / Math.max(cosOut, 1e-6);
  const sinGammaThrough = fibre.offset / bent;
  const cosGammaThrough = safeSqrt(1 - square(sinGammaThrough));
  const gammaThrough = safeAsin(sinGammaThrough);
  const gammaOut = safeAsin(fibre.offset);
  const path = (2 * cosGammaThrough) / Math.max(cosThrough, 1e-6);
  const kept: Colour = [
    Math.exp(-fibre.absorption[0] * path),
    Math.exp(-fibre.absorption[1] * path),
    Math.exp(-fibre.absorption[2] * path),
  ];
  const reflected = fresnel(cosOut * safeSqrt(1 - square(fibre.offset)), fibre.ior);
  // Off its surface; through it; back off its inside; and every way after, together.
  const ways: Array<Colour> = [[reflected, reflected, reflected]];
  ways.push([
    square(1 - reflected) * kept[0],
    square(1 - reflected) * kept[1],
    square(1 - reflected) * kept[2],
  ]);
  for (let way = 2; way < WAYS; way++) {
    const before = ways[way - 1] ?? [0, 0, 0];
    ways.push([
      before[0] * kept[0] * reflected,
      before[1] * kept[1] * reflected,
      before[2] * kept[2] * reflected,
    ]);
  }
  const last = ways[WAYS - 1] ?? [0, 0, 0];
  ways.push([
    (last[0] * reflected * kept[0]) / (1 - kept[0] * reflected),
    (last[1] * reflected * kept[1]) / (1 - kept[1] * reflected),
    (last[2] * reflected * kept[2]) / (1 - kept[2] * reflected),
  ]);
  return { sinOut, cosOut, phiOut, gammaOut, gammaThrough, ways };
};

/** The way seen from, along the strand, tilted for the way `way` by the cuticle. */
const tiltedFor = (prepared: Prepared, way: number, sinOut: number, cosOut: number) => {
  const { sines, cosines } = prepared;
  if (way === 0) {
    return {
      sin: sinOut * cosines[1] - cosOut * sines[1],
      cos: Math.abs(cosOut * cosines[1] + sinOut * sines[1]),
    };
  }
  if (way === 1) {
    return {
      sin: sinOut * cosines[0] + cosOut * sines[0],
      cos: Math.abs(cosOut * cosines[0] - sinOut * sines[0]),
    };
  }
  if (way === 2) {
    return {
      sin: sinOut * cosines[2] + cosOut * sines[2],
      cos: Math.abs(cosOut * cosines[2] - sinOut * sines[2]),
    };
  }
  return { sin: sinOut, cos: cosOut };
};

/** How likely each way is chosen, by how bright it is. */
const choicesOf = (ways: ReadonlyArray<Colour>) => {
  const bright = ways.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const total = bright.reduce((sum, each) => sum + each, 0);
  return bright.map((each) => (total > 0 ? each / total : 1 / bright.length));
};

/**
 * How much of the light reaching a strand met as `prepared` from the way `lit` it sends toward the way `seen`, red, green, and blue: what it scatters there times the cosine of the way it was lit, so light from a sun times it is what the strand shows, and light from every way, averaged over them, what it shows of the sky.
 */
export const scattered = (prepared: Prepared, seen: Way, lit: Way): Colour => {
  const { sinOut, cosOut, phiOut, gammaOut, gammaThrough, ways } = geometryOf(prepared, seen);
  const sinIn = lit[0];
  const cosIn = safeSqrt(1 - square(sinIn));
  const around = Math.atan2(lit[2], lit[1]) - phiOut;
  const sum = [0, 0, 0];
  for (let way = 0; way <= WAYS; way++) {
    const tilted = tiltedFor(prepared, way, sinOut, cosOut);
    const spread =
      longitudinal(cosIn, tilted.cos, sinIn, tilted.sin, prepared.variances[way] ?? 1) *
      (way < WAYS
        ? azimuthal(around, way, prepared.scale, gammaOut, gammaThrough)
        : 1 / (2 * Math.PI));
    const share = ways[way] ?? [0, 0, 0];
    for (let part = 0; part < 3; part++) {
      sum[part] = (sum[part] ?? 0) + spread * (share[part] ?? 0);
    }
  }
  return [sum[0] ?? 0, sum[1] ?? 0, sum[2] ?? 0];
};

/** How likely `sample` is to choose the way `lit`, seen from `seen`, per steradian. */
export const likelihood = (prepared: Prepared, seen: Way, lit: Way): number => {
  const { sinOut, cosOut, phiOut, gammaOut, gammaThrough, ways } = geometryOf(prepared, seen);
  const choices = choicesOf(ways);
  const sinIn = lit[0];
  const cosIn = safeSqrt(1 - square(sinIn));
  const around = Math.atan2(lit[2], lit[1]) - phiOut;
  let sum = 0;
  for (let way = 0; way <= WAYS; way++) {
    const tilted = tiltedFor(prepared, way, sinOut, cosOut);
    sum +=
      longitudinal(cosIn, tilted.cos, sinIn, tilted.sin, prepared.variances[way] ?? 1) *
      (choices[way] ?? 0) *
      (way < WAYS
        ? azimuthal(around, way, prepared.scale, gammaOut, gammaThrough)
        : 1 / (2 * Math.PI));
  }
  return sum;
};

/** A way light came from, chosen: the way, how likely it was chosen, and what it carries, as much as the strand scatters it over how likely it was chosen. */
export interface Sampled {
  readonly way: Way;
  readonly likelihood: number;
  readonly carried: Colour;
}

/** Chooses a way light comes from toward `seen`, by the four numbers from 0 to 1 `numbers`: which way it leaves the strand, as likely as each is bright; then how far along the strand, and about it, as that way spreads light. */
export const sample = (
  prepared: Prepared,
  seen: Way,
  numbers: readonly [number, number, number, number],
): Sampled => {
  const { sinOut, cosOut, phiOut, gammaOut, gammaThrough, ways } = geometryOf(prepared, seen);
  const choices = choicesOf(ways);
  let chosen = 0;
  let below = 0;
  while (chosen < WAYS && numbers[0] >= below + (choices[chosen] ?? 0)) {
    below += choices[chosen] ?? 0;
    chosen++;
  }
  const tilted = tiltedFor(prepared, chosen, sinOut, cosOut);
  const variance = prepared.variances[chosen] ?? 1;
  const u = Math.max(numbers[1], 1e-5);
  const cosTheta = 1 + variance * Math.log(u + (1 - u) * Math.exp(-2 / variance));
  const sinTheta = safeSqrt(1 - square(cosTheta));
  const cosPhi = Math.cos(2 * Math.PI * numbers[2]);
  const sinIn = -cosTheta * tilted.sin + sinTheta * cosPhi * tilted.cos;
  const cosIn = safeSqrt(1 - square(sinIn));
  const around =
    chosen < WAYS
      ? turned(chosen, gammaOut, gammaThrough) + trimmedSample(numbers[3], prepared.scale)
      : 2 * Math.PI * numbers[3];
  const phiIn = phiOut + around;
  const way: Way = [sinIn, cosIn * Math.cos(phiIn), cosIn * Math.sin(phiIn)];
  const likely = likelihood(prepared, seen, way);
  const sent = scattered(prepared, seen, way);
  return {
    way,
    likelihood: likely,
    carried: likely > 0 ? [sent[0] / likely, sent[1] / likely, sent[2] / likely] : [0, 0, 0],
  };
};
