import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Result } from 'effect';
import * as Clips from '#src/Clips.ts';
import { glb } from '#src/fixtures.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

/** The inverse bind matrix of a joint bound only moved to `x`, `y`, `z`, column by column. */
const movedTo = (x: number, y: number, z: number) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  -x,
  -y,
  -z,
  1,
];

/** A quarter turn about x, as glTF writes a quaternion. */
const quarter = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/**
 * A leg with a clip: a root at the origin, no joint; a hip a metre up, the topmost joint; a knee half a metre below it, bending about the line across it; and an ankle. Its clip, `kick`, lasting half a second, bends the knee from straight to a quarter turn and raises the hip a tenth of a metre.
 */
const leg = (interpolation = 'LINEAR') => {
  const floats = [
    ...movedTo(0, 0, 0),
    ...movedTo(0, 1, 0),
    ...movedTo(0, 0.5, 0),
    ...movedTo(0, 0, 0),
    // The clip's times, the knee's turns, and the hip's places.
    0,
    0.5,
    0,
    0,
    0,
    1,
    ...quarter,
    0,
    1,
    0,
    0,
    1.1,
    0,
  ];
  const view = (offset: number, count: number) => ({
    buffer: 0,
    byteOffset: offset * 4,
    byteLength: count * 4,
  });
  return glb(
    {
      asset: { version: '2.0' },
      nodes: [
        { name: 'root', children: [1] },
        {
          name: 'thigh',
          translation: [0, 1, 0],
          children: [2],
          extras: {
            joint: {
              kind: 'ball',
              axes: { flex: [1, 0, 0], abduct: [0, 0, 1], twist: [0, 1, 0] },
              swing: { flex: [-20, 120], abduct: [-30, 45] },
              twist: [-40, 45],
            },
          },
        },
        {
          name: 'calf',
          translation: [0, -0.5, 0],
          children: [3],
          extras: {
            joint: { kind: 'hinge', axes: { flex: [1, 0, 0] }, swing: { flex: [-5, 140] } },
          },
        },
        { name: 'foot', translation: [0, -0.5, 0] },
      ],
      skins: [{ joints: [0, 1, 2, 3], inverseBindMatrices: 0 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 4, type: 'MAT4' },
        { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: 2, componentType: 5126, count: 2, type: 'VEC4' },
        { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
      ],
      bufferViews: [view(0, 64), view(64, 2), view(66, 8), view(74, 6)],
      buffers: [{ byteLength: floats.length * 4 }],
      animations: [
        {
          name: 'kick',
          samplers: [
            { input: 1, output: 2, interpolation },
            { input: 1, output: 3, interpolation },
          ],
          channels: [
            { sampler: 0, target: { node: 2, path: 'rotation' } },
            { sampler: 1, target: { node: 1, path: 'translation' } },
          ],
        },
      ],
    },
    floats,
  );
};

describe('Clips.read', () => {
  const clips = Result.getOrThrow(Clips.read(leg()));
  const kick = clips['kick'];

  it('reads every clip by its name, as long as its last key, sampled on its keys', () => {
    expect(Object.keys(clips)).toEqual(['kick']);
    expect(kick?.duration).toBeCloseTo(0.5, 6);
    expect(kick?.times).toEqual([0, 0.5]);
  });

  it('reads each joint’s turn at each key as its angles, from how the bone was made', () => {
    expect(kick?.poses[0]?.turns['calf']?.flex).toBeCloseTo(0, 6);
    expect(kick?.poses[1]?.turns['calf']?.flex).toBeCloseTo(degrees(90), 6);
  });

  it('reads the topmost joint moved as the whole figure standing elsewhere', () => {
    expect(kick?.poses[0]?.at.y).toBeCloseTo(0, 6);
    expect(kick?.poses[1]?.at.y).toBeCloseTo(0.1, 6);
  });

  it('refuses a clip whose keys are not floats, or that turns no bone it knows', () => {
    const odd = leg('CUBIC');

    expect(Result.isFailure(Clips.read(odd))).toBe(true);
  });
});

describe('Clips.plugin', () => {
  it('gives a model asked for its clips the module of them', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'clips-')), 'leg.glb');
    writeFileSync(file, leg());

    const source = Clips.plugin().load.call({ addWatchFile: () => {} }, `${file}?clips`);

    expect(source).toContain('export default {');
    expect(source).toContain('"kick":');
  });
});
