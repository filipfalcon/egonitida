/**
 * The steps' maths: sines, cosines, their inverses, and lengths, worked out alike by every JavaScript engine. ECMAScript leaves `Math.sin`, `Math.atan2`, `Math.hypot`, and the like approximate, each engine to its own last bits, so a host and a client predicting it, or a replay in another browser, could step the same state apart; it makes `+`, `-`, `*`, `/`, and `Math.sqrt` exact, rounded the one way, and these are made of nothing else. Within a step, a system or a rule, and what they call, take their maths from here; a view may take it from either.
 *
 * Each is fdlibm's, the library browsers' own `Math` descends from, so it agrees with theirs to within the last bit or two.
 */

/** π/2 split in two, its first part short enough that any whole number of turns up to a million times it is exact. */
const HALF_PI_HIGH = 1.57079632673412561417;
const HALF_PI_LOW = 6.07710050650619224932e-11;
const TWO_OVER_PI = 6.36619772367581382433e-1;

/** π, and what of it a double leaves off. */
const PI = 3.141592653589793116;
const PI_LOW = 1.2246467991473532e-16;

/** π/2, and what of it a double leaves off. */
const RIGHT_ANGLE = 1.570796326794896558;
const RIGHT_ANGLE_LOW = 6.123233995736766e-17;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** The sine of `x + tail`, `x` within an eighth of a turn of nothing and `tail` what is left of it. */
const sineNear = (x: number, tail: number) => {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * tail - v * r) - tail - v * S1);
};

/** The cosine of `x + tail`, `x` within an eighth of a turn of nothing and `tail` what is left of it. */
const cosineNear = (x: number, tail: number) => {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const half = 0.5 * z;
  const w = 1 - half;
  return w + (1 - w - half + (z * r - x * tail));
};

/** `x` as the quarter turns nearest it and what is left over, as a head and a tail, within an eighth of a turn of nothing. */
const quarters = (x: number) => {
  const n = Math.round(x * TWO_OVER_PI);
  const r = x - n * HALF_PI_HIGH;
  const w = n * HALF_PI_LOW;
  const head = r - w;
  return { quarter: ((n % 4) + 4) % 4, head, tail: r - head - w };
};

/** The sine of `x`, in radians. */
export const sin = (x: number): number => {
  if (!Number.isFinite(x)) {
    return Number.NaN;
  }
  const { quarter, head, tail } = quarters(x);
  return quarter === 0
    ? sineNear(head, tail)
    : quarter === 1
      ? cosineNear(head, tail)
      : quarter === 2
        ? -sineNear(head, tail)
        : -cosineNear(head, tail);
};

/** The cosine of `x`, in radians. */
export const cos = (x: number): number => {
  if (!Number.isFinite(x)) {
    return Number.NaN;
  }
  const { quarter, head, tail } = quarters(x);
  return quarter === 0
    ? cosineNear(head, tail)
    : quarter === 1
      ? -sineNear(head, tail)
      : quarter === 2
        ? -cosineNear(head, tail)
        : sineNear(head, tail);
};

/** The angles whose tangents split the reduction of `atan`, each as a head and what of it a double leaves off. */
const ATAN_HIGH = [
  4.63647609000806093515e-1,
  7.85398163397448278999e-1,
  9.82793723247329054082e-1,
  RIGHT_ANGLE,
];
const ATAN_LOW = [
  2.26987774529616870924e-17,
  3.06161699786838301793e-17,
  1.39033110312309984516e-17,
  RIGHT_ANGLE_LOW,
];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1,
  -1.1111110405462355788e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2,
  -3.6531572744216915527e-2, 1.62858201153657823623e-2,
] as const;

/** The angle whose tangent is `x`, from -π/2 to π/2. */
export const atan = (x: number): number => {
  if (Number.isNaN(x)) {
    return Number.NaN;
  }
  const ax = Math.abs(x);
  const sign = x < 0 ? -1 : 1;
  if (ax >= 73786976294838206464) {
    return sign * (RIGHT_ANGLE + RIGHT_ANGLE_LOW);
  }
  // Brought near nothing by the tangent of a known angle, whose angle is added back.
  const [id, t] =
    ax < 0.4375
      ? [-1, ax]
      : ax < 0.6875
        ? [0, (2 * ax - 1) / (2 + ax)]
        : ax < 1.1875
          ? [1, (ax - 1) / (ax + 1)]
          : ax < 2.4375
            ? [2, (ax - 1.5) / (1 + 1.5 * ax)]
            : [3, -1 / ax];
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  const high = ATAN_HIGH[id];
  const low = ATAN_LOW[id];
  return high === undefined || low === undefined
    ? sign * (t - t * (s1 + s2))
    : sign * (high - (t * (s1 + s2) - low - t));
};

/** The angle from the positive x axis to the point `x`, `y`, from -π to π, as `Math.atan2` gives it. */
export const atan2 = (y: number, x: number): number => {
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return Number.NaN;
  }
  if (y === 0) {
    // Along the x axis: nothing ahead, a half turn behind, its side as the sign of `y` says.
    const behind = x < 0 || Object.is(x, -0);
    return behind ? (Object.is(y, -0) ? -PI : PI) : y;
  }
  if (x === 0) {
    return y > 0 ? RIGHT_ANGLE + RIGHT_ANGLE_LOW : -(RIGHT_ANGLE + RIGHT_ANGLE_LOW);
  }
  const z = atan(Math.abs(y / x));
  const turned = x > 0 ? z : PI - (z - PI_LOW);
  return y < 0 ? -turned : turned;
};

/** The angle whose sine is `x`, from -π/2 to π/2; nothing for `x` beyond a whole either way. */
export const asin = (x: number): number =>
  Math.abs(x) > 1 ? Number.NaN : atan2(x, Math.sqrt((1 - x) * (1 + x)));

/** The angle whose cosine is `x`, from nothing to π; nothing for `x` beyond a whole either way. */
export const acos = (x: number): number =>
  Math.abs(x) > 1 ? Number.NaN : atan2(Math.sqrt((1 - x) * (1 + x)), x);

/** ln 2 split in two, its first part short enough that any whole number of halvings and doublings a double holds times it is exact. */
const LN2_HIGH = 6.9314718036912381649e-1;
const LN2_LOW = 1.90821492927058770002e-10;
const INVERSE_LN2 = 1.442695040888963387;

const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

/** The largest and least powers that `exp` gives as a number, past which it is no end of one or nothing. */
const EXP_MOST = 7.09782712893383973096e2;
const EXP_LEAST = -7.4513321910194110842e2;

/** Two to the whole power `k`, exactly, from its bits, for `k` a double holds whole. */
const twoTo = (k: number) => {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setUint32(0, (k + 1023) << 20);
  return bits.getFloat64(0);
};

/** `y` times two to the whole power `k`, exactly, though two to `k` alone be too small for a double. */
const scaled = (y: number, k: number) =>
  k < -1021 ? y * twoTo(k + 1000) * twoTo(-1000) : k > 1023 ? y * twoTo(k - 1) * 2 : y * twoTo(k);

/** e to the power `x`. */
export const exp = (x: number): number => {
  if (Number.isNaN(x)) {
    return Number.NaN;
  }
  if (x > EXP_MOST) {
    return Number.POSITIVE_INFINITY;
  }
  if (x < EXP_LEAST) {
    return 0;
  }
  // As e to what is left past the nearest whole number of ln 2, doubled that many times.
  const k = Math.round(x * INVERSE_LN2);
  const high = x - k * LN2_HIGH;
  const low = k * LN2_LOW;
  const r = high - low;
  const z = r * r;
  const c = r - z * (P1 + z * (P2 + z * (P3 + z * (P4 + z * P5))));
  return k === 0 ? 1 - ((r * c) / (c - 2) - r) : scaled(1 - (low - (r * c) / (2 - c) - high), k);
};

/** How long a vector of `sides` is: the square root of the sum of their squares. */
export const hypot = (...sides: ReadonlyArray<number>): number => {
  let sum = 0;
  for (const side of sides) {
    sum += side * side;
  }
  return Math.sqrt(sum);
};
