import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Result } from 'effect';
import { glb } from '#src/fixtures.ts';
import * as Touches from '#src/Touches.ts';

/** A foot carrying touch points as nodes below its bone: an instep atop it, facing up, and a heel turned half about the upright, facing ahead in its own frame, so back in the foot's. */
const foot = (extra: ReadonlyArray<unknown> = []) =>
  glb({
    asset: { version: '2.0' },
    nodes: [
      { name: 'foot_l', children: [1, 2, ...extra.map((_, at) => 3 + at)] },
      {
        name: 'touch-instep_l',
        translation: [0, 0.04, 0.2],
        extras: { touch: { radius: 0.03, normal: [0, 1, 0] } },
      },
      {
        name: 'touch-heel_l',
        translation: [0, 0.02, -0.06],
        rotation: [0, 1, 0, 0],
        extras: { touch: { radius: 0.03, normal: [0, 0, 1] } },
      },
      ...extra,
    ],
    skins: [{ joints: [0] }],
  });

describe('Touches.read', () => {
  it('reads every touch point below a bone, where it is and which way it faces in the bone’s frame', () => {
    const read = Result.getOrThrow(Touches.read(foot()));
    const heel = read.find(({ part }) => part === 'heel_l');

    expect(read.map(({ part }) => part)).toEqual(['instep_l', 'heel_l']);
    expect(read[0]?.point).toEqual({
      bone: 'foot_l',
      at: { x: 0, y: 0.04, z: 0.2 },
      radius: 0.03,
      normal: { x: 0, y: 1, z: 0 },
    });
    expect(heel?.point.normal.z).toBeCloseTo(-1, 12);
  });

  it('refuses a touch point below no bone, or written as none is', () => {
    const loose = glb({
      asset: { version: '2.0' },
      nodes: [{ name: 'touch-chest', extras: { touch: { radius: 0.1, normal: [0, 0, 1] } } }],
    });

    expect(Result.isFailure(Touches.read(loose))).toBe(true);
    expect(
      Touches.read(foot([{ name: 'touch-toe_l', extras: { touch: { radius: 'small' } } }])),
    ).toEqual(Result.fail('the touch point toe_l is not written as a touch point is'));
  });
});

describe('Touches.plugin', () => {
  it('gives a model asked for its touch points the module of them', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'touches-')), 'foot.glb');
    writeFileSync(file, foot());

    const source = Touches.plugin().load.call({ addWatchFile: () => {} }, `${file}?touches`);

    expect(source).toContain(
      '"instep_l": { bone: "foot_l", at: { x: 0, y: 0.04, z: 0.2 }, radius: 0.03, normal: { x: 0, y: 1, z: 0 } },',
    );
  });
});
