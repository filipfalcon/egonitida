import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Result } from 'effect';
import { glb } from '#src/fixtures.ts';
import * as Joints from '#src/Joints.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

/** A knee as the model writes it: a hinge flexing, made bent 2°, and rotating as it bends, nothing straight and 30° in and 40° out at 90°. */
const knee = {
  kind: 'hinge',
  motions: {
    flex: { axis: [-2, 0, 0], range: [-5, 140], rest: 2 },
    rotate: { axis: [0, 1, 0], range: [0, 0], rest: 0 },
  },
  order: ['flex', 'rotate'],
  depends: [
    {
      limit: 'rotate.max',
      on: 'calf_l.flex',
      table: [
        [0, 0],
        [90, 40],
      ],
    },
    {
      limit: 'rotate.min',
      on: 'calf_l.flex',
      table: [
        [0, 0],
        [90, -30],
      ],
    },
  ],
  follows: [],
};

/** A hip as the model writes it: flexing, abducting, and rotating, which the hamstrings let flex only 80° with the knee straight; and an elevation it measures, down from the root. */
const hip = {
  kind: 'ball',
  motions: {
    flex: { axis: [1, 0, 0], range: [-20, 120], rest: 0 },
    abduct: { axis: [0, 0, -1], range: [-30, 45], rest: 0 },
    rotate: { axis: [0, 1, 0], range: [-40, 45], rest: 0 },
  },
  order: ['flex', 'abduct', 'rotate'],
  depends: [
    {
      limit: 'flex.max',
      on: 'calf_l.flex',
      table: [
        [0, 80],
        [90, 120],
        [140, 120],
      ],
    },
  ],
  follows: [],
  measures: { elevation: { from: 'root', direction: [0, -1, 0], rest: 10 } },
};

/** The hip, its limits depending on nothing, for a leg whose knee is another joint. */
const hipAlone = { ...hip, depends: [] };

/** A clavicle as the model writes it: elevating and protracting about axes not square to one another. */
const clavicle = {
  kind: 'ball',
  motions: {
    elevate: { axis: [0, 0, 1], range: [-10, 35], rest: 0 },
    protract: { axis: [0.3, 0.95, 0.1], range: [-25, 15], rest: 0 },
  },
  order: ['elevate', 'protract'],
};

/** A twist bone as the model writes it: rotating only as it follows, taking half its parent's rotation back. */
const twist = {
  kind: 'follower',
  motions: { rotate: { axis: [0, 1, 0], range: [0, 0], rest: 0 } },
  order: ['rotate'],
  follows: [
    {
      motion: 'rotate',
      on: 'thigh_l.rotate',
      table: [
        [-180, 90],
        [180, -90],
      ],
    },
  ],
};

/** A leg whose bones carry `joints` and `flesh` as their extras, by name, the root none. */
const leg = (
  joints: Readonly<Record<string, unknown>>,
  flesh: Readonly<Record<string, unknown>> = {},
) => {
  const extras = (name: string) => ({
    ...(joints[name] === undefined ? {} : { joint: joints[name] }),
    ...(flesh[name] === undefined ? {} : { flesh: flesh[name] }),
  });
  return glb({
    asset: { version: '2.0' },
    nodes: [
      { name: 'root', children: [1], extras: extras('root') },
      { name: 'thigh_l', children: [2], extras: extras('thigh_l') },
      { name: 'calf_l', children: [3], extras: extras('calf_l') },
      { name: 'foot_l', extras: extras('foot_l') },
    ],
    skins: [{ joints: [0, 1, 2, 3] }],
  });
};

/** Why `bytes` could not be read, or that they were. */
const whyNot = (bytes: Uint8Array) =>
  Result.match(Joints.read(bytes), { onFailure: (reason) => reason, onSuccess: () => 'read' });

/** `knee` with its motion `flex` written as `flex`. */
const kneeFlexing = (flex: unknown) => ({ ...knee, motions: { ...knee.motions, flex } });

describe('Joints.read', () => {
  const read = Result.getOrThrow(
    Joints.read(
      leg({ thigh_l: hip, calf_l: knee }, { calf_l: { radius: 0.05, length: 0.4, mass: 2.9 } }),
    ),
  );
  const joint = (name: string) => read.find((one) => one.name === name)?.joint;

  it('reads every bone that carries a joint, and no other', () => {
    expect(read.map(({ name }) => name)).toEqual(['thigh_l', 'calf_l']);
  });

  it('reads each motion of a joint, its axis of length one, its range and rest in radians, in its order', () => {
    const calf = joint('calf_l');

    expect(calf?.kind).toBe('Hinge');
    expect(calf?.order).toEqual(['flex', 'rotate']);
    expect(calf?.motions['flex']?.axis).toEqual({ x: -1, y: 0, z: 0 });
    expect(calf?.motions['flex']?.range[1]).toBeCloseTo(degrees(140), 12);
    expect(calf?.motions['flex']?.rest).toBeCloseTo(degrees(2), 12);
  });

  it('reads what a limit depends on, its table in radians', () => {
    const [max] = joint('calf_l')?.depends ?? [];

    expect(max?.motion).toBe('rotate');
    expect(max?.end).toBe('max');
    expect(max?.on).toEqual({ bone: 'calf_l', motion: 'flex' });
    expect(max?.table[1]?.[1]).toBeCloseTo(degrees(40), 12);
  });

  it('reads what a joint measures, its rest in radians', () => {
    const elevation = joint('thigh_l')?.measures['elevation'];

    expect(elevation?.from).toBe('root');
    expect(elevation?.direction).toEqual({ x: 0, y: -1, z: 0 });
    expect(elevation?.rest).toBeCloseTo(degrees(10), 12);
  });

  it('reads the flesh about a bone, and none where it carries none', () => {
    expect(joint('calf_l')?.flesh).toEqual(Option.some({ radius: 0.05, length: 0.4, mass: 2.9 }));
    expect(joint('thigh_l')?.flesh).toEqual(Option.none());
  });

  it('reads what a motion follows, by the motion it sets', () => {
    const [, follower] = Result.getOrThrow(Joints.read(leg({ thigh_l: hipAlone, calf_l: twist })));

    expect(follower?.joint.kind).toBe('Follower');
    expect(follower?.joint.follows[0]?.motion).toBe('rotate');
    expect(follower?.joint.follows[0]?.on).toEqual({ bone: 'thigh_l', motion: 'rotate' });
  });

  it('reads axes that are not square to one another as they are written', () => {
    const [, oblique] = Result.getOrThrow(
      Joints.read(leg({ thigh_l: hipAlone, calf_l: clavicle })),
    );

    expect(oblique?.joint.motions['protract']?.axis.y).toBeCloseTo(
      0.95 / Math.hypot(0.3, 0.95, 0.1),
      12,
    );
  });
});

describe('a joint the reader refuses', () => {
  it('is of no kind it knows', () => {
    expect(whyNot(leg({ calf_l: { ...knee, kind: 'pivot' } }))).toBe(
      'the joint of calf_l is of no kind a joint is: pivot',
    );
  });

  it('turns about no axis, or within a range the wrong way round', () => {
    expect(
      whyNot(leg({ calf_l: kneeFlexing({ axis: [0, 0, 0], range: [-5, 140], rest: 0 }) })),
    ).toBe('the motion flex of calf_l turns about no axis');
    expect(
      whyNot(leg({ calf_l: kneeFlexing({ axis: [1, 0, 0], range: [140, -5], rest: 0 }) })),
    ).toBe('the motion flex of calf_l ranges from more than it ranges to');
  });

  it('turns in an order that is not every motion of it once', () => {
    expect(whyNot(leg({ calf_l: { ...knee, order: ['flex'] } }))).toBe(
      'the order of calf_l is not every motion of it once',
    );
  });

  it('depends on, or follows, what is no motion or measure of a joint', () => {
    expect(
      whyNot(
        leg({
          calf_l: { ...knee, depends: [{ limit: 'rotate.max', on: 'ankle_l.flex', table: [] }] },
        }),
      ),
    ).toBe('calf_l depends on ankle_l.flex, which is no motion of a joint');
    expect(
      whyNot(
        leg({
          thigh_l: hipAlone,
          calf_l: { ...twist, follows: [{ motion: 'rotate', on: 'thigh_l.lift', table: [] }] },
        }),
      ),
    ).toBe('calf_l follows thigh_l.lift, which is no motion or measure of a joint');
  });

  it('measures from what is no bone', () => {
    expect(
      whyNot(
        leg({
          thigh_l: {
            ...hipAlone,
            measures: { elevation: { from: 'spine_04', direction: [0, -1, 0], rest: 0 } },
          },
        }),
      ),
    ).toBe('the measure elevation of thigh_l is from spine_04, which is no bone');
  });
});

describe('Joints.sourceOf', () => {
  it.effect('is a module whose joints are those read, every one', () =>
    Effect.gen(function* () {
      const read = Result.getOrThrow(
        Joints.read(
          leg({ thigh_l: hip, calf_l: knee }, { calf_l: { radius: 0.05, length: 0.4, mass: 2.9 } }),
        ),
      );
      // The module, written where it can be imported, its Option the one installed here.
      const file = join(mkdtempSync(join(tmpdir(), 'joints-')), 'leg.joints.mjs');
      writeFileSync(
        file,
        Joints.sourceOf('/models/leg.glb', read).replace(
          "from 'effect'",
          `from ${JSON.stringify(import.meta.resolve('effect'))}`,
        ),
      );

      const given = yield* Effect.promise(() => import(pathToFileURL(file).href));

      expect(given.default).toEqual(
        Object.fromEntries(read.map(({ name, joint }) => [name, joint])),
      );
    }),
  );
});

describe('Joints.plugin', () => {
  it('gives a model asked for its joints the module of them, watching its file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'joints-')), 'leg.glb');
    writeFileSync(file, leg({ thigh_l: hip, calf_l: knee }));
    const watched: Array<string> = [];

    const source = Joints.plugin().load.call(
      { addWatchFile: (watching) => watched.push(watching) },
      `${file}?joints&import`,
    );

    expect(source).toContain("import { Option } from 'effect';");
    expect(source).toContain('"calf_l":');
    expect(watched).toEqual([file]);
  });
});
