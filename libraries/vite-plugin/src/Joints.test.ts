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

/** A knee as the model carries it: a hinge bending about the line across it, its twist nothing straight and 40° out and 30° in at 90° bent. */
const knee = {
  kind: 'hinge',
  axes: { flex: [2, 0, 0], twist: [0, 1, 0] },
  swing: { flex: [-5, 140] },
  twist: [0, 0],
  depends: [
    {
      limit: 'twist.max',
      on: 'calf_l.flex',
      table: [
        [0, 0],
        [90, 40],
      ],
    },
    {
      limit: 'twist.min',
      on: 'calf_l.flex',
      table: [
        [0, 0],
        [90, -30],
      ],
    },
  ],
  follows: null,
};

/** A hip as the model carries it: a ball, which the hamstrings let bend only 80° with the knee straight. */
const hip = {
  kind: 'ball',
  axes: { flex: [1, 0, 0], abduct: [0, 0, 1], twist: [0, 1, 0] },
  swing: { flex: [-20, 120], abduct: [-30, 45] },
  twist: [-40, 45],
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
  follows: null,
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

  it('reads a knee as a hinge from −5° to 140°, its axes of length one, in radians', () => {
    const calf = joint('calf_l');

    expect(calf?.kind).toBe('Hinge');
    expect(calf?.swing.flex[0]).toBeCloseTo(degrees(-5), 12);
    expect(calf?.swing.flex[1]).toBeCloseTo(degrees(140), 12);
    expect(calf?.axes.flex).toEqual({ x: 1, y: 0, z: 0 });
    expect(calf?.axes.abduct).toEqual(Option.none());
  });

  it('reads what a limit depends on, its table in radians', () => {
    const [max] = joint('calf_l')?.depends ?? [];

    expect(max?.limit).toEqual({ axis: 'twist', end: 'max' });
    expect(max?.on).toEqual({ joint: 'calf_l', axis: 'flex' });
    expect(max?.table[1]?.[0]).toBeCloseTo(degrees(90), 12);
    expect(max?.table[1]?.[1]).toBeCloseTo(degrees(40), 12);
  });

  it('reads the flesh about a bone, and none where it carries none', () => {
    expect(joint('calf_l')?.flesh).toEqual(Option.some({ radius: 0.05, length: 0.4, mass: 2.9 }));
    expect(joint('thigh_l')?.flesh).toEqual(Option.none());
  });

  it('reads what a joint follows, the axis it sets the one it follows unless it says', () => {
    const blade = {
      ...hip,
      depends: [],
      follows: {
        joint: 'thigh_l',
        axis: 'flex',
        table: [
          [30, 0],
          [180, 50],
        ],
      },
    };
    const [, scapula] = Result.getOrThrow(Joints.read(leg({ thigh_l: hip, calf_l: blade })));

    expect(Option.map(scapula?.joint.follows ?? Option.none(), ({ sets }) => sets)).toEqual(
      Option.some('flex'),
    );
  });
});

describe('a joint the reader refuses', () => {
  it('is of no kind it knows', () => {
    expect(whyNot(leg({ calf_l: { ...knee, kind: 'pivot' } }))).toBe(
      'the joint of calf_l is no hinge, saddle, or ball as written',
    );
  });

  it('turns about axes that are not square to one another', () => {
    expect(whyNot(leg({ calf_l: { ...knee, axes: { flex: [1, 0, 0], twist: [1, 1, 0] } } }))).toBe(
      'the axes of the joint of calf_l are not square to one another',
    );
  });

  it('swings a second way as a hinge, or not as a saddle or a ball', () => {
    expect(
      whyNot(leg({ calf_l: { ...knee, swing: { flex: [-5, 140], abduct: [-10, 10] } } })),
    ).toBe('the joint of calf_l is a hinge, which swings one way, yet abducts');
    expect(whyNot(leg({ thigh_l: { ...hip, swing: { flex: [-20, 120] } } }))).toBe(
      'the joint of thigh_l is a ball, which swings two ways, yet has no abduction axis or range',
    );
  });

  it('has a range whose least is more than its most', () => {
    expect(whyNot(leg({ calf_l: { ...knee, swing: { flex: [140, -5] } } }))).toBe(
      'the joint of calf_l bends from more than it bends to',
    );
  });

  it('depends on, or follows, what is no joint, or no axis of one', () => {
    expect(
      whyNot(
        leg({
          calf_l: { ...knee, depends: [{ limit: 'twist.max', on: 'ankle_l.flex', table: [] }] },
        }),
      ),
    ).toBe('the joint of calf_l depends on ankle_l, which is no joint');
    expect(
      whyNot(
        leg({
          thigh_l: hip,
          calf_l: { ...knee, follows: { joint: 'thigh_l', axis: 'elevation', table: [] } },
        }),
      ),
    ).toBe('the joint of calf_l follows elevation of thigh_l, which is no axis of a joint');
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
    expect(source).toContain('"calf_l": {');
    expect(source).toContain("kind: 'Hinge'");
    expect(watched).toEqual([file]);
  });
});
