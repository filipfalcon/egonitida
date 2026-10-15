import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Joint from '#src/Joint.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

/** A table of degrees, as radians. */
const inDegrees = (rows: ReadonlyArray<readonly [number, number]>) =>
  rows.map(([x, y]) => [degrees(x), degrees(y)] as const);

/** A motion about `axis`, within `range` degrees, at `rest` degrees as made. */
const motion = (
  axis: readonly [number, number, number],
  range: readonly [number, number],
  rest = 0,
): Joint.Motion => ({
  axis: { x: axis[0], y: axis[1], z: axis[2] },
  range: [degrees(range[0]), degrees(range[1])],
  rest: degrees(rest),
});

/** A leg: a hip, which the hamstrings let flex only 80° while the knee is straight; a knee bending and, as it bends, rotating, nothing straight and 30° in and 40° out at 90°. */
const leg: Joint.Joints = {
  thigh_l: {
    kind: 'Ball',
    motions: {
      flex: motion([1, 0, 0], [-20, 120]),
      abduct: motion([0, 0, -1], [-30, 45]),
      rotate: motion([0, 1, 0], [-40, 45]),
    },
    order: ['flex', 'abduct', 'rotate'],
    depends: [
      {
        motion: 'flex',
        end: 'max',
        on: { bone: 'calf_l', motion: 'flex' },
        table: inDegrees([
          [0, 80],
          [90, 120],
          [140, 120],
        ]),
      },
    ],
    follows: [],
    measures: {},
    flesh: Option.none(),
  },
  calf_l: {
    kind: 'Hinge',
    motions: { flex: motion([-1, 0, 0], [-5, 140], 2), rotate: motion([0, 1, 0], [0, 0]) },
    order: ['flex', 'rotate'],
    depends: [
      {
        motion: 'rotate',
        end: 'max',
        on: { bone: 'calf_l', motion: 'flex' },
        table: inDegrees([
          [0, 0],
          [90, 40],
        ]),
      },
      {
        motion: 'rotate',
        end: 'min',
        on: { bone: 'calf_l', motion: 'flex' },
        table: inDegrees([
          [0, 0],
          [90, -30],
        ]),
      },
    ],
    follows: [],
    measures: {},
    flesh: Option.none(),
  },
};

/** A range in degrees, rounded to a tenth. */
const shown = (range: Joint.Range | undefined) =>
  range === undefined
    ? undefined
    : range.map((angle) => Math.round(((angle * 180) / Math.PI) * 10) / 10);

/** A knee bent `angle` degrees. */
const bent = (angle: number): Joint.Turns => ({ calf_l: { flex: degrees(angle) } });

describe('Joint.along', () => {
  it('reads a table between its rows, and holds its ends beyond them', () => {
    const table = [
      [0, 80],
      [90, 120],
      [140, 120],
    ] as const;

    expect(Joint.along(table, 45)).toBe(100);
    expect(Joint.along(table, -10)).toBe(80);
    expect(Joint.along(table, 200)).toBe(120);
    expect(Joint.along([], 3)).toBe(0);
  });
});

describe('Joint.valueOf', () => {
  it('is a motion’s value as the pose names it, or as the model was made', () => {
    expect(Joint.valueOf(leg, bent(30), { bone: 'calf_l', motion: 'flex' })).toBeCloseTo(
      degrees(30),
      12,
    );
    expect(Joint.valueOf(leg, {}, { bone: 'calf_l', motion: 'flex' })).toBeCloseTo(degrees(2), 12);
    expect(Joint.valueOf(leg, {}, { bone: 'head', motion: 'nod' })).toBe(0);
  });
});

describe('Joint.limitsAt', () => {
  it('gives each motion of a joint its range as made, where nothing it depends on changes it', () => {
    const limits = Joint.limitsAt(leg, bent(90), 'calf_l');

    expect(shown(limits['flex'])).toEqual([-5, 140]);
  });

  it('gives a knee rotation nothing straight, and its tables’ bounds outright as it bends', () => {
    const at = (knee: number) => shown(Joint.limitsAt(leg, bent(knee), 'calf_l')['rotate']);

    expect(at(0)).toEqual([0, 0]);
    expect(at(45)).toEqual([-15, 20]);
    expect(at(90)).toEqual([-30, 40]);
  });

  it('lets the hip flex as far as the bent knee lets the hamstrings', () => {
    const hipAt = (knee: number) => shown(Joint.limitsAt(leg, bent(knee), 'thigh_l')['flex']);

    expect(hipAt(0)).toEqual([-20, 80]);
    expect(hipAt(90)).toEqual([-20, 120]);
  });

  it('gives no motions to what is no joint', () => {
    expect(Joint.limitsAt(leg, {}, 'head')).toEqual({});
  });
});
