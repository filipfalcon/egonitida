import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { type Clip, type Joint, Pose, Quaternion } from '@lightocean/core';
import { Option, Result, Schema } from 'effect';
import * as Bones from '#src/Bones.ts';
import * as Joints from '#src/Joints.ts';

/**
 * A model's clips as poses, read from its file as the game is built: a module importing `./figure.glb?clips` is given them as `Clip.Clips`, each animation by its name, sampled on its keys, so a step reads a trick authored as a clip as surely as a view draws it. At each key, each bone that carries a joint is read as the joint's angles, its turn taken from how it was made; the topmost joint moved, such as a pelvis bobbing as she walks, and the bones above it moved or turned, stand the whole figure elsewhere. A bone that carries no joint is left out. A clip it cannot read, its keys not floats or sampled in a way glTF does not name, fails the build, saying why.
 */

/** What an import asks of a model's file to be given its clips: `?clips`, among whatever other queries the development server adds to it. */
export const QUERY = 'clips';

const Gltf = Schema.Struct({
  nodes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        children: Schema.optional(Schema.Array(Schema.Int)),
        translation: Schema.optional(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])),
        rotation: Schema.optional(
          Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
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
  animations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        samplers: Schema.Array(
          Schema.Struct({
            input: Schema.Int,
            output: Schema.Int,
            interpolation: Schema.optional(Schema.String),
          }),
        ),
        channels: Schema.Array(
          Schema.Struct({
            sampler: Schema.Int,
            target: Schema.Struct({ node: Schema.optional(Schema.Int), path: Schema.String }),
          }),
        ),
      }),
    ),
  ),
});
type Gltf = typeof Gltf.Type;

/** How many numbers each element of an accessor of `type` holds. */
const WIDTH: Readonly<Record<string, number>> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** A float, as an accessor's component type says. */
const FLOAT = 5126;

/** The elements of accessor `index` of `gltf`, each as many floats as its type holds, or why they cannot be read. */
const floatsOf = (
  gltf: Gltf,
  bin: DataView,
  index: number,
): Result.Result<ReadonlyArray<ReadonlyArray<number>>, string> => {
  const accessor = gltf.accessors?.[index];
  const view =
    accessor?.bufferView === undefined ? undefined : gltf.bufferViews?.[accessor.bufferView];
  const width = accessor === undefined ? undefined : WIDTH[accessor.type];
  if (accessor === undefined || view === undefined || width === undefined) {
    return Result.fail(`its accessor ${index} is missing, or of no type a clip has`);
  }
  if (accessor.componentType !== FLOAT) {
    return Result.fail(`its accessor ${index} holds no floats`);
  }
  const stride = view.byteStride ?? width * 4;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (start + stride * (accessor.count - 1) + width * 4 > bin.byteLength) {
    return Result.fail(`its accessor ${index} runs past its binary chunk`);
  }
  return Result.succeed(
    Array.from({ length: accessor.count }, (_, element) =>
      Array.from({ length: width }, (_, at) =>
        bin.getFloat32(start + stride * element + at * 4, true),
      ),
    ),
  );
};

/** A channel of a clip, read: the node it moves, what of it, how its keys are sampled between, its keys' times, and its values at them. */
interface Channel {
  readonly node: number;
  readonly path: 'rotation' | 'translation';
  readonly step: boolean;
  readonly times: ReadonlyArray<number>;
  readonly values: ReadonlyArray<ReadonlyArray<number>>;
}

/** What `channel` holds `seconds` in: between its keys about it, along the line between them, or along their turns for a rotation; its key before for a channel that steps. */
const sampled = (channel: Channel, seconds: number): ReadonlyArray<number> => {
  const { times, values } = channel;
  const last = values[values.length - 1] ?? [];
  for (let key = 0; key < times.length; key++) {
    const at = times[key] ?? 0;
    if (seconds <= at) {
      const after = values[key] ?? last;
      const from = times[key - 1];
      const before = values[key - 1];
      if (key === 0 || from === undefined || before === undefined || channel.step) {
        return channel.step && before !== undefined && seconds < at ? before : after;
      }
      const t = at === from ? 1 : (seconds - from) / (at - from);
      if (channel.path === 'rotation') {
        const [ax = 0, ay = 0, az = 0, aw = 1] = before;
        const [bx = 0, by = 0, bz = 0, bw = 1] = after;
        const { x, y, z, w } = Quaternion.slerp(
          { x: ax, y: ay, z: az, w: aw },
          { x: bx, y: by, z: bz, w: bw },
          t,
        );
        return [x, y, z, w];
      }
      return before.map((value, at) => value + ((after[at] ?? value) - value) * t);
    }
  }
  return last;
};

/** A quaternion as glTF writes one. */
const quaternionOf = ([
  x = 0,
  y = 0,
  z = 0,
  w = 1,
]: ReadonlyArray<number>): Quaternion.Quaternion => ({
  x,
  y,
  z,
  w,
});

/**
 * The clips of the binary glTF `bytes`, by their names: each sampled on every key of its channels, the joints' angles and where the whole figure stands at each; or why they cannot be read.
 */
export const read = (bytes: Uint8Array): Result.Result<Clip.Clips, string> =>
  Result.flatMap(Bones.chunksOf(bytes), ({ json, bin }) =>
    Result.flatMap(
      Result.mapError(Schema.decodeUnknownResult(Gltf)(json), () => 'its JSON is no glTF'),
      (gltf) =>
        Result.flatMap(Bones.read(bytes), (readBones) =>
          Result.flatMap(Joints.read(bytes), (readJoints) => {
            const nodes = gltf.nodes ?? [];
            const bones = new Map(readBones.map((bone) => [bone.name, bone]));
            const joints: Joint.Joints = Object.fromEntries(
              readJoints.map(({ name, joint }) => [name, joint]),
            );
            // What each node's parent is, and how each node is turned in the model as made, from the nodes alone, for the nodes above the bones.
            const above = new Map<number, number>();
            nodes.forEach((node, index) => {
              for (const child of node.children ?? []) {
                above.set(child, index);
              }
            });
            const turnOfNode = (index: number): Quaternion.Quaternion => {
              const parent = above.get(index);
              const own = quaternionOf(nodes[index]?.rotation ?? []);
              return parent === undefined ? own : Quaternion.multiply(turnOfNode(parent), own);
            };
            const nameOf = (index: number) => Bones.sanitized(nodes[index]?.name ?? '');
            /** How the bone `name` was made, from its parent: turned, and where it stood, in its parent's own frame. */
            const madeLocal = (index: number) => {
              const bone = bones.get(nameOf(index));
              if (bone === undefined) {
                return Option.none();
              }
              const parent = Option.flatMap(bone.parent, (name) =>
                Option.fromNullishOr(bones.get(name)),
              );
              const parentTurn = Option.match(parent, {
                onNone: () => {
                  const node = above.get(index);
                  return node === undefined ? Quaternion.identity : turnOfNode(node);
                },
                onSome: ({ turn }) => turn,
              });
              const parentAt = Option.match(parent, {
                onNone: () => ({ x: 0, y: 0, z: 0 }),
                onSome: ({ at }) => at,
              });
              const back = Quaternion.invert(parentTurn);
              return Option.some({
                bone,
                parentTurn,
                turn: Quaternion.multiply(back, bone.turn),
                at: Quaternion.rotate(back, {
                  x: bone.at.x - parentAt.x,
                  y: bone.at.y - parentAt.y,
                  z: bone.at.z - parentAt.z,
                }),
              });
            };
            /** Whether no bone above the bone `name` carries a joint. */
            const topmost = (name: string): boolean => {
              const bone = bones.get(name);
              const parent = bone === undefined ? undefined : Option.getOrUndefined(bone.parent);
              return parent === undefined || (joints[parent] === undefined && topmost(parent));
            };
            const clips: Record<string, Clip.Clip> = {};
            for (const [at, animation] of (gltf.animations ?? []).entries()) {
              const name = animation.name ?? `clip ${at}`;
              const channels: Array<Channel> = [];
              for (const { sampler, target } of animation.channels) {
                const used = animation.samplers[sampler];
                if (
                  target.node === undefined ||
                  used === undefined ||
                  (target.path !== 'rotation' && target.path !== 'translation')
                ) {
                  continue;
                }
                const interpolation = used.interpolation ?? 'LINEAR';
                if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation)) {
                  return Result.fail(
                    `its clip ${name} samples its keys ${interpolation}, which glTF does not name`,
                  );
                }
                const times = floatsOf(gltf, bin, used.input);
                const values = floatsOf(gltf, bin, used.output);
                if (Result.isFailure(times)) {
                  return Result.fail(times.failure);
                }
                if (Result.isFailure(values)) {
                  return Result.fail(values.failure);
                }
                channels.push({
                  node: target.node,
                  path: target.path,
                  step: interpolation === 'STEP',
                  times: times.success.map(([time = 0]) => time),
                  // A cubic spline's keys hold their tangents about each value: the value alone is kept.
                  values:
                    interpolation === 'CUBICSPLINE'
                      ? values.success.filter((_, element) => element % 3 === 1)
                      : values.success,
                });
              }
              const keys = [...new Set(channels.flatMap(({ times }) => times))].sort(
                (a, b) => a - b,
              );
              const poses = keys.map((seconds): Pose.Pose => {
                const turns: Record<string, Joint.Angles> = {};
                let figureAt = { x: 0, y: 0, z: 0 };
                let figureTurn = Quaternion.identity;
                for (const channel of channels) {
                  const bone = nameOf(channel.node);
                  const joint = joints[bone];
                  const made = madeLocal(channel.node);
                  if (Option.isNone(made)) {
                    continue;
                  }
                  const value = sampled(channel, seconds);
                  if (channel.path === 'rotation' && joint !== undefined) {
                    turns[bone] = Pose.anglesOf(
                      joint,
                      Quaternion.multiply(Quaternion.invert(made.value.turn), quaternionOf(value)),
                    );
                  } else if (topmost(bone) && channel.path === 'translation') {
                    // Moved from where it was made, in the model's space: the whole figure, with it.
                    const [x = 0, y = 0, z = 0] = value;
                    const moved = Quaternion.rotate(made.value.parentTurn, {
                      x: x - made.value.at.x,
                      y: y - made.value.at.y,
                      z: z - made.value.at.z,
                    });
                    figureAt = {
                      x: figureAt.x + moved.x,
                      y: figureAt.y + moved.y,
                      z: figureAt.z + moved.z,
                    };
                  } else if (topmost(bone) && joint === undefined) {
                    // A bone above every joint turned: the whole figure, with it, by how far it turned in the model's space.
                    const { parentTurn, turn } = made.value;
                    const turned = Quaternion.multiply(
                      Quaternion.multiply(parentTurn, quaternionOf(value)),
                      Quaternion.multiply(Quaternion.invert(turn), Quaternion.invert(parentTurn)),
                    );
                    figureTurn = Quaternion.multiply(turned, figureTurn);
                  }
                }
                return { at: figureAt, turn: figureTurn, turns };
              });
              clips[name] = {
                duration: keys[keys.length - 1] ?? 0,
                times: keys,
                poses,
              };
            }
            return Result.succeed(clips);
          }),
        ),
    ),
  );

/** The source of the module that gives `clips`, read from the file `file`, as `Clip.Clips`. */
export const sourceOf = (file: string, clips: Clip.Clips): string =>
  `/** The clips of ${basename(file)} as poses, sampled on their keys. */\nexport default ${JSON.stringify(clips)};\n`;

/** The parts of a Vite plugin this one has, typed by themselves, so a game whose Vite is another copy takes it as a plugin of its own. */
export interface Plugin {
  readonly name: string;
  readonly enforce: 'pre';
  load(this: Bones.Loading, id: string): string | undefined;
}

/**
 * The plugin that gives a module importing a model's file with `?clips` its clips as poses; given to a game's Vite config, to its workers' (`worker.plugins`), and so to its tests. It loads before Vite's own, which would give the file's URL instead. A file it cannot read fails the build, saying why.
 */
export const plugin = (): Plugin => ({
  name: 'lightocean:clips',
  enforce: 'pre',
  load(id) {
    const at = id.indexOf('?');
    if (at === -1 || !new URLSearchParams(id.slice(at + 1)).has(QUERY)) {
      return undefined;
    }
    const file = id.slice(0, at);
    this.addWatchFile(file);
    const clips = Result.getOrThrowWith(
      read(readFileSync(file)),
      (reason) => new Error(`The clips of ${file} cannot be read: ${reason}.`),
    );
    return sourceOf(file, clips);
  },
});
