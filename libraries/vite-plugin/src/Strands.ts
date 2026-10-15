import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Strands } from '@egonitida/core';
import { Result, Schema } from 'effect';
import type { Loading } from '#src/Bones.ts';
import { chunksOf, sanitized } from '#src/Bones.ts';

/**
 * A model's hair as strands, read from its file as the game is built: a module importing `./figure.glb?strands` is given it as `Strands.Hair`. Her guides, the mesh `HairGuides`, are read whole: where each point stands as made, how wide and how stiff, one random number for each strand, and the bones that carry each point by their names. The strands drawn, the mesh `HairStrands`, are only counted, as the model counts them in the mesh's `extras.strands`, since a drawing reads their points from the model itself; how they are shaded is read from their material's `extras.hair`. Each strand is a polyline drawn as lines, as many points as every other, root first, those over the scalp before those down a ponytail. Every float is read as the shortest decimal that is the same float, so the module holds no digits the model does not. Hair the reader cannot make sense of fails the build, saying why.
 */

/** What an import asks of a model's file to be given its hair as strands: `?strands`, among whatever other queries the development server adds to it. */
export const QUERY = 'strands';

/** The meshes a model's hair is written in, as the model names them. */
const GUIDES = 'HairGuides';
const DRAWN = 'HairStrands';

/** How a mesh's strands are counted, as the model writes it in the mesh's extras. */
const Counted = Schema.Struct({
  points: Schema.Int,
  scalp: Schema.Int,
  ponytail: Schema.Int,
});

/** How hair is shaded, as the model writes it in its material's extras, its offset in degrees. */
const Written = Schema.Struct({
  model: Schema.String,
  melanin: Schema.Finite,
  melaninRedness: Schema.Finite,
  tint: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
  roughness: Schema.Finite,
  radialRoughness: Schema.Finite,
  coat: Schema.Finite,
  ior: Schema.Finite,
  offset: Schema.Finite,
  randomColor: Schema.Finite,
  randomRoughness: Schema.Finite,
});

/** The parts of a glTF's JSON its hair is read from. */
const Gltf = Schema.Struct({
  nodes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        mesh: Schema.optional(Schema.Int),
        skin: Schema.optional(Schema.Int),
      }),
    ),
  ),
  skins: Schema.optional(Schema.Array(Schema.Struct({ joints: Schema.Array(Schema.Int) }))),
  materials: Schema.optional(
    Schema.Array(
      Schema.Struct({
        extras: Schema.optional(Schema.Struct({ hair: Schema.optional(Schema.Unknown) })),
      }),
    ),
  ),
  meshes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        extras: Schema.optional(Schema.Struct({ strands: Schema.optional(Schema.Unknown) })),
        primitives: Schema.optional(
          Schema.Array(
            Schema.Struct({
              mode: Schema.optional(Schema.Int),
              material: Schema.optional(Schema.Int),
              attributes: Schema.Record(Schema.String, Schema.Int),
            }),
          ),
        ),
      }),
    ),
  ),
  accessors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        bufferView: Schema.optional(Schema.Int),
        byteOffset: Schema.optional(Schema.Int),
        componentType: Schema.Int,
        normalized: Schema.optional(Schema.Boolean),
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

/** How a primitive is drawn as lines, as glTF numbers its modes. */
const LINES = 1;

/** How many numbers each element of an accessor of `type` holds. */
const WIDTH: Readonly<Record<string, number>> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** How each component type glTF names is stored: how many bytes it takes, how it is read at a byte, and the most it holds, by which a normalized one is divided. */
const COMPONENTS: Readonly<
  Record<number, { bytes: number; read: (bin: DataView, at: number) => number; most: number }>
> = {
  5121: { bytes: 1, read: (bin, at) => bin.getUint8(at), most: 255 },
  5123: { bytes: 2, read: (bin, at) => bin.getUint16(at, true), most: 65535 },
  5126: { bytes: 4, read: (bin, at) => bin.getFloat32(at, true), most: 1 },
};

/** The float `value` as the shortest decimal that is the same float. */
const shortest = (value: number): number => {
  for (let digits = 1; digits < 9; digits++) {
    const decimal = Number(value.toPrecision(digits));
    if (Math.fround(decimal) === value) {
      return decimal;
    }
  }
  return Number(value.toPrecision(9));
};

/** The numbers of accessor `index` of `gltf`, every component of every element in turn, of `width` each, floats as their shortest decimals, or why they cannot be read; `what` names them in the reason. */
const numbersOf = (
  gltf: Gltf,
  bin: DataView,
  index: number | undefined,
  width: number,
  what: string,
): Result.Result<ReadonlyArray<number>, string> => {
  const accessor = index === undefined ? undefined : gltf.accessors?.[index];
  const view =
    accessor?.bufferView === undefined ? undefined : gltf.bufferViews?.[accessor.bufferView];
  const component = accessor === undefined ? undefined : COMPONENTS[accessor.componentType];
  if (accessor === undefined || view === undefined || component === undefined) {
    return Result.fail(`its ${what} are missing, or stored in no way glTF names`);
  }
  if (WIDTH[accessor.type] !== width) {
    return Result.fail(`its ${what} are not ${width} numbers each`);
  }
  const stride = view.byteStride ?? width * component.bytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (
    accessor.count > 0 &&
    start + stride * (accessor.count - 1) + width * component.bytes > bin.byteLength
  ) {
    return Result.fail(`its ${what} run past its binary chunk`);
  }
  const float = accessor.componentType === 5126;
  const normalized = accessor.normalized === true;
  const numbers: Array<number> = [];
  for (let element = 0; element < accessor.count; element++) {
    for (let at = 0; at < width; at++) {
      const value = component.read(bin, start + stride * element + at * component.bytes);
      numbers.push(float ? shortest(value) : normalized ? value / component.most : value);
    }
  }
  return Result.succeed(numbers);
};

/** The mesh named `name` of `gltf`, with its index, its one primitive, if it is drawn as lines, and how it counts its strands; or why it cannot be read. */
const meshOf = (gltf: Gltf, name: string) => {
  const found = [...(gltf.meshes ?? []).entries()].find(([, mesh]) => mesh.name === name);
  if (found === undefined) {
    return Result.fail(`it has no mesh named ${name}`);
  }
  const [index, mesh] = found;
  const [primitive] = mesh.primitives ?? [];
  if (primitive === undefined || (primitive.mode ?? 4) !== LINES) {
    return Result.fail(`its mesh ${name} is drawn as no lines`);
  }
  const counted = Schema.decodeUnknownResult(Counted)(mesh.extras?.strands);
  if (Result.isFailure(counted)) {
    return Result.fail(`its mesh ${name} counts its strands as the model does not write them`);
  }
  const { points, scalp, ponytail } = counted.success;
  const positions = primitive.attributes['POSITION'];
  const held = positions === undefined ? 0 : (gltf.accessors?.[positions]?.count ?? 0);
  if (points * (scalp + ponytail) !== held) {
    return Result.fail(
      `its mesh ${name} counts ${scalp + ponytail} strands of ${points} points, but holds ${held} points`,
    );
  }
  return Result.succeed({ index, primitive, counted: counted.success });
};

/**
 * The hair of the binary glTF `bytes` as strands: its guides read whole, the strands drawn counted, and how they are shaded; or why it cannot be read.
 */
export const read = (bytes: Uint8Array): Result.Result<Strands.Hair, string> =>
  Result.flatMap(chunksOf(bytes), ({ json, bin }) =>
    Result.flatMap(
      Result.mapError(Schema.decodeUnknownResult(Gltf)(json), () => 'its JSON is no glTF'),
      (gltf) =>
        Result.flatMap(meshOf(gltf, GUIDES), (guides) =>
          Result.flatMap(meshOf(gltf, DRAWN), (drawn) => {
            const { attributes } = guides.primitive;
            const read = (name: string, width: number, what: string) =>
              numbersOf(gltf, bin, attributes[name], width, `guides' ${what}`);
            const numbers = Result.all({
              at: read('POSITION', 3, 'points'),
              width: read('_WIDTH', 1, 'widths'),
              stiffness: read('_STIFFNESS', 1, 'stiffnesses'),
              random: read('_RANDOM', 1, 'random numbers'),
              joints: read('JOINTS_0', 4, 'bones'),
              weights: read('WEIGHTS_0', 4, 'weights'),
            });
            if (Result.isFailure(numbers)) {
              return Result.fail(numbers.failure);
            }
            const nodes = gltf.nodes ?? [];
            const skin = nodes.find((node) => node.mesh === guides.index)?.skin;
            const bones = ((skin === undefined ? undefined : gltf.skins?.[skin])?.joints ?? []).map(
              (node) => sanitized(nodes[node]?.name ?? ''),
            );
            const written = Schema.decodeUnknownResult(Written)(
              (drawn.primitive.material === undefined
                ? undefined
                : gltf.materials?.[drawn.primitive.material]
              )?.extras?.hair,
            );
            if (Result.isFailure(written)) {
              return Result.fail('its hair is shaded as the model does not write it');
            }
            const { model, offset, ...shading } = written.success;
            if (model !== 'chiang') {
              return Result.fail(
                `its hair is shaded by ${model}, which is no model the reader knows`,
              );
            }
            const { points, scalp, ponytail } = guides.counted;
            const { at, width, stiffness, random, joints, weights } = numbers.success;
            return Result.succeed({
              guides: {
                points,
                scalp,
                ponytail,
                at,
                width,
                stiffness,
                // One for each strand, as its root has it.
                random: Array.from(
                  { length: scalp + ponytail },
                  (_, strand) => random[strand * points] ?? 0,
                ),
                bones,
                joints,
                weights,
              },
              drawn: drawn.counted,
              shading: { ...shading, offset: (offset * Math.PI) / 180 },
            });
          }),
        ),
    ),
  );

/** The source of the module that gives `hair`, read from the file `file`, as `Strands.Hair`. */
export const sourceOf = (file: string, hair: Strands.Hair): string =>
  `/** The hair of ${basename(file)} as strands: its guides, the strands it draws, and how they are shaded. */\nexport default ${JSON.stringify(hair)};\n`;

/** The parts of a Vite plugin this one has, typed by themselves, so a game whose Vite is another copy takes it as a plugin of its own. */
export interface Plugin {
  readonly name: string;
  readonly enforce: 'pre';
  load(this: Loading, id: string): string | undefined;
}

/**
 * The plugin that gives a module importing a model's file with `?strands` its hair as strands; given to a game's Vite config, to its workers' (`worker.plugins`), which are built on their own, and so to its tests. It loads before Vite's own, which would give the file's URL instead. A file it cannot read fails the build, saying why.
 */
export const plugin = (): Plugin => ({
  name: 'egonitida:strands',
  enforce: 'pre',
  load(id) {
    const at = id.indexOf('?');
    if (at === -1 || !new URLSearchParams(id.slice(at + 1)).has(QUERY)) {
      return undefined;
    }
    const file = id.slice(0, at);
    this.addWatchFile(file);
    const hair = Result.getOrThrowWith(
      read(readFileSync(file)),
      (reason) => new Error(`The strands of ${file} cannot be read: ${reason}.`),
    );
    return sourceOf(file, hair);
  },
});
