import { Schema } from 'effect';
import * as Maths from '#src/Maths.ts';
import type * as Ray from '#src/Ray.ts';

/**
 * Turns in space as quaternions, as plain data: a turn about an axis, one turn after another, a point turned, a turn split into its twist about an axis and the swing after it, and the way between two turns. A figure's bones turn by them, in a step as in a view, so they are worked out with `Maths`, alike on every engine. A turn here is always of length one.
 */

/** A turn: the axis it turns about, scaled by the sine of half its angle, and the cosine of half its angle. */
export const Quaternion = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
  w: Schema.Finite,
});
export type Quaternion = typeof Quaternion.Type;

/** A point, or a direction. */
export type Point = Ray.Point;

/** No turn at all. */
export const identity: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** `q` brought to length one; no turn, if it has no length. */
export const normalize = (q: Quaternion): Quaternion => {
  const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return length === 0
    ? identity
    : { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
};

/** The turn by `angle` radians about `axis`, to the left as the angle grows, looking down the axis toward where it starts. */
export const about = (axis: Point, angle: number): Quaternion => {
  const length = Maths.hypot(axis.x, axis.y, axis.z);
  if (length === 0) {
    return identity;
  }
  const s = Maths.sin(angle / 2) / length;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Maths.cos(angle / 2) };
};

/** Turning by `b`, then by `a`. */
export const multiply = (a: Quaternion, b: Quaternion): Quaternion => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** The turn that turns `q` back. */
export const invert = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** How alike two turns are: the cosine of half the angle between them, its sign telling which way round one is written. */
export const dot = (a: Quaternion, b: Quaternion): number =>
  a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

/** `point` turned by `q`. */
export const rotate = (q: Quaternion, point: Point): Point => {
  // t = 2 (q × point); turned = point + w t + q × t.
  const tx = 2 * (q.y * point.z - q.z * point.y);
  const ty = 2 * (q.z * point.x - q.x * point.z);
  const tz = 2 * (q.x * point.y - q.y * point.x);
  return {
    x: point.x + q.w * tx + (q.y * tz - q.z * ty),
    y: point.y + q.w * ty + (q.z * tx - q.x * tz),
    z: point.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};

/** `q` split into its twist about `axis`, of length one, and the swing after it, which turns that axis away: `q` is the swing after the twist. */
export const swingTwist = (
  q: Quaternion,
  axis: Point,
): { readonly swing: Quaternion; readonly twist: Quaternion } => {
  const along = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const twist = normalize({ x: axis.x * along, y: axis.y * along, z: axis.z * along, w: q.w });
  return { swing: multiply(q, invert(twist)), twist };
};

/** The angle `q` turns, from nothing to π, and the axis it turns about, of length one; along x for no turn at all. */
export const axisAngle = (q: Quaternion): { readonly axis: Point; readonly angle: number } => {
  // Written the way round whose angle is at most a half turn.
  const sign = q.w < 0 ? -1 : 1;
  const length = Maths.hypot(q.x, q.y, q.z);
  return length === 0
    ? { axis: { x: 1, y: 0, z: 0 }, angle: 0 }
    : {
        axis: { x: (sign * q.x) / length, y: (sign * q.y) / length, z: (sign * q.z) / length },
        angle: 2 * Maths.atan2(length, sign * q.w),
      };
};

/** The shortest turn that takes the direction `from` onto the direction `onto`; for two straight apart, a half turn about any axis square to them. */
export const between = (from: Point, onto: Point): Quaternion => {
  const a = Maths.hypot(from.x, from.y, from.z);
  const b = Maths.hypot(onto.x, onto.y, onto.z);
  if (a === 0 || b === 0) {
    return identity;
  }
  const u = { x: from.x / a, y: from.y / a, z: from.z / a };
  const v = { x: onto.x / b, y: onto.y / b, z: onto.z / b };
  const cosine = u.x * v.x + u.y * v.y + u.z * v.z;
  if (cosine < -1 + 1e-12) {
    // Straight apart: a half turn about an axis square to them, across x or, if they lie along it, y.
    const square = Math.abs(u.x) < 0.9 ? { x: 0, y: -u.z, z: u.y } : { x: u.z, y: 0, z: -u.x };
    return about(square, Math.PI);
  }
  return normalize({
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
    w: 1 + cosine,
  });
};

/** The way from `a` to `b`, `t` of it along, at a steady pace, the short way round. */
export const slerp = (a: Quaternion, b: Quaternion, t: number): Quaternion => {
  const cosine = dot(a, b);
  // The short way round: `b` written the way round nearer `a`.
  const sign = cosine < 0 ? -1 : 1;
  const near = { x: sign * b.x, y: sign * b.y, z: sign * b.z, w: sign * b.w };
  const c = sign * cosine;
  if (c > 0.9995) {
    return normalize({
      x: a.x + (near.x - a.x) * t,
      y: a.y + (near.y - a.y) * t,
      z: a.z + (near.z - a.z) * t,
      w: a.w + (near.w - a.w) * t,
    });
  }
  const angle = Maths.acos(c);
  const s = Maths.sin(angle);
  const from = Maths.sin((1 - t) * angle) / s;
  const to = Maths.sin(t * angle) / s;
  return {
    x: a.x * from + near.x * to,
    y: a.y * from + near.y * to,
    z: a.z * from + near.z * to,
    w: a.w * from + near.w * to,
  };
};

/** A column of a matrix: where it takes one axis. */
export type Column = readonly [number, number, number];

/** The turn of the matrix whose columns are `columns`, where it takes each axis, however it grows them: each column brought to length one first. */
export const fromColumns = (columns: readonly [Column, Column, Column]): Quaternion => {
  const unit = ([x, y, z]: Column): Column => {
    const length = Maths.hypot(x, y, z);
    return length === 0 ? [x, y, z] : [x / length, y / length, z / length];
  };
  const [[m00, m10, m20], [m01, m11, m21], [m02, m12, m22]] = [
    unit(columns[0]),
    unit(columns[1]),
    unit(columns[2]),
  ];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return normalize({
      x: (m21 - m12) * s,
      y: (m02 - m20) * s,
      z: (m10 - m01) * s,
      w: 0.25 / s,
    });
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return normalize({ x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s });
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return normalize({ x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s, w: (m02 - m20) / s });
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return normalize({ x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s, w: (m10 - m01) / s });
};
