import { describe, expect, it } from '@effect/vitest';
import * as Quaternion from '#src/Quaternion.ts';

/** How far apart two points are. */
const apart = (a: Quaternion.Point, b: Quaternion.Point) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** How far apart two turns are, the same turn written either way round counting as one. */
const unlike = (a: Quaternion.Quaternion, b: Quaternion.Quaternion) =>
  1 - Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);

const up = { x: 0, y: 1, z: 0 };
const across = { x: 1, y: 0, z: 0 };
const AHEAD = { x: 0, y: 0, z: 1 };

describe('Quaternion', () => {
  it('turns a point about an axis, to the left as the angle grows', () => {
    const quarter = Quaternion.about(up, Math.PI / 2);

    expect(
      apart(Quaternion.rotate(quarter, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: -1 }),
    ).toBeLessThan(1e-15);
  });

  it('turns by one turn and then another as their product does, the second first', () => {
    const first = Quaternion.about(up, Math.PI / 2);
    const second = Quaternion.about(across, Math.PI / 2);
    const point = { x: 0, y: 0, z: 1 };

    expect(
      apart(
        Quaternion.rotate(Quaternion.multiply(second, first), point),
        Quaternion.rotate(second, Quaternion.rotate(first, point)),
      ),
    ).toBeLessThan(1e-15);
  });

  it('turns back by its inverse', () => {
    const turn = Quaternion.about({ x: 0.6, y: 0.8, z: 0 }, 1.2);

    expect(
      unlike(Quaternion.multiply(Quaternion.invert(turn), turn), Quaternion.identity),
    ).toBeLessThan(1e-15);
  });

  it('splits a turn into its twist about an axis and the swing after it, which make it again', () => {
    const turn = Quaternion.multiply(Quaternion.about(across, 0.7), Quaternion.about(up, -0.4));

    const { swing, twist } = Quaternion.swingTwist(turn, up);

    expect(unlike(twist, Quaternion.about(up, -0.4))).toBeLessThan(1e-15);
    expect(unlike(swing, Quaternion.about(across, 0.7))).toBeLessThan(1e-15);
    expect(unlike(Quaternion.multiply(swing, twist), turn)).toBeLessThan(1e-15);
  });

  it('goes between two turns the short way, at a steady pace', () => {
    const from = Quaternion.about(up, 0.2);
    const to = Quaternion.about(up, 1.4);

    expect(unlike(Quaternion.slerp(from, to, 0.25), Quaternion.about(up, 0.5))).toBeLessThan(1e-15);
    expect(unlike(Quaternion.slerp(from, to, 0), from)).toBeLessThan(1e-15);
    expect(unlike(Quaternion.slerp(from, to, 1), to)).toBeLessThan(1e-15);
  });

  it('is read from a matrix of columns, however it is grown, as a bind matrix holds a bone', () => {
    const turn = Quaternion.about({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    // Turned a quarter about the depth, twice as big: its columns are where each axis goes.
    const columns = [
      [0, 2, 0],
      [-2, 0, 0],
      [0, 0, 2],
    ] as const;

    expect(unlike(Quaternion.fromColumns(columns), turn)).toBeLessThan(1e-15);
  });

  it('gives an angle about an axis for a turn about it', () => {
    const { axis, angle } = Quaternion.axisAngle(Quaternion.about(across, -0.9));

    expect(angle).toBeCloseTo(0.9, 14);
    expect(apart(axis, { x: -1, y: 0, z: 0 })).toBeLessThan(1e-14);
  });

  it('turns one direction onto another the shortest way, even straight back', () => {
    const from = { x: 0, y: 1, z: 0 };
    const onto = { x: 0, y: 0, z: 2 };
    const back = { x: 0, y: -1, z: 0 };

    expect(apart(Quaternion.rotate(Quaternion.between(from, onto), from), AHEAD)).toBeLessThan(
      1e-15,
    );
    expect(apart(Quaternion.rotate(Quaternion.between(from, back), from), back)).toBeLessThan(
      1e-15,
    );
    expect(unlike(Quaternion.between(from, from), Quaternion.identity)).toBeLessThan(1e-15);
  });
});
