import { type Event, Game, Input, type Host, type World } from '@lightocean/core';
import { Data, Effect, Option, Result, Schema, type Scope, Stream } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';
import * as Recording from '#src/Recording.ts';

/**
 * A recording played again: from its first world, every join, leave, and step taken anew by the game itself, each step's world compared with the fingerprint recorded for it. A game whose steps take nothing but the world and what went into them comes to the same worlds every time; one that reads anything else, such as a clock, `Math.random`, or state kept outside the world, comes apart, and the replay says at which step and in which component.
 *
 * A replay runs a recording made earlier, as a test of the build at hand, or beside a host as it plays, as a check in development.
 */

/** What a replay needs of how a game was hosted: the game, and how a client joined and left. */
export interface Setup {
  readonly game: Game.Game;
  readonly join: (world: World.World) => readonly [World.World, World.Entity];
  readonly leave: (world: World.World, entity: World.Entity) => World.World;
}

/** Where a replay came apart from what was recorded: in what a step led to, or in the entity a join gave. */
export type Where =
  | Fingerprint.Difference
  | { readonly _tag: 'Joined'; readonly recorded: World.Entity; readonly replayed: World.Entity };

/** The first place a replay came apart, and the tick the world was at there. */
export interface Divergence {
  readonly tick: number;
  readonly where: Where;
}

/** A recording that the game at hand cannot read: one made by another game, or by a build whose schemas have changed since. */
export class Unreadable extends Data.TaggedError('Unreadable')<{ readonly reason: string }> {}

const tagOf = (encoded: unknown): Option.Option<string> =>
  typeof encoded === 'object' &&
  encoded !== null &&
  '_tag' in encoded &&
  typeof encoded._tag === 'string'
    ? Option.some(encoded._tag)
    : Option.none();

/** What a replay came to after one entry: the world, and what each part did, if the replay is traced. */
export interface Taken {
  readonly entry: Recording.Entry;
  readonly world: World.World;
  readonly trace: ReadonlyArray<Game.Trace>;
}

/** How `setup` takes one entry after another, from a world to the next, or to where it came apart. */
const taking = (setup: Setup, options: { readonly trace: boolean }) => {
  const inputs = new Map(
    setup.game.components
      .filter((component): component is Input.InputComponent => component.owner === 'input')
      .map((component) => [
        component.name,
        (entity: World.Entity, value: unknown) =>
          Option.map(
            Schema.decodeUnknownOption(Schema.toCodecJson(component.schema))(value),
            (decoded) => Input.of(entity, component, decoded),
          ),
      ]),
  );
  const actions = new Map(
    [...setup.game.actions, ...setup.game.events].map((event) => [
      event.tag,
      Schema.decodeUnknownOption(Schema.toCodecJson(event.schema)),
    ]),
  );
  const read = <A>(found: Option.Option<A>, what: () => string) =>
    Effect.fromOption(found).pipe(Effect.mapError(() => new Unreadable({ reason: what() })));

  return (
    world: World.World,
    entry: Recording.Entry,
  ): Effect.Effect<Result.Result<Taken, Divergence>, Unreadable> =>
    Effect.gen(function* () {
      if (entry._tag === 'Joined') {
        const [joined, entity] = setup.join(world);
        return entity === entry.entity
          ? Result.succeed({ entry, world: joined, trace: [] })
          : Result.fail({
              tick: world.tick,
              where: { _tag: 'Joined', recorded: entry.entity, replayed: entity },
            });
      }
      if (entry._tag === 'Left') {
        return Result.succeed({ entry, world: setup.leave(world, entry.entity), trace: [] });
      }
      const given = yield* Effect.forEach(entry.inputs, ({ entity, component, value }) =>
        read(
          Option.flatMap(Option.fromNullishOr(inputs.get(component)), (decode) =>
            decode(entity, value),
          ),
          () => `an input of ${component} the game cannot read`,
        ),
      );
      const taken = yield* Effect.forEach(entry.actions, (encoded) =>
        read(
          Option.flatMap(tagOf(encoded), (tag) =>
            Option.flatMap(
              Option.fromNullishOr(actions.get(tag)),
              (decode): Option.Option<Event.Tagged> => decode(encoded),
            ),
          ),
          () => 'an action the game cannot read',
        ),
      );
      const stepped = Game.step(setup.game, world, given, taken, {
        freeze: false,
        trace: options.trace,
      });
      return Option.match(
        Fingerprint.difference(entry.fingerprint, Fingerprint.of(setup.game, stepped.world)),
        {
          onNone: () => Result.succeed({ entry, world: stepped.world, trace: stepped.trace }),
          onSome: (where): Result.Result<Taken, Divergence> =>
            Result.fail({ tick: entry.tick, where }),
        },
      );
    });
};

/** The first world of `recording`, as `game` reads it. */
const firstOf = (game: Game.Game, first: unknown) =>
  Schema.decodeUnknownEffect(Game.schema(game))(first).pipe(
    Effect.mapError((issue) => new Unreadable({ reason: issue.message })),
  );

/** Replays `recording` with `setup`, traced if asked: what every entry came to, up to where it first came apart, if it did. */
export const steps = (
  setup: Setup,
  recording: Recording.Recording,
  options: { readonly trace?: boolean } = {},
): Effect.Effect<
  { readonly taken: ReadonlyArray<Taken>; readonly divergence: Option.Option<Divergence> },
  Unreadable
> =>
  Effect.gen(function* () {
    const take = taking(setup, { trace: options.trace ?? false });
    const taken: Array<Taken> = [];
    let world = yield* firstOf(setup.game, recording.first);
    for (const entry of recording.entries) {
      const next = yield* take(world, entry);
      if (Result.isFailure(next)) {
        return { taken, divergence: Option.some(next.failure) };
      }
      taken.push(next.success);
      world = next.success.world;
    }
    return { taken, divergence: Option.none() };
  });

/** Replays `recording` with `setup`: where it first came apart, if it did. */
export const check = (
  setup: Setup,
  recording: Recording.Recording,
): Effect.Effect<Option.Option<Divergence>, Unreadable> =>
  Effect.map(steps(setup, recording), ({ divergence }) => divergence);

/**
 * Replays what `host` plays, beside it, from now until the scope closes, through a recording of it as it is made: it comes to where the replay first came apart, and never does while the game replays as it is played. For development, since it steps the game twice.
 */
export const alongside = (
  host: Host.Host,
  setup: Setup,
): Effect.Effect<Divergence, Unreadable, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    const take = taking(setup, { trace: false });
    const toEntry = Recording.entryOf(setup.game);
    // The replay starts from the world as a recording keeps it, encoded and read back, so it checks what a recording would.
    const encoded = yield* Schema.encodeEffect(Game.schema(setup.game))(watching.world).pipe(
      Effect.orDie,
    );
    const state = { world: yield* firstOf(setup.game, encoded) };
    const found = yield* watching.happenings.pipe(
      Stream.mapEffect((happening) => take(state.world, toEntry(happening))),
      Stream.filterMap((taken) => {
        if (Result.isFailure(taken)) {
          return Result.succeed(taken.failure);
        }
        state.world = taken.success.world;
        return Result.failVoid;
      }),
      Stream.runHead,
    );
    return yield* Option.match(found, { onNone: () => Effect.never, onSome: Effect.succeed });
  });
