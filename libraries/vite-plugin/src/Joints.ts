import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Joint } from '@egonitida/core';
import { Option, Result, Schema } from 'effect';
import type { Loading } from '#src/Bones.ts';
import { chunksOf, sanitized } from '#src/Bones.ts';

/**
 * A model's joints, read from its file as the game is built: a module importing `./figure.glb?joints` is given them as `Joint.Joints`, each bone that carries a joint in its glTF `extras.joint` by its name, with the flesh about it from its `extras.flesh`, so a step reads the figure's anatomy from the model itself, never copied out of it. A joint's motions are named as the model names them, each about an axis in the bone's own frame, oblique or not, turned in the order it writes. Angles are written in degrees and read as radians; axes are brought to length one. A joint the reader cannot make sense of fails the build, saying why: a kind it does not know, a motion about no axis or ranging the wrong way, an order that is not every motion once, or a limit, a follower, or a measure that names what is not there.
 */

/** What an import asks of a model's file to be given its joints: `?joints`, among whatever other queries the development server adds to it. */
export const QUERY = 'joints';

/** A bone's joint as read: the bone's name and its joint. */
export interface Read {
  readonly name: string;
  readonly joint: Joint.Joint;
}

const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
const Pair = Schema.Tuple([Schema.Finite, Schema.Finite]);
const Rows = Schema.Array(Pair);

/** A joint as a model's file writes it, in degrees. */
const Written = Schema.Struct({
  kind: Schema.String,
  motions: Schema.Record(
    Schema.String,
    Schema.Struct({ axis: Vector, range: Pair, rest: Schema.optional(Schema.Finite) }),
  ),
  order: Schema.Array(Schema.String),
  depends: Schema.optional(
    Schema.Array(Schema.Struct({ limit: Schema.String, on: Schema.String, table: Rows })),
  ),
  follows: Schema.optional(
    Schema.Array(Schema.Struct({ motion: Schema.String, on: Schema.String, table: Rows })),
  ),
  measures: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        from: Schema.String,
        direction: Vector,
        rest: Schema.optional(Schema.Finite),
      }),
    ),
  ),
});
type Written = typeof Written.Type;

const Flesh = Schema.Struct({ radius: Schema.Finite, length: Schema.Finite, mass: Schema.Finite });

/** The parts of a glTF's JSON its joints are read from. */
const Gltf = Schema.Struct({
  nodes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        extras: Schema.optional(
          Schema.Struct({
            joint: Schema.optional(Schema.Unknown),
            flesh: Schema.optional(Schema.Unknown),
          }),
        ),
      }),
    ),
  ),
  skins: Schema.optional(Schema.Array(Schema.Struct({ joints: Schema.Array(Schema.Int) }))),
});

const KINDS: Readonly<Record<string, Joint.Kind>> = {
  ball: 'Ball',
  hinge: 'Hinge',
  saddle: 'Saddle',
  follower: 'Follower',
  chain: 'Chain',
  free: 'Free',
};

/** Degrees, as radians. */
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** A table of degrees, in radians. */
const tableOf = (rows: ReadonlyArray<readonly [number, number]>): Joint.Table =>
  rows.map(([x, y]) => [radians(x), radians(y)] as const);

/** `[x, y, z]` brought to length one; none, if it has no length. */
const unit = ([x, y, z]: readonly [number, number, number]) => {
  const length = Math.sqrt(x * x + y * y + z * z);
  return length === 0
    ? Option.none()
    : Option.some({ x: x / length, y: y / length, z: z / length });
};

/** `first` and `second` of `written`, `first.second`, split at its last dot; none for anything else. */
const dotted = (written: string): Option.Option<{ first: string; second: string }> => {
  const at = written.lastIndexOf('.');
  return at <= 0 || at === written.length - 1
    ? Option.none()
    : Option.some({ first: written.slice(0, at), second: written.slice(at + 1) });
};

/** The joint of the bone `name` as `written`, its references not yet checked, or why it cannot be read. */
const jointOf = (
  name: string,
  written: Written,
): Result.Result<Omit<Joint.Joint, 'flesh'>, string> => {
  const kind = KINDS[written.kind];
  if (kind === undefined) {
    return Result.fail(`the joint of ${name} is of no kind a joint is: ${written.kind}`);
  }
  const motions: Record<string, Joint.Motion> = {};
  for (const [motion, { axis, range, rest }] of Object.entries(written.motions)) {
    const direction = unit(axis);
    if (Option.isNone(direction)) {
      return Result.fail(`the motion ${motion} of ${name} turns about no axis`);
    }
    if (range[0] > range[1]) {
      return Result.fail(`the motion ${motion} of ${name} ranges from more than it ranges to`);
    }
    motions[motion] = {
      axis: direction.value,
      range: [radians(range[0]), radians(range[1])],
      rest: radians(rest ?? 0),
    };
  }
  const names = Object.keys(motions);
  if (
    written.order.length !== names.length ||
    new Set(written.order).size !== names.length ||
    written.order.some((motion) => motions[motion] === undefined)
  ) {
    return Result.fail(`the order of ${name} is not every motion of it once`);
  }
  const depends: Array<Joint.Depends> = [];
  for (const { limit, on, table } of written.depends ?? []) {
    const bound = dotted(limit);
    const source = dotted(on);
    if (
      Option.isNone(bound) ||
      motions[bound.value.first] === undefined ||
      (bound.value.second !== 'min' && bound.value.second !== 'max')
    ) {
      return Result.fail(`${name} limits ${limit}, which is no end of a motion of it`);
    }
    if (Option.isNone(source)) {
      return Result.fail(`${name} depends on ${on}, which is no motion of a joint`);
    }
    depends.push({
      motion: bound.value.first,
      end: bound.value.second,
      on: { bone: source.value.first, motion: source.value.second },
      table: tableOf(table),
    });
  }
  const follows: Array<Joint.Follows> = [];
  for (const { motion, on, table } of written.follows ?? []) {
    const source = dotted(on);
    if (motions[motion] === undefined) {
      return Result.fail(`${name} follows by ${motion}, which is no motion of it`);
    }
    if (Option.isNone(source)) {
      return Result.fail(`${name} follows ${on}, which is no motion or measure of a joint`);
    }
    follows.push({
      motion,
      on: { bone: source.value.first, motion: source.value.second },
      table: tableOf(table),
    });
  }
  const measures: Record<string, Joint.Measure> = {};
  for (const [measure, { from, direction, rest }] of Object.entries(written.measures ?? {})) {
    const way = unit(direction);
    if (Option.isNone(way)) {
      return Result.fail(`the measure ${measure} of ${name} is toward no direction`);
    }
    measures[measure] = { from, direction: way.value, rest: radians(rest ?? 0) };
  }
  return Result.succeed({ kind, motions, order: written.order, depends, follows, measures });
};

/** Why what the joints of `read` name is not there among them and `bones`, if anything they name is not. */
const missing = (read: ReadonlyArray<Read>, bones: ReadonlySet<string>): Option.Option<string> => {
  const joints = new Map(read.map(({ name, joint }) => [name, joint]));
  for (const { name, joint } of read) {
    for (const { on } of joint.depends) {
      if (joints.get(on.bone)?.motions[on.motion] === undefined) {
        return Option.some(
          `${name} depends on ${on.bone}.${on.motion}, which is no motion of a joint`,
        );
      }
    }
    for (const { on } of joint.follows) {
      const source = joints.get(on.bone);
      if (source?.motions[on.motion] === undefined && source?.measures[on.motion] === undefined) {
        return Option.some(
          `${name} follows ${on.bone}.${on.motion}, which is no motion or measure of a joint`,
        );
      }
    }
    for (const [measure, { from }] of Object.entries(joint.measures)) {
      if (!bones.has(from)) {
        return Option.some(`the measure ${measure} of ${name} is from ${from}, which is no bone`);
      }
    }
  }
  return Option.none();
};

/**
 * The joints of the binary glTF `bytes`: every joint of its skins that carries a joint in its extras, in the order of its nodes, by its name as Three.js gives it, with the flesh its extras carry; or why they cannot be read.
 */
export const read = (bytes: Uint8Array): Result.Result<ReadonlyArray<Read>, string> =>
  Result.flatMap(chunksOf(bytes), ({ json }) =>
    Result.flatMap(
      Result.mapError(Schema.decodeUnknownResult(Gltf)(json), () => 'its JSON is no glTF'),
      (gltf) => {
        const nodes = gltf.nodes ?? [];
        const skinned = new Set((gltf.skins ?? []).flatMap(({ joints }) => joints));
        const bones = new Set([...skinned].map((index) => sanitized(nodes[index]?.name ?? '')));
        const read: Array<Read> = [];
        for (const [index, node] of nodes.entries()) {
          const carried = node.extras?.joint;
          if (!skinned.has(index) || carried === undefined) {
            continue;
          }
          const name = sanitized(node.name ?? '');
          const written = Schema.decodeUnknownResult(Written)(carried);
          if (Result.isFailure(written)) {
            return Result.fail(`the joint of ${name} is not written as a joint is`);
          }
          const flesh = Option.map(Option.fromNullishOr(node.extras?.flesh), (carriedFlesh) =>
            Schema.decodeUnknownResult(Flesh)(carriedFlesh),
          );
          if (Option.isSome(flesh) && Result.isFailure(flesh.value)) {
            return Result.fail(`the flesh of ${name} is not written as flesh is`);
          }
          const joint = jointOf(name, written.success);
          if (Result.isFailure(joint)) {
            return Result.fail(joint.failure);
          }
          read.push({
            name,
            joint: { ...joint.success, flesh: Option.flatMap(flesh, Result.getSuccess) },
          });
        }
        return Option.match(missing(read, bones), {
          onNone: () => Result.succeed(read),
          onSome: Result.fail,
        });
      },
    ),
  );

/** `joint` as code: what it is as JSON, and its flesh, an Option. */
const jointCode = ({ flesh, ...joint }: Joint.Joint) =>
  `{ ...${JSON.stringify(joint)}, flesh: ${Option.match(flesh, {
    onNone: () => 'Option.none()',
    onSome: (value) => `Option.some(${JSON.stringify(value)})`,
  })} }`;

/** The source of the module that gives `joints`, read from the file `file`, as `Joint.Joints`. */
export const sourceOf = (file: string, joints: ReadonlyArray<Read>): string =>
  `import { Option } from 'effect';\n\n/** The joints of ${basename(file)} as it was made. */\nexport default {\n${joints
    .map(({ name, joint }) => `  ${JSON.stringify(name)}: ${jointCode(joint)},`)
    .join('\n')}\n};\n`;

/** The parts of a Vite plugin this one has, typed by themselves, so a game whose Vite is another copy takes it as a plugin of its own. */
export interface Plugin {
  readonly name: string;
  readonly enforce: 'pre';
  load(this: Loading, id: string): string | undefined;
}

/**
 * The plugin that gives a module importing a model's file with `?joints` its joints; given to a game's Vite config, to its workers' (`worker.plugins`), which are built on their own, and so to its tests. It loads before Vite's own, which would give the file's URL instead. A file it cannot read fails the build, saying why.
 */
export const plugin = (): Plugin => ({
  name: 'nitida:joints',
  enforce: 'pre',
  load(id) {
    const at = id.indexOf('?');
    if (at === -1 || !new URLSearchParams(id.slice(at + 1)).has(QUERY)) {
      return undefined;
    }
    const file = id.slice(0, at);
    this.addWatchFile(file);
    const joints = Result.getOrThrowWith(
      read(readFileSync(file)),
      (reason) => new Error(`The joints of ${file} cannot be read: ${reason}.`),
    );
    return sourceOf(file, joints);
  },
});
