import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Option, Result } from 'effect';
import * as Bones from '#src/Bones.ts';

/** A binary glTF of `json`, and `bin` as its binary chunk, each padded to whole words. */
const glb = (json: unknown, bin: ReadonlyArray<number> = []) => {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = bin.length * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(text, 20);
  if (binLength > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true);
    bin.forEach((value, index) => view.setFloat32(at + 8 + index * 4, value, true));
  }
  return bytes;
};

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

/**
 * A leg under an armature that is no joint: a root at the origin, a hip two metres up, named with a space, and a knee bound at 0.2, 1, 0.3, turned a quarter about the depth and twice as big, its inverse bind matrix worked out by hand.
 */
const leg = glb(
  {
    asset: { version: '2.0' },
    nodes: [
      { name: 'Armature', children: [1] },
      { name: 'root', children: [2] },
      { name: 'hip bone', children: [3] },
      { name: 'knee' },
    ],
    skins: [{ joints: [1, 2, 3], inverseBindMatrices: 0 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'MAT4' }],
    bufferViews: [{ buffer: 0, byteLength: 192 }],
    buffers: [{ byteLength: 192 }],
  },
  [
    ...movedTo(0, 0, 0),
    ...movedTo(0, 2, 0),
    0,
    -0.5,
    0,
    0,
    0.5,
    0,
    0,
    0,
    0,
    0,
    0.5,
    0,
    -0.5,
    0.1,
    -0.15,
    1,
  ],
);

/** How far `point` is from `x`, `y`, `z`. */
const off = (point: Bones.Bone['at'] | undefined, x: number, y: number, z: number) =>
  point === undefined ? Infinity : Math.hypot(point.x - x, point.y - y, point.z - z);

describe('Bones.read', () => {
  const bones = Result.getOrThrow(Bones.read(leg));
  const bone = (name: string) => bones.find((one) => one.name === name);

  it('names every joint as Three.js does, its parent the nearest joint above it', () => {
    expect(bones.map(({ name }) => name)).toEqual(['root', 'hip_bone', 'knee']);
    expect(bone('root')?.parent).toEqual(Option.none());
    expect(bone('hip_bone')?.parent).toEqual(Option.some('root'));
    expect(bone('knee')?.parent).toEqual(Option.some('hip_bone'));
  });

  it('stands each where its skin was bound to it, however turned and grown', () => {
    expect(off(bone('root')?.at, 0, 0, 0)).toBeLessThan(1e-6);
    expect(off(bone('hip_bone')?.at, 0, 2, 0)).toBeLessThan(1e-6);
    expect(off(bone('knee')?.at, 0.2, 1, 0.3)).toBeLessThan(1e-6);
  });

  it('refuses what is no binary glTF, and bones it cannot tell apart', () => {
    const twice = glb({
      asset: { version: '2.0' },
      nodes: [{ name: 'bone', children: [1] }, { name: 'bone' }],
      skins: [{ joints: [0, 1] }],
    });

    expect(Bones.read(new TextEncoder().encode('{}'))).toEqual(Result.fail('it is no binary glTF'));
    expect(Bones.read(twice)).toEqual(Result.fail('two of its bones are named bone'));
  });
});

describe('Bones.sourceOf', () => {
  it('is a module giving each bone by its name, its parent, and where it stands', () => {
    const source = Bones.sourceOf('/models/leg.glb', Result.getOrThrow(Bones.read(leg)));

    expect(source).toContain("import { Option } from 'effect';");
    expect(source).toContain('/** The bones of leg.glb as it was made. */');
    expect(source).toContain('"root": { parent: Option.none(), at: { x: 0, y: 0, z: 0 } },');
    expect(source).toContain(
      '"hip_bone": { parent: Option.some("root"), at: { x: 0, y: 2, z: 0 } },',
    );
  });
});

describe('Bones.plugin', () => {
  it('loads before Vite gives a model its URL, and only what asks for its bones', () => {
    const plugin = Bones.plugin();
    const watched: Array<string> = [];

    expect(plugin.enforce).toBe('pre');
    expect(
      plugin.load.call({ addWatchFile: (file) => watched.push(file) }, '/models/leg.glb'),
    ).toBe(undefined);
    expect(watched).toEqual([]);
  });

  it('gives a model asked for its bones the module of them, watching its file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bones-')), 'leg.glb');
    writeFileSync(file, leg);
    const watched: Array<string> = [];

    const source = Bones.plugin().load.call(
      { addWatchFile: (watching) => watched.push(watching) },
      `${file}?bones`,
    );

    expect(source).toContain('"knee": { parent: Option.some("hip_bone")');
    expect(watched).toEqual([file]);
  });

  it('reads it with the queries the development server adds to an import beside its own', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bones-')), 'leg.glb');
    writeFileSync(file, leg);
    const watched: Array<string> = [];

    const source = Bones.plugin().load.call(
      { addWatchFile: (watching) => watched.push(watching) },
      `${file}?bones&import`,
    );

    expect(source).toContain('"knee": { parent: Option.some("hip_bone")');
    expect(watched).toEqual([file]);
  });
});
