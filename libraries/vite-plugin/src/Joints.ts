import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Joint } from '@lightocean/core';
import { Option, Result, Schema } from 'effect';
import type { Loading } from '#src/Bones.ts';
import { chunksOf, sanitized } from '#src/Bones.ts';

/**
 * A model's joints, read from its file as the game is built: a module importing `./figure.glb?joints` is given them as `Joint.Joints`, each bone that carries a joint in its glTF `extras.joint` by its name, with the flesh about it from its `extras.flesh`, so a step reads the figure's anatomy from the model itself, never copied out of it. Angles are written in degrees and read as radians; axes, in the bone's own frame, are brought to length one. A joint the reader cannot make sense of fails the build, saying why: a kind it does not know, axes that are not square to one another, a hinge that abducts, a range the wrong way round, or what it depends on or follows that is no joint, or no axis of one.
 */

/** What an import asks of a model's file to be given its joints: `?joints`, among whatever other queries the development server adds to it. */
export const QUERY = 'joints';

/** A bone's joint as read: the bone's name and its joint. */
export interface Read {
  readonly name: string;
  readonly joint: Joint.Joint;
}

const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
const Range = Schema.Tuple([Schema.Finite, Schema.Finite]);
const Rows = Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite]));

/** A joint as a model's file writes it, in degrees. */
const Written = Schema.Struct({
  kind: Schema.String,
  axes: Schema.Struct({
    flex: Vector,
    abduct: Schema.optional(Vector),
    twist: Schema.optional(Vector),
  }),
  swing: Schema.Struct({ flex: Range, abduct: Schema.optional(Range) }),
  twist: Schema.optional(Schema.NullOr(Range)),
  depends: Schema.optional(
    Schema.Array(Schema.Struct({ limit: Schema.String, on: Schema.String, table: Rows })),
  ),
  follows: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        joint: Schema.String,
        axis: Schema.String,
        sets: Schema.optional(Schema.String),
        table: Rows,
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
  hinge: 'Hinge',
  saddle: 'Saddle',
  ball: 'Ball',
};
const AXES: ReadonlyArray<Joint.Axis> = ['flex', 'abduct', 'twist'];

/** Whether `name` is one of a joint's axes. */
const isAxis = (name: string): name is Joint.Axis => AXES.some((axis) => axis === name);

/** Degrees, as radians. */
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** A range in degrees, in radians. */
const rangeOf = ([min, max]: readonly [number, number]): Joint.Range => [
  radians(min),
  radians(max),
];

/** A table of degrees, in radians. */
const tableOf = (rows: ReadonlyArray<readonly [number, number]>): Joint.Table =>
  rows.map(([x, y]) => [radians(x), radians(y)] as const);

/** `[x, y, z]` brought to length one; as it is, if it has none. */
const unit = ([x, y, z]: readonly [number, number, number]) => {
  const length = Math.sqrt(x * x + y * y + z * z);
  return length === 0 ? { x, y, z } : { x: x / length, y: y / length, z: z / length };
};

/** Whether two directions of length one are square to one another, within a thousandth. */
const square = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.abs(a.x * b.x + a.y * b.y + a.z * b.z) <= 1e-3;

/** `joint` and `axis` of `written`, `joint.axis`; none for anything else. */
const jointAxis = (written: string): Option.Option<{ joint: string; axis: string }> => {
  const at = written.lastIndexOf('.');
  return at <= 0
    ? Option.none()
    : Option.some({ joint: written.slice(0, at), axis: written.slice(at + 1) });
};

/** The joint of the bone `name` as `written`, or why it cannot be read. */
const jointOf = (
  name: string,
  written: Written,
): Result.Result<Omit<Joint.Joint, 'flesh'>, string> => {
  const of = `the joint of ${name}`;
  const kind = KINDS[written.kind];
  if (kind === undefined) {
    return Result.fail(`${of} is no hinge, saddle, or ball as written`);
  }
  const flex = unit(written.axes.flex);
  const abduct = Option.map(Option.fromNullishOr(written.axes.abduct), unit);
  const twist = Option.map(Option.fromNullishOr(written.axes.twist), unit);
  const axes = [flex, ...Option.toArray(abduct), ...Option.toArray(twist)];
  if (axes.some((a, at) => axes.some((b, other) => other > at && !square(a, b)))) {
    return Result.fail(`the axes of ${of} are not square to one another`);
  }
  const abductRange = Option.fromNullishOr(written.swing.abduct);
  if (kind === 'Hinge' && (Option.isSome(abduct) || Option.isSome(abductRange))) {
    return Result.fail(`${of} is a hinge, which swings one way, yet abducts`);
  }
  if (kind !== 'Hinge' && (Option.isNone(abduct) || Option.isNone(abductRange))) {
    return Result.fail(
      `${of} is a ${written.kind}, which swings two ways, yet has no abduction axis or range`,
    );
  }
  const twistRange = Option.fromNullishOr(written.twist);
  if (Option.isSome(twistRange) && Option.isNone(twist)) {
    return Result.fail(`${of} twists, yet has no axis to twist about`);
  }
  if (kind === 'Ball' && Option.isNone(twistRange)) {
    return Result.fail(`${of} is a ball, which twists, yet has no twist range`);
  }
  const ranges: ReadonlyArray<readonly [string, Option.Option<readonly [number, number]>]> = [
    ['bends', Option.some(written.swing.flex)],
    ['abducts', abductRange],
    ['twists', twistRange],
  ];
  const backwards = ranges.find(([, range]) => Option.exists(range, ([min, max]) => min > max));
  if (backwards !== undefined) {
    return Result.fail(`${of} ${backwards[0]} from more than it ${backwards[0]} to`);
  }
  const depends: Array<Joint.Depends> = [];
  for (const { limit, on, table } of written.depends ?? []) {
    const [axis, end] = limit.split('.');
    const by = jointAxis(on);
    if (axis === undefined || !isAxis(axis) || (end !== 'min' && end !== 'max')) {
      return Result.fail(`${of} has a limit ${limit}, which is no axis's least or most`);
    }
    if (Option.isNone(by) || !isAxis(by.value.axis)) {
      return Result.fail(`${of} depends on ${on}, which is no axis of a joint`);
    }
    depends.push({
      limit: { axis, end },
      on: { joint: by.value.joint, axis: by.value.axis },
      table: tableOf(table),
    });
  }
  const follows = Option.fromNullishOr(written.follows);
  if (Option.isSome(follows)) {
    const { joint, axis, sets } = follows.value;
    if (!isAxis(axis)) {
      return Result.fail(`${of} follows ${axis} of ${joint}, which is no axis of a joint`);
    }
    if (sets !== undefined && !isAxis(sets)) {
      return Result.fail(`${of} sets ${sets} as it follows, which is no axis of a joint`);
    }
  }
  return Result.succeed({
    kind,
    axes: { flex, abduct, twist },
    swing: { flex: rangeOf(written.swing.flex), abduct: Option.map(abductRange, rangeOf) },
    twist: Option.map(twistRange, rangeOf),
    depends,
    follows: Option.flatMap(follows, ({ joint, axis, sets, table }) =>
      isAxis(axis)
        ? Option.some({
            joint,
            axis,
            sets: sets !== undefined && isAxis(sets) ? sets : axis,
            table: tableOf(table),
          })
        : Option.none(),
    ),
  });
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
          const flesh = Option.fromNullishOr(node.extras?.flesh);
          const fleshRead = Option.map(flesh, (carriedFlesh) =>
            Schema.decodeUnknownResult(Flesh)(carriedFlesh),
          );
          if (Option.isSome(fleshRead) && Result.isFailure(fleshRead.value)) {
            return Result.fail(`the flesh of ${name} is not written as flesh is`);
          }
          const joint = jointOf(name, written.success);
          if (Result.isFailure(joint)) {
            return Result.fail(joint.failure);
          }
          read.push({
            name,
            joint: {
              ...joint.success,
              flesh: Option.flatMap(fleshRead, (result) => Result.getSuccess(result)),
            },
          });
        }
        const names = new Set(read.map(({ name }) => name));
        for (const { name, joint } of read) {
          const absent = [
            ...joint.depends.map(({ on }) => on.joint),
            ...Option.toArray(Option.map(joint.follows, ({ joint: followed }) => followed)),
          ].find((other) => !names.has(other));
          if (absent !== undefined) {
            return Result.fail(`the joint of ${name} depends on ${absent}, which is no joint`);
          }
        }
        return Result.succeed(read);
      },
    ),
  );

/** `point` as code. */
const pointCode = ({ x, y, z }: { x: number; y: number; z: number }) =>
  `{ x: ${x}, y: ${y}, z: ${z} }`;

/** `option` as code, what it holds as `code` writes it. */
const optionCode = <A>(option: Option.Option<A>, code: (value: A) => string) =>
  Option.match(option, {
    onNone: () => 'Option.none()',
    onSome: (value) => `Option.some(${code(value)})`,
  });

/** A pair of numbers as code. */
const pairCode = ([a, b]: readonly [number, number]) => `[${a}, ${b}]`;

/** A table as code. */
const tableCode = (table: Joint.Table) => `[${table.map(pairCode).join(', ')}]`;

/** `joint` as code. */
const jointCode = (joint: Joint.Joint) =>
  [
    '{',
    `kind: '${joint.kind}',`,
    `axes: { flex: ${pointCode(joint.axes.flex)}, abduct: ${optionCode(joint.axes.abduct, pointCode)}, twist: ${optionCode(joint.axes.twist, pointCode)} },`,
    `swing: { flex: ${pairCode(joint.swing.flex)}, abduct: ${optionCode(joint.swing.abduct, pairCode)} },`,
    `twist: ${optionCode(joint.twist, pairCode)},`,
    `depends: [${joint.depends
      .map(
        ({ limit, on, table }) =>
          `{ limit: { axis: '${limit.axis}', end: '${limit.end}' }, on: { joint: ${JSON.stringify(on.joint)}, axis: '${on.axis}' }, table: ${tableCode(table)} }`,
      )
      .join(', ')}],`,
    `follows: ${optionCode(
      joint.follows,
      ({ joint: followed, axis, sets, table }) =>
        `{ joint: ${JSON.stringify(followed)}, axis: '${axis}', sets: '${sets}', table: ${tableCode(table)} }`,
    )},`,
    `flesh: ${optionCode(joint.flesh, ({ radius, length, mass }) => `{ radius: ${radius}, length: ${length}, mass: ${mass} }`)},`,
    '}',
  ].join(' ');

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
  name: 'lightocean:joints',
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
