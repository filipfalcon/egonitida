import { type Event, Game, type Host, type State } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';

/**
 * A game as it was played on a host: the state as it was when recording began, and everything that replaced it after, in order. Everything else follows from them, since a step is a function of the state and what went into it; so a recording can be replayed, checked for determinism, rewound, and turned into a test.
 *
 * It is data: the state and every value in it are encoded by the game's own schemas, so it travels as JSON and is read back with the game that played it.
 */

/** An input that reached a step: the entity it was aimed at, its component's name, and its value as the component encodes it. */
export const Input = Schema.Struct({
  entity: Schema.Int,
  component: Schema.String,
  value: Schema.Unknown,
});
export type Input = typeof Input.Type;

/** One thing that replaced the state: a client joining or leaving, between steps, the host going back to a state, or a step taken, with the input that reached it, the actions the rules took in it, as their events encode them, and the fingerprint of the state it led to, which a replay must come to. */
export const Entry = Schema.Union([
  Schema.TaggedStruct('Joined', { entity: Schema.Int }),
  Schema.TaggedStruct('Left', { entity: Schema.Int }),
  /** The host went back to a state, as the game's schema encodes it. */
  Schema.TaggedStruct('Restored', { state: Schema.Unknown }),
  Schema.TaggedStruct('Stepped', {
    tick: Schema.Int,
    inputs: Schema.Array(Input),
    actions: Schema.Array(Schema.Unknown),
    fingerprint: Fingerprint.Fingerprint,
  }),
]);
export type Entry = typeof Entry.Type;

export const Recording = Schema.Struct({
  /** The rate the game steps at, which every replay keeps. */
  stepRate: Schema.Int,
  /** The state when recording began, as the game's schema encodes it. */
  first: Schema.Unknown,
  entries: Schema.Array(Entry),
});
export type Recording = typeof Recording.Type;

/** A recording being made, until its scope closes: a segment for every build of the game the host played, since a recording is valid for one build. */
export interface Recorder {
  /** Everything recorded so far of the build the host plays now. */
  readonly recording: Effect.Effect<Recording>;
  /** Every segment recorded so far, oldest first, the last of them the one being recorded. */
  readonly segments: Effect.Effect<ReadonlyArray<Recording>>;
}

/** What happens to a host's state within one build of its game. */
export type Happening = Exclude<Host.Happening, { readonly _tag: 'Reloaded' }>;

/** Encodes an action or event of `game` by its own schema, found by its tag. */
export const encoderOf = (game: Game.Game) => {
  const byTag = new Map(
    [...game.actions, ...game.events].map((event) => [
      event.tag,
      Schema.encodeSync(Schema.toCodecJson(event.schema)),
    ]),
  );
  return (action: Event.Tagged): unknown =>
    Option.match(Option.fromNullishOr(byTag.get(action._tag)), {
      onNone: () => {
        throw new Error(`${action._tag} is no action or event of the game recorded`);
      },
      onSome: (encode) => encode(action),
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
            inputs: happening.inputs.map((input) => ({
              entity: input.entity,
              component: input.component.name,
              value: input.encoded(),
            })),
            actions: happening.actions.map(encodeAction),
            fingerprint: Fingerprint.of(game, happening.state),
          }
        : happening._tag === 'Joined'
          ? { _tag: 'Joined', entity: happening.entity }
          : happening;
};

/** A segment begun from `state`, as `game` encodes it. */
const begin = (game: Game.Game, state: State.State) => ({
  game,
  toEntry: entryOf(game),
  // A state its own game cannot encode is a bug in the engine, not something a recording can go on from.
  recording: { stepRate: game.stepRate, first: Schema.encodeSync(Game.schema(game))(state) },
  entries: new Array<Entry>(),
});

/** Records `game` as `host` plays it, from now until the scope closes, beginning a new segment whenever the host takes up another build. */
export const record = (
  host: Host.Host,
  game: Game.Game,
): Effect.Effect<Recorder, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    const taking = { done: new Array<Recording>(), now: begin(game, watching.state) };
    const current = () => ({ ...taking.now.recording, entries: [...taking.now.entries] });
    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Reloaded') {
            taking.done.push(current());
            taking.now = begin(happening.game, happening.state);
            return;
          }
          taking.now.entries.push(taking.now.toEntry(happening));
        }),
      ),
      Effect.forkScoped,
    );
    return {
      recording: Effect.sync(current),
      segments: Effect.sync(() => [...taking.done, current()]),
    };
  });
