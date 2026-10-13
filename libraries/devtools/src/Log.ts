import type { Game, State } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import type * as Recording from '#src/Recording.ts';
import { encoderOf } from '#src/Recording.ts';
import * as Replay from '#src/Replay.ts';
import * as Version from '#src/Version.ts';

/**
 * What happened in a recording, step by step, for people and agents: who joined and left, the actions each step took, and what each system and rule did in it, and for what. The demands are left out unless asked for, since they reach nearly every step and say little on their own. It is told from a replay of the recording, which is how everything but the recording follows from it.
 */

/** What a part did in a step: the values it set, by component, the entities it spawned and despawned, the events it emitted and the commands it issued, all as they encode; and the event or action a rule ran for. */
export interface PartLine {
  /** The part, by its domain and name: a rule by the event or action it handles. */
  readonly part: string;
  readonly cause: Option.Option<unknown>;
  readonly set: Readonly<Record<string, ReadonlyArray<State.Entity>>>;
  readonly spawned: ReadonlyArray<State.Entity>;
  readonly despawned: ReadonlyArray<State.Entity>;
  readonly emitted: ReadonlyArray<unknown>;
  readonly issued: ReadonlyArray<{ readonly name: string; readonly args: unknown }>;
}

export type Line =
  | { readonly _tag: 'Joined' | 'Left'; readonly tick: number; readonly entity: State.Entity }
  /** The host went back to the state at `tick`. */
  | { readonly _tag: 'Restored'; readonly tick: number }
  | {
      readonly _tag: 'Stepped';
      readonly tick: number;
      /** The demands that reached the step, if asked for. */
      readonly demands: Option.Option<ReadonlyArray<Recording.Demand>>;
      readonly actions: ReadonlyArray<unknown>;
      readonly parts: ReadonlyArray<PartLine>;
    }
  /** Where the replay the log is told from came apart, after which it tells nothing. */
  | ({ readonly _tag: 'CameApart' } & Replay.Divergence)
  /** The log is told by another version of the code than the one that recorded it, said before anything else. */
  | { readonly _tag: 'Replayed'; readonly told: string }
  /** The host took up another build of the code at `tick`, from the state it held. */
  | { readonly _tag: 'Reloaded'; readonly tick: number; readonly build: Option.Option<string> };

/** How a part is named in a log, and wherever devtools name one: by its domain and name, a rule by what it handles. */
export const nameOf = (part: Game.Part): string => {
  const domain = Option.getOrElse(part.domain, () => 'Game');
  if (part._tag !== 'Rule') {
    return `${domain}: ${part.name}`;
  }
  return Option.match(part.name, {
    onNone: () => `${domain}: on ${part.on}`,
    onSome: (name) => `${domain}: ${name}, on ${part.on}`,
  });
};

/** The log of `entries`, replayed with `setup` from `state`; with the demands of every step if `demands` is asked for. */
export const from = (
  setup: Replay.Setup,
  state: State.State,
  entries: ReadonlyArray<Recording.Entry>,
  options: { readonly demands?: boolean; readonly cause?: Replay.Divergence['cause'] } = {},
): Effect.Effect<ReadonlyArray<Line>, Replay.Unreadable> =>
  Effect.gen(function* () {
    const encode = encoderOf(setup.game);
    const { taken, divergence } = yield* Replay.from(setup, state, entries, {
      trace: true,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    const lines = taken.map(({ entry, state, trace }): Line => {
      // Joining, leaving, and going back take no step, so the state after one is at the tick it came to.
      if (entry._tag === 'Restored') {
        return { _tag: 'Restored', tick: state.tick };
      }
      if (entry._tag !== 'Stepped') {
        return { _tag: entry._tag, tick: state.tick, entity: entry.entity };
      }
      return {
        _tag: 'Stepped',
        tick: entry.tick,
        demands: options.demands === true ? Option.some(entry.input.demands) : Option.none(),
        actions: entry.input.actions,
        parts: trace.map((done) => ({
          part: nameOf(done.part),
          cause: Option.map(done.cause, encode),
          set: done.set.reduce<Record<string, ReadonlyArray<State.Entity>>>(
            (byComponent, { entity, component }) => ({
              ...byComponent,
              [component]: [...(byComponent[component] ?? []), entity],
            }),
            {},
          ),
          spawned: done.spawned,
          despawned: done.despawned,
          emitted: done.emitted.map(encode),
          issued: done.issued.map(({ name, encoded }) => ({ name, args: encoded })),
        })),
      };
    });
    return Option.match(divergence, {
      onNone: () => lines,
      onSome: (apart) => [...lines, { _tag: 'CameApart', ...apart }],
    });
  });

/** The log of `segment`, replayed with `setup`, saying first if `setup` is another version than the one that recorded it; with the demands of every step if `demands` is asked for. */
export const of = (
  setup: Replay.Setup,
  segment: Recording.Segment,
  options: { readonly demands?: boolean } = {},
): Effect.Effect<ReadonlyArray<Line>, Replay.Unreadable> =>
  Effect.gen(function* () {
    const version = Version.mismatch(segment.version, Replay.versionOf(setup));
    const state = yield* Replay.first(setup.game, segment.first);
    const lines = yield* from(setup, state, segment.entries, {
      ...options,
      cause: Option.isSome(version) ? 'ChangedCode' : 'Nondeterminism',
    });
    return Option.match(version, {
      onNone: () => lines,
      onSome: (mismatch): ReadonlyArray<Line> => [
        { _tag: 'Replayed', told: Version.told(mismatch) },
        ...lines,
      ],
    });
  });

/** The tag of an encoded event or action, and its other fields as JSON. */
const partsOf = (encoded: unknown): readonly [string, string] => {
  if (typeof encoded !== 'object' || encoded === null || !('_tag' in encoded)) {
    return ['', JSON.stringify(encoded)];
  }
  const { _tag, ...fields } = encoded;
  return [String(_tag), JSON.stringify(fields)];
};

/** An encoded event or action as a log reads it: its tag, then its fields. */
const told = (encoded: unknown): string => partsOf(encoded).join(' ');

/** Where a replay came apart, as a log reads it. */
const whereText = (where: Replay.Where): string => {
  switch (where._tag) {
    case 'Component':
      return `in ${where.name}`;
    case 'State':
      return `in the state's ${where.field}`;
    case 'Joined':
      return `in the entity a join gave: ${where.replayed}, not ${where.recorded}`;
  }
};

/** What a part did, a line to each kind of thing; a rule with the fields of what it ran for. */
const partText = (done: PartLine): ReadonlyArray<string> => [
  Option.match(done.cause, {
    onNone: () => `  ${done.part}`,
    onSome: (cause) => `  ${done.part} ${partsOf(cause)[1]}`,
  }),
  ...Object.entries(done.set).map(
    ([component, entities]) => `    set ${component} of ${entities.join(', ')}`,
  ),
  ...(done.spawned.length === 0 ? [] : [`    spawned ${done.spawned.join(', ')}`]),
  ...(done.despawned.length === 0 ? [] : [`    despawned ${done.despawned.join(', ')}`]),
  ...done.emitted.map((event) => `    emitted ${told(event)}`),
  ...done.issued.map(({ name, args }) => `    issued ${name} ${JSON.stringify(args)}`),
];

/** One line of a log as text. */
const lineText = (line: Line): string => {
  switch (line._tag) {
    case 'Joined':
      return `tick ${line.tick}: entity ${line.entity} joined`;
    case 'Left':
      return `tick ${line.tick}: entity ${line.entity} left`;
    case 'Restored':
      return `tick ${line.tick}: went back to this tick`;
    case 'CameApart':
      return `tick ${line.tick}: the replay came apart ${whereText(line.where)}${
        line.cause === 'ChangedCode' ? ', as the code changed since it was recorded' : ''
      }`;
    case 'Replayed':
      return line.told;
    case 'Reloaded':
      return `tick ${line.tick}: took up ${Option.match(line.build, {
        onNone: () => 'an unnamed build',
        onSome: (build) => `build ${build}`,
      })}`;
    case 'Stepped':
      return [
        `tick ${line.tick}`,
        ...Option.getOrElse(line.demands, () => []).map(
          ({ entity, component, value }) =>
            `  demand ${component} of ${entity} ${JSON.stringify(value)}`,
        ),
        ...line.actions.map((action) => `  action ${told(action)}`),
        ...line.parts.flatMap(partText),
      ].join('\n');
  }
};

/** A step in which something happened, as data a page shows: what the players did, each by its tag and its other fields as JSON, and what each part of the game set, spawned, and despawned. */
export const Step = Schema.Struct({
  tick: Schema.Int,
  actions: Schema.Array(Schema.Struct({ tag: Schema.String, fields: Schema.String })),
  parts: Schema.Array(
    Schema.Struct({
      part: Schema.String,
      set: Schema.Record(Schema.String, Schema.Array(Schema.Int)),
      spawned: Schema.Array(Schema.Int),
      despawned: Schema.Array(Schema.Int),
    }),
  ),
});
export type Step = typeof Step.Type;

/** The steps of `lines` in which something happened, as data. */
export const stepsOf = (lines: ReadonlyArray<Line>): ReadonlyArray<Step> =>
  lines.flatMap((line): ReadonlyArray<Step> => {
    if (line._tag !== 'Stepped' || (line.actions.length === 0 && line.parts.length === 0)) {
      return [];
    }
    return [
      {
        tick: line.tick,
        actions: line.actions.map((action) => {
          const [tag, fields] = partsOf(action);
          return { tag, fields };
        }),
        parts: line.parts.map(({ part, set, spawned, despawned }) => ({
          part,
          set,
          spawned,
          despawned,
        })),
      },
    ];
  });

/** `lines` as text: a step to a paragraph, joins and leaves on a line of their own. */
export const format = (lines: ReadonlyArray<Line>): string => lines.map(lineText).join('\n\n');
