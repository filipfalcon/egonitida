import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Joint from '#src/Joint.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

/** A table of degrees, as radians. */
const inDegrees = (rows: ReadonlyArray<readonly [number, number]>) =>
  rows.map(([x, y]) => [degrees(x), degrees(y)] as const);

const ACROSS = { x: 1, y: 0, z: 0 };
const ALONG = { x: 0, y: 1, z: 0 };
const AHEAD = { x: 0, y: 0, z: 1 };

/** A leg: a hip turning every way, which the hamstrings let bend only so far while the knee is straight; a knee bending one way, its twist nothing straight and more as it bends. */
const leg: Joint.Joints = {
  thigh_l: {
    kind: 'Ball',
    axes: { flex: ACROSS, abduct: Option.some(AHEAD), twist: Option.some(ALONG) },
    swing: { flex: [degrees(-20), degrees(120)], abduct: Option.some([degrees(-30), degrees(45)]) },
    twist: Option.some([degrees(-40), degrees(45)]),
    depends: [
      {
        limit: { axis: 'flex', end: 'max' },
        on: { joint: 'calf_l', axis: 'flex' },
        table: inDegrees([
          [0, 80],
          [90, 120],
          [140, 120],
        ]),
      },
    ],
    follows: Option.none(),
    flesh: Option.none(),
  },
  calf_l: {
    kind: 'Hinge',
    axes: { flex: ACROSS, abduct: Option.none(), twist: Option.some(ALONG) },
    swing: { flex: [degrees(-5), degrees(140)], abduct: Option.none() },
    twist: Option.some([0, 0]),
    depends: [
      {
        limit: { axis: 'twist', end: 'max' },
        on: { joint: 'calf_l', axis: 'flex' },
        table: inDegrees([
          [0, 0],
          [90, 40],
        ]),
      },
      {
        limit: { axis: 'twist', end: 'min' },
        on: { joint: 'calf_l', axis: 'flex' },
        table: inDegrees([
          [0, 0],
          [90, -30],
        ]),
      },
    ],
    follows: Option.none(),
    flesh: Option.none(),
  },
};

/** A knee bent `angle` degrees, turned no other way. */
const bent = (angle: number): Joint.Angles => ({ flex: degrees(angle), abduct: 0, twist: 0 });

/** A range in degrees, rounded to a tenth. */
const shown = ([min, max]: Joint.Range) => [
  Math.round(((min * 180) / Math.PI) * 10) / 10,
  Math.round(((max * 180) / Math.PI) * 10) / 10,
];

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

describe('Joint.limitsAt', () => {
  it('gives a joint its limits as it was made, where nothing they depend on changes them', () => {
    const limits = Joint.limitsAt(leg, { calf_l: bent(90) }, 'calf_l');

    expect(shown(limits.flex)).toEqual([-5, 140]);
    expect(Option.isNone(limits.abduct)).toBe(true);
  });

  it('narrows a knee’s twist to nothing straight, and opens it as the knee bends', () => {
    const at = (knee: number) =>
      Option.map(Joint.limitsAt(leg, { calf_l: bent(knee) }, 'calf_l').twist, shown);

    expect(at(0)).toEqual(Option.some([0, 0]));
    expect(at(45)).toEqual(Option.some([-15, 20]));
    expect(at(90)).toEqual(Option.some([-30, 40]));
  });

  it('lets the hip bend as far as the bent knee lets the hamstrings', () => {
    const hipAt = (knee: number) =>
      shown(Joint.limitsAt(leg, { calf_l: bent(knee) }, 'thigh_l').flex);

    expect(hipAt(0)).toEqual([-20, 80]);
    expect(hipAt(90)).toEqual([-20, 120]);
  });

  it('gives no limits to what is no joint', () => {
    const limits = Joint.limitsAt(leg, {}, 'head');

    expect(limits.flex).toEqual([0, 0]);
  });
});
