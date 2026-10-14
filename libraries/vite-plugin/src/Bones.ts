import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Option, Result, Schema } from 'effect';

/**
 * A model's bones as it was made, read from its file as the game is built: a module importing `./figure.glb?bones` is given them as `Shape.Bones`, each bone by its name, the bone above it, and where it stands, so the simulation stands a figure as long as her model is drawn, read from the model itself and never copied out of it. A binary glTF, as Blender exports one, is read; each bone stands where its skin was bound to it, as `Shaping` finds it, and is named as Three.js names it on loading.
 */

/** What an import asks of a model's file to be given its bones. */
export const QUERY = '?bones';

/** A bone as read: its name, the name of the bone above it, if any, and where it stands. */
export interface Bone {
  readonly name: string;
  readonly parent: Option.Option<string>;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
}

/** The parts of a glTF's JSON its bones are read from. */
const Gltf = Schema.Struct({
  nodes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        children: Schema.optional(Schema.Array(Schema.Int)),
      }),
    ),
  ),
  skins: Schema.optional(
    Schema.Array(
      Schema.Struct({
        joints: Schema.Array(Schema.Int),
        inverseBindMatrices: Schema.optional(Schema.Int),
      }),
    ),
  ),
  accessors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        bufferView: Schema.optional(Schema.Int),
        byteOffset: Schema.optional(Schema.Int),
        componentType: Schema.Int,
        count: Schema.Int,
        type: Schema.String,
      }),
    ),
  ),
  bufferViews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        byteOffset: Schema.optional(Schema.Int),
        byteLength: Schema.Int,
        byteStride: Schema.optional(Schema.Int),
      }),
    ),
  ),
});
type Gltf = typeof Gltf.Type;

/** How a binary glTF begins, and how each of its chunks is marked, as little-endian words. */
const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A float, as an accessor's component type says. */
const FLOAT = 5126;

/** The name Three.js gives a node named `name` on loading it: its spaces made underscores, and the characters a property path reserves left out. */
export const sanitized = (name: string) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

/** The JSON and binary chunks of the binary glTF `bytes`, or why it is none. */
const chunksOf = (bytes: Uint8Array): Result.Result<{ json: unknown; bin: DataView }, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    return Result.fail('it is no binary glTF');
  }
  let json: unknown = undefined;
  let bin: DataView = new DataView(new ArrayBuffer(0));
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const start = bytes.byteOffset + at + 8;
    if (type === JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(at + 8, at + 8 + length)));
    }
    if (type === BIN_CHUNK) {
      bin = new DataView(bytes.buffer, start, length);
    }
    at += 8 + length;
  }
  return json === undefined ? Result.fail('it has no JSON chunk') : Result.succeed({ json, bin });
};

/** The matrices of accessor `index` of `gltf`, sixteen floats each, column by column, or why they cannot be read. */
const matricesOf = (
  gltf: Gltf,
  bin: DataView,
  index: number,
): Result.Result<ReadonlyArray<ReadonlyArray<number>>, string> => {
  const accessor = gltf.accessors?.[index];
  const bufferView =
    accessor?.bufferView === undefined ? undefined : gltf.bufferViews?.[accessor.bufferView];
  if (accessor === undefined || bufferView === undefined) {
    return Result.fail(`its inverse bind matrices, accessor ${index}, are missing`);
  }
  if (accessor.componentType !== FLOAT || accessor.type !== 'MAT4') {
    return Result.fail(`its inverse bind matrices, accessor ${index}, are no matrices of floats`);
  }
  const stride = bufferView.byteStride ?? 64;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (start + stride * (accessor.count - 1) + 64 > bin.byteLength) {
    return Result.fail(`its inverse bind matrices, accessor ${index}, run past its binary chunk`);
  }
  return Result.succeed(
    Array.from({ length: accessor.count }, (_, matrix) =>
      Array.from({ length: 16 }, (_, at) => bin.getFloat32(start + stride * matrix + at * 4, true)),
    ),
  );
};

/** A column of three numbers. */
type Column = readonly [number, number, number];

/** The determinant of the matrix of columns `a`, `b`, and `c`. */
const determinant = ([a0, a1, a2]: Column, [b0, b1, b2]: Column, [c0, c1, c2]: Column) =>
  a0 * (b1 * c2 - b2 * c1) - b0 * (a1 * c2 - a2 * c1) + c0 * (a1 * b2 - a2 * b1);

/** Where a joint whose inverse bind matrix is `m`, column by column, stands as bound: its bind matrix's translation, which turns the inverse's back, `p` solving `A p = -t` by Cramer's rule. */
const boundAt = (m: ReadonlyArray<number>) => {
  const [
    a0 = 1,
    a1 = 0,
    a2 = 0,
    ,
    b0 = 0,
    b1 = 1,
    b2 = 0,
    ,
    c0 = 0,
    c1 = 0,
    c2 = 1,
    ,
    x = 0,
    y = 0,
    z = 0,
  ] = m;
  const a: Column = [a0, a1, a2];
  const b: Column = [b0, b1, b2];
  const c: Column = [c0, c1, c2];
  const t: Column = [-x, -y, -z];
  const whole = determinant(a, b, c);
  return {
    x: determinant(t, b, c) / whole,
    y: determinant(a, t, c) / whole,
    z: determinant(a, b, t) / whole,
  };
};

/**
 * The bones of the binary glTF `bytes`: every joint of its skins, the first skin naming one placing it, by its name as Three.js gives it, the nearest joint above it its parent, standing where its skin was bound to it; or why they cannot be read, such as a bone with no name, or two of the same.
 */
export const read = (bytes: Uint8Array): Result.Result<ReadonlyArray<Bone>, string> =>
  Result.flatMap(chunksOf(bytes), ({ json, bin }) =>
    Result.flatMap(
      Result.mapError(Schema.decodeUnknownResult(Gltf)(json), () => 'its JSON is no glTF'),
      (gltf) => {
        const nodes = gltf.nodes ?? [];
        const above = new Map<number, number>();
        nodes.forEach((node, index) => {
          for (const child of node.children ?? []) {
            above.set(child, index);
          }
        });
        const placed = new Map<number, Bone['at']>();
        for (const skin of gltf.skins ?? []) {
          const matrices =
            skin.inverseBindMatrices === undefined
              ? Result.succeed(skin.joints.map(() => []))
              : matricesOf(gltf, bin, skin.inverseBindMatrices);
          if (Result.isFailure(matrices)) {
            return Result.fail(matrices.failure);
          }
          skin.joints.forEach((joint, at) => {
            if (!placed.has(joint)) {
              placed.set(joint, boundAt(matrices.success[at] ?? []));
            }
          });
        }
        const nameOf = (index: number) => sanitized(nodes[index]?.name ?? '');
        const parentOf = (index: number): Option.Option<string> => {
          const parent = above.get(index);
          return parent === undefined
            ? Option.none()
            : placed.has(parent)
              ? Option.some(nameOf(parent))
              : parentOf(parent);
        };
        const bones = [...placed].map(([index, at]) => ({
          name: nameOf(index),
          parent: parentOf(index),
          at,
        }));
        const unnamed = bones.find(({ name }) => name === '');
        if (unnamed !== undefined) {
          return Result.fail('a bone of it has no name');
        }
        const twice = bones.find(
          ({ name }, at) => bones.findIndex((bone) => bone.name === name) !== at,
        );
        return twice === undefined
          ? Result.succeed(bones)
          : Result.fail(`two of its bones are named ${twice.name}`);
      },
    ),
  );

/** The source of the module that gives `bones`, read from the file `file`, as `Shape.Bones`. */
export const sourceOf = (file: string, bones: ReadonlyArray<Bone>): string => {
  const entries = bones.map(
    ({ name, parent, at }) =>
      `  ${JSON.stringify(name)}: { parent: ${Option.match(parent, {
        onNone: () => 'Option.none()',
        onSome: (above) => `Option.some(${JSON.stringify(above)})`,
      })}, at: { x: ${at.x}, y: ${at.y}, z: ${at.z} } },`,
  );
  return `import { Option } from 'effect';\n\n/** The bones of ${basename(file)} as it was made. */\nexport default {\n${entries.join('\n')}\n};\n`;
};

/** What the plugin is given while it loads a module, of whichever copy of Vite serves it: to watch the file it reads, so a change to it loads the module anew. */
export interface Loading {
  addWatchFile(file: string): void;
}

/** The parts of a Vite plugin this one has, typed by themselves, so a game whose Vite is another copy takes it as a plugin of its own. */
export interface Plugin {
  readonly name: string;
  readonly enforce: 'pre';
  load(this: Loading, id: string): string | undefined;
}

/**
 * The plugin that gives a module importing a model's file with `?bones` its bones; given to a game's Vite config, to its workers' (`worker.plugins`), which are built on their own, and so to its tests. It loads before Vite's own, which would give the file's URL instead. A file it cannot read fails the build, saying why.
 */
export const plugin = (): Plugin => ({
  name: 'lightocean:bones',
  enforce: 'pre',
  load(id) {
    if (!id.endsWith(QUERY)) {
      return undefined;
    }
    const file = id.slice(0, -QUERY.length);
    this.addWatchFile(file);
    const bones = Result.getOrThrowWith(
      read(readFileSync(file)),
      (reason) => new Error(`The bones of ${file} cannot be read: ${reason}.`),
    );
    return sourceOf(file, bones);
  },
});
