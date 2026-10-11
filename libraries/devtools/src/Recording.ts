import { type Event, Game, type Host } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';

/**
 * A game as it was played on a host: the world as it was when recording began, and everything that changed it after, in order. Everything else follows from them, since a step is a function of the world and what went into it; so a recording can be replayed, checked for determinism, rewound, and turned into a test.
 *
 * It is data: the world and every value in it are encoded by the game's own schemas, so it travels as JSON and is read back with the game that played it.
 */

/** An input that reached a step: the entity it was aimed at, its component's name, and its value as the component encodes it. */
const Input = Schema.Struct({
  entity: Schema.Int,
  component: Schema.String,
  value: Schema.Unknown,
});

/** One thing that changed the world: a client joining or leaving, between steps, or a step taken, with the input that reached it, the actions the rules took in it, as their events encode them, and the fingerprint of the world it led to, which a replay must come to. */
export const Entry = Schema.Union([
  Schema.TaggedStruct('Joined', { entity: Schema.Int }),
  Schema.TaggedStruct('Left', { entity: Schema.Int }),
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
  /** The world when recording began, as the game's schema encodes it. */
  first: Schema.Unknown,
  entries: Schema.Array(Entry),
});
export type Recording = typeof Recording.Type;

/** A recording being made, until its scope closes. */
export interface Recorder {
  /** Everything recorded so far. */
  readonly recording: Effect.Effect<Recording>;
}

/** Encodes `action` by the schema of the action or event of `game` it is, found by its tag. */
const encoderOf = (game: Game.Game) => {
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

/** What `game` records of each thing that happens to a host's world. */
export const entryOf = (game: Game.Game): ((happening: Host.Happening) => Entry) => {
  const encodeAction = encoderOf(game);
  return (happening) =>
    happening._tag === 'Stepped'
      ? {
          _tag: 'Stepped',
          tick: happening.world.tick,
          inputs: happening.inputs.map((input) => ({
            entity: input.entity,
            component: input.component.name,
            value: input.encoded(),
          })),
          actions: happening.actions.map(encodeAction),
          fingerprint: Fingerprint.of(game, happening.world),
        }
      : happening;
};

/** Records `game` as `host` plays it, from now until the scope closes. */
export const record = (
  host: Host.Host,
  game: Game.Game,
): Effect.Effect<Recorder, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    // A world its own game cannot encode is a bug in the engine, not something a recording can go on from.
    const first = yield* Schema.encodeEffect(Game.schema(game))(watching.world).pipe(Effect.orDie);
    const entries: Array<Entry> = [];
    const toEntry = entryOf(game);
    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          entries.push(toEntry(happening));
        }),
      ),
      Effect.forkScoped,
    );
    return {
      recording: Effect.sync(() => ({ stepRate: game.stepRate, first, entries: [...entries] })),
    };
  });
