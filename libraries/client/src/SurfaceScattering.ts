/**
 * How a surface scatters light, as Three.js's standard material models it: a matte part, as Lambert has it, as much of its colour as it is not metal; and a shine off its microfacets, as Trowbridge and Reitz's distribution (GGX) spreads it, as rough as it is, its facets hiding one another as Smith has it, and reflecting as Schlick's Fresnel has it, white for what is not metal and its colour for what is. Worked out in the surface's own frame, z the way it faces. Here as a path tracer on the graphics device works it out, so what it finds can be told against it.
 */

/** An amount of light, red, green, and blue. */
export type Colour = readonly [number, number, number];

/** A way, of length one, in a surface's frame: z the way it faces. */
export type Way = readonly [number, number, number];

/** A surface as light meets it: its colour, and how rough and how metal it is, from nothing to a whole. */
export interface Surface {
  readonly colour: Colour;
  readonly roughness: number;
  readonly metalness: number;
}

/** A surface, with what its scattering depends on worked out once: its matte colour, what its shine reflects head on, and how wide its facets spread, as GGX's alpha, Three's roughness squared. */
export interface Prepared {
  readonly matte: Colour;
  readonly facing: Colour;
  readonly alpha: number;
}

/** How smooth a surface may be: smoother, a sun's light off it would be a point no path finds. */
const SMOOTHEST = 0.002;

/** `surface`, ready to scatter light. */
export const prepare = (surface: Surface): Prepared => {
  const { colour, metalness } = surface;
  const mix = (part: number) => 0.04 + (part - 0.04) * metalness;
  return {
    matte: [colour[0] * (1 - metalness), colour[1] * (1 - metalness), colour[2] * (1 - metalness)],
    facing: [mix(colour[0]), mix(colour[1]), mix(colour[2])],
    alpha: Math.max(surface.roughness * surface.roughness, SMOOTHEST),
  };
};

const bright = ([r, g, b]: Colour) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** How many of a surface's facets face the way `cosine` from the way it faces, per steradian. */
const facets = (alpha: number, cosine: number) => {
  const squared = alpha * alpha;
  const below = cosine * cosine * (squared - 1) + 1;
  return squared / (Math.PI * below * below);
};

/** How much of a surface's facets the way at `cosine` to it sees, not hidden by others. */
const unhidden = (alpha: number, cosine: number) =>
  (2 * cosine) / (cosine + Math.sqrt(alpha * alpha + (1 - alpha * alpha) * cosine * cosine));

/** How likely a path off a surface seen from `seen` is to follow its shine rather than its matte part: as bright as each is, never all one or the other unless it has no matte part. */
const shineShare = (prepared: Prepared, seen: Way) => {
  const glance = (1 - Math.max(seen[2], 0)) ** 5;
  const shine = bright(prepared.facing) + (1 - bright(prepared.facing)) * glance;
  const matte = bright(prepared.matte);
  // Wholly metal, it has no matte part to follow.
  return matte <= 0 ? 1 : Math.min(Math.max(shine / (shine + matte), 0.1), 0.9);
};

/** The way halfway between `a` and `b`, of length one. */
const halfway = (a: Way, b: Way): Way => {
  const sum: Way = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const long = Math.hypot(...sum) || 1;
  return [sum[0] / long, sum[1] / long, sum[2] / long];
};

/**
 * How much of the light reaching a surface met as `prepared` from the way `lit` it sends toward the way `seen`, red, green, and blue: what it scatters there times the cosine of the way it was lit, so light from a sun times it is what the surface shows. Nothing from or toward a way below it.
 */
export const scattered = (prepared: Prepared, seen: Way, lit: Way): Colour => {
  const cosSeen = seen[2];
  const cosLit = lit[2];
  if (cosSeen <= 0 || cosLit <= 0) {
    return [0, 0, 0];
  }
  const half = halfway(seen, lit);
  const cosHalf = Math.max(half[2], 0);
  const onFacet = Math.max(half[0] * lit[0] + half[1] * lit[1] + half[2] * lit[2], 0);
  const { alpha, facing, matte } = prepared;
  const shine =
    (facets(alpha, cosHalf) * unhidden(alpha, cosSeen) * unhidden(alpha, cosLit)) / (4 * cosSeen);
  const glance = (1 - onFacet) ** 5;
  const part = (index: 0 | 1 | 2) =>
    (matte[index] / Math.PI) * cosLit + (facing[index] + (1 - facing[index]) * glance) * shine;
  return [part(0), part(1), part(2)];
};

/** How likely `sample` is to choose the way `lit`, seen from `seen`, per steradian. */
export const likelihood = (prepared: Prepared, seen: Way, lit: Way): number => {
  if (seen[2] <= 0 || lit[2] <= 0) {
    return 0;
  }
  const share = shineShare(prepared, seen);
  const half = halfway(seen, lit);
  const onFacet = Math.max(half[0] * seen[0] + half[1] * seen[1] + half[2] * seen[2], 1e-8);
  const shine =
    (facets(prepared.alpha, Math.max(half[2], 0)) * Math.max(half[2], 0)) / (4 * onFacet);
  return share * shine + (1 - share) * (lit[2] / Math.PI);
};

/** A way light came from, chosen: the way, how likely it was chosen, and what it carries, as much as the surface scatters it over how likely it was chosen. */
export interface Sampled {
  readonly way: Way;
  readonly likelihood: number;
  readonly carried: Colour;
}

/** Chooses a way light comes from toward `seen`, by the three numbers from 0 to 1 `numbers`: off its shine, a facet chosen as many as face each way, or off its matte part, as likely as the cosine; as likely as each is bright. */
export const sample = (
  prepared: Prepared,
  seen: Way,
  numbers: readonly [number, number, number],
): Sampled => {
  const angle = 2 * Math.PI * numbers[2];
  let way: Way;
  if (numbers[0] < shineShare(prepared, seen)) {
    const squared = prepared.alpha * prepared.alpha;
    const cosine = Math.sqrt((1 - numbers[1]) / (numbers[1] * (squared - 1) + 1));
    const sine = Math.sqrt(Math.max(1 - cosine * cosine, 0));
    const facet: Way = [sine * Math.cos(angle), sine * Math.sin(angle), cosine];
    const along = seen[0] * facet[0] + seen[1] * facet[1] + seen[2] * facet[2];
    way = [
      2 * along * facet[0] - seen[0],
      2 * along * facet[1] - seen[1],
      2 * along * facet[2] - seen[2],
    ];
  } else {
    const rise = Math.sqrt(numbers[1]);
    const across = Math.sqrt(Math.max(1 - numbers[1], 0));
    way = [across * Math.cos(angle), across * Math.sin(angle), rise];
  }
  const likely = likelihood(prepared, seen, way);
  const sent = scattered(prepared, seen, way);
  return {
    way,
    likelihood: likely,
    carried: likely > 0 ? [sent[0] / likely, sent[1] / likely, sent[2] / likely] : [0, 0, 0],
  };
};
