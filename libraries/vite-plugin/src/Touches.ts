import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Touch } from '@egonitida/core';
import { Result, Schema } from 'effect';
import type { Loading } from '#src/Bones.ts';
import { chunksOf, sanitized } from '#src/Bones.ts';

/**
 * A model's touch points, read from its file as the game is built: a module importing `./figure.glb?touches` is given them as `Touch.Touches`, every node named `touch-<part>` below a bone, with the radius and the way its surface faces its glTF `extras.touch` writes, where it stands and which way it faces in its bone's own frame, by the name of its part; the node's own rotation, which an exporter adds, turns nothing. A touch point below no bone, or written as none is, fails the build, saying why.
 */

/** What an import asks of a model's file to be given its touch points: `?touches`, among whatever other queries the development server adds to it. */
export const QUERY = 'touches';

/** What a node is named that is a touch point, before the name of its part. */
const PREFIX = 'touch-';

/** A touch point as read: the name of its part, and the point. */
export interface Read {
  readonly part: string;
  readonly point: Touch.Point;
}

const Written = Schema.Struct({
  radius: Schema.Finite,
  normal: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
});

/** The parts of a glTF's JSON its touch points are read from. */
const Gltf = Schema.Struct({
  nodes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        children: Schema.optional(Schema.Array(Schema.Int)),
        translation: Schema.optional(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])),
        extras: Schema.optional(Schema.Struct({ touch: Schema.optional(Schema.Unknown) })),
      }),
    ),
  ),
  skins: Schema.optional(Schema.Array(Schema.Struct({ joints: Schema.Array(Schema.Int) }))),
});

/**
 * The touch points of the binary glTF `bytes`: every node named `touch-<part>` whose parent is a bone, in the order of its nodes, standing where its translation puts it in its bone's frame, its surface facing as its extras write, in the bone's frame too; or why they cannot be read.
 */
export const read = (bytes: Uint8Array): Result.Result<ReadonlyArray<Read>, string> =>
  Result.flatMap(chunksOf(bytes), ({ json }) =>
    Result.flatMap(
      Result.mapError(Schema.decodeUnknownResult(Gltf)(json), () => 'its JSON is no glTF'),
      (gltf) => {
        const nodes = gltf.nodes ?? [];
        const bones = new Set((gltf.skins ?? []).flatMap(({ joints }) => joints));
        const above = new Map<number, number>();
        nodes.forEach((node, index) => {
          for (const child of node.children ?? []) {
            above.set(child, index);
          }
        });
        const read: Array<Read> = [];
        for (const [index, node] of nodes.entries()) {
          const name = node.name ?? '';
          if (!name.startsWith(PREFIX)) {
            continue;
          }
          const part = sanitized(name.slice(PREFIX.length));
          const parent = above.get(index);
          if (parent === undefined || !bones.has(parent)) {
            return Result.fail(`the touch point ${part} is below no bone`);
          }
          const written = Schema.decodeUnknownResult(Written)(node.extras?.touch);
          if (Result.isFailure(written)) {
            return Result.fail(`the touch point ${part} is not written as a touch point is`);
          }
          const [x = 0, y = 0, z = 0] = node.translation ?? [];
          // Written in the bone's frame; the node's own rotation, which an exporter adds, turns it not.
          const [nx, ny, nz] = written.success.normal;
          const long = Math.sqrt(nx * nx + ny * ny + nz * nz);
          const normal =
            long === 0 ? { x: nx, y: ny, z: nz } : { x: nx / long, y: ny / long, z: nz / long };
          read.push({
            part,
            point: {
              bone: sanitized(nodes[parent]?.name ?? ''),
              at: { x, y, z },
              radius: written.success.radius,
              normal,
            },
          });
        }
        return Result.succeed(read);
      },
    ),
  );

/** `point` as code. */
const pointCode = ({ x, y, z }: { x: number; y: number; z: number }) =>
  `{ x: ${x}, y: ${y}, z: ${z} }`;

/** The source of the module that gives `touches`, read from the file `file`, as `Touch.Touches`. */
export const sourceOf = (file: string, touches: ReadonlyArray<Read>): string =>
  `/** The touch points of ${basename(file)} as it was made. */\nexport default {\n${touches
    .map(
      ({ part, point }) =>
        `  ${JSON.stringify(part)}: { bone: ${JSON.stringify(point.bone)}, at: ${pointCode(point.at)}, radius: ${point.radius}, normal: ${pointCode(point.normal)} },`,
    )
    .join('\n')}\n};\n`;

/** The parts of a Vite plugin this one has, typed by themselves, so a game whose Vite is another copy takes it as a plugin of its own. */
export interface Plugin {
  readonly name: string;
  readonly enforce: 'pre';
  load(this: Loading, id: string): string | undefined;
}

/**
 * The plugin that gives a module importing a model's file with `?touches` its touch points; given to a game's Vite config, to its workers' (`worker.plugins`), and so to its tests. It loads before Vite's own, which would give the file's URL instead. A file it cannot read fails the build, saying why.
 */
export const plugin = (): Plugin => ({
  name: 'nitida:touches',
  enforce: 'pre',
  load(id) {
    const at = id.indexOf('?');
    if (at === -1 || !new URLSearchParams(id.slice(at + 1)).has(QUERY)) {
      return undefined;
    }
    const file = id.slice(0, at);
    this.addWatchFile(file);
    const touches = Result.getOrThrowWith(
      read(readFileSync(file)),
      (reason) => new Error(`The touch points of ${file} cannot be read: ${reason}.`),
    );
    return sourceOf(file, touches);
  },
});
