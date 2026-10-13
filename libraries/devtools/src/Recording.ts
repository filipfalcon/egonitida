import { type Event, Game, type Host, type State } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';
import * as Version from '#src/Version.ts';

/**
 * A game as it was played on a host, in segments, one for each version of its code the host played, x′ = f_v(x, u): a reload of new code ends one segment and begins the next. A segment is the state as it was when it began, the version that played it, and everything that replaced the state after, in order: steps, with their input, players joining and leaving, and the host going back to another state. Everything else follows from them, since the same state and the same input give the same next state under one version; so a segment can be replayed with its own version alone, checked for determinism, rewound, and turned into a test.
 *
 * It is data: each state and every value in it are encoded by the schemas of the version that played it, so it travels as JSON and is read back with that version's game.
 */

/** A demand that reached a step: the entity it was on, its component's name, and its value as the component encodes it. */
export const Demand = Schema.Struct({
  entity: Schema.Int,
  component: Schema.String,
  value: Schema.Unknown,
});
export type Demand = typeof Demand.Type;

/** The input of a step: its demands, and its actions as their schemas encode them, in the order they arrived. */
export const Input = Schema.Struct({
  demands: Schema.Array(Demand),
  actions: Schema.Array(Schema.Unknown),
});
export type Input = typeof Input.Type;

/** One thing that replaced the state: a client joining or leaving, between steps, the host going back to a state, or a step taken, with its input and the fingerprint of the state it led to, which a replay must come to. */
export const Entry = Schema.Union([
  Schema.TaggedStruct('Joined', { entity: Schema.Int }),
  Schema.TaggedStruct('Left', { entity: Schema.Int }),
  /** The host went back to a state, as the game's schema encodes it. */
  Schema.TaggedStruct('Restored', { state: Schema.Unknown }),
  Schema.TaggedStruct('Stepped', {
    tick: Schema.Int,
    input: Input,
    fingerprint: Fingerprint.Fingerprint,
  }),
]);
export type Entry = typeof Entry.Type;

/** What a recording holds of one version of a game: the state it began at, the version, and everything that replaced the state under it. */
export const Segment = Schema.Struct({
  /** The rate the game steps at, which every replay keeps. */
  stepRate: Schema.Int,
  /** The code that played it: its build, and the schema of its state. */
  version: Version.Version,
  /** The state when the segment began, as its version's schema encodes it. */
  first: Schema.Unknown,
  entries: Schema.Array(Entry),
});
export type Segment = typeof Segment.Type;

/** A game as a host played it: a segment for every version of its code, oldest first. */
export const Recording = Schema.Struct({ segments: Schema.Array(Segment) });
export type Recording = typeof Recording.Type;

/** A recording being made, until its scope closes. */
export interface Recorder {
  /** Every segment recorded so far, the last of them the one being recorded. */
  readonly recording: Effect.Effect<Recording>;
  /** The segment being recorded: of the version the host plays now. */
  readonly segment: Effect.Effect<Segment>;
}

/** What happens to a host's state within one build of its game. */
export type Happening = Exclude<Host.Happening, { readonly _tag: 'Reloaded' }>;

/** Encodes an action of `game`, a player's or a command's result, or an event, by its own schema, found by its tag. */
export const encoderOf = (game: Game.Game) => {
  const byTag = new Map(
    [...game.actions, ...game.results, ...game.events].map((cause) => [
      cause.tag,
      Schema.encodeSync(Schema.toCodecJson(cause.schema)),
    ]),
  );
  return (cause: Event.Tagged): unknown =>
    Option.match(Option.fromNullishOr(byTag.get(cause._tag)), {
      onNone: () => {
        throw new Error(`${cause._tag} is no action or event of the game recorded`);
      },
      onSome: (encode) => encode(cause),
    });
};

/** What `game` records of each thing that happens to a host's state. */
export const entryOf = (game: Game.Game): ((happening: Happening) => Entry) => {
  const encodeAction = encoderOf(game);
  const encodeState = Schema.encodeSync(Game.schema(game));
  return (happening) =>
    happening._tag === 'Restored'
      ? { _tag: 'Restored', state: encodeState(happening.state) }
      : happening._tag === 'Stepped'
        ? {
            _tag: 'Stepped',
            tick: happening.state.tick,
            input: {
              demands: happening.input.demands.map((demand) => ({
                entity: demand.entity,
                component: demand.component.name,
                value: demand.encoded(),
              })),
              actions: happening.input.actions.map(encodeAction),
            },
            fingerprint: Fingerprint.of(game, happening.state),
          }
        : happening._tag === 'Joined'
          ? { _tag: 'Joined', entity: happening.entity }
          : happening;
};

/** A segment begun from `state` by the build `build` of `game`, as `game` encodes it. */
const begin = (game: Game.Game, build: Option.Option<string>, state: State.State) => ({
  toEntry: entryOf(game),
  // A state its own game cannot encode is a bug in the engine, not something a recording can go on from.
  segment: {
    stepRate: game.stepRate,
    version: Version.of(game, build),
    first: Schema.encodeSync(Game.schema(game))(state),
  },
  entries: new Array<Entry>(),
});

/** Records `game` as `host` plays it, from now until the scope closes, beginning a new segment whenever the host takes up another version of its code. */
export const record = (
  host: Host.Host,
  game: Game.Game,
): Effect.Effect<Recorder, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    const taking = {
      done: new Array<Segment>(),
      now: begin(game, watching.build, watching.state),
    };
    const current = (): Segment => ({ ...taking.now.segment, entries: [...taking.now.entries] });
    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Reloaded') {
            taking.done.push(current());
            taking.now = begin(happening.game, happening.build, happening.state);
            return;
          }
          taking.now.entries.push(taking.now.toEntry(happening));
        }),
      ),
      Effect.forkScoped,
    );
    return {
      recording: Effect.sync(() => ({ segments: [...taking.done, current()] })),
      segment: Effect.sync(current),
    };
  });
