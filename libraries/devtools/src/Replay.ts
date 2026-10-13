import { Demand, Game, type Host, type Input, State } from '@lightocean/core';
import { Data, Effect, Option, Result, Schema, type Scope, Stream } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';
import * as Recording from '#src/Recording.ts';
import * as Version from '#src/Version.ts';

/**
 * A segment of a recording played again: from its first state, every join, leave, and step taken anew by the game itself, each step's state compared with the fingerprint recorded for it. A game whose steps take nothing but the state and the input comes to the same states every time; one that reads anything else, such as a clock, `Math.random`, or anything kept outside the state, comes apart, and the replay says at which step and in which component.
 *
 * A replay runs a segment made earlier, as a test of the build at hand, or beside a host as it plays, as a check in development. A segment holds for the version that recorded it: replayed by another, as a recording of a bug replayed after its fix, the replay says so before anything else, and where it comes apart is a change of the code, not a game that is not deterministic. A check of determinism refuses another version, since what it found would mean nothing.
 */

/** What a replay needs of how a game was hosted: the game, how a client joined and left, and the build of the game's code, if its bundler named one. */
export interface Setup {
  readonly game: Game.Game;
  readonly join: (state: State.State) => readonly [State.State, State.Entity];
  readonly leave: (state: State.State, entity: State.Entity) => State.State;
  readonly build?: string | undefined;
}

/** The version of the code `setup` plays. */
export const versionOf = (setup: Setup): Version.Version =>
  Version.of(setup.game, Option.fromNullishOr(setup.build));

/** Where a replay came apart from what was recorded: in what a step led to, or in the entity a join gave. */
export type Where =
  | Fingerprint.Difference
  | { readonly _tag: 'Joined'; readonly recorded: State.Entity; readonly replayed: State.Entity };

/** The first place a replay came apart, the tick the state was at there, and why: the game is not deterministic, if the version that recorded it replays it, or its code changed, if another does. */
export interface Divergence {
  readonly tick: number;
  readonly where: Where;
  readonly cause: 'Nondeterminism' | 'ChangedCode';
}

/** A recording that the game at hand cannot read: one made by another game, or by a build whose schemas have changed since. */
export class Unreadable extends Data.TaggedError('Unreadable')<{ readonly reason: string }> {}

/** A segment a check of determinism refuses, since another version than its own would check it, and why. */
export class OtherVersion extends Data.TaggedError('OtherVersion')<{
  readonly mismatch: Version.Mismatch;
  readonly reason: string;
}> {}

const tagOf = (encoded: unknown): Option.Option<string> =>
  typeof encoded === 'object' &&
  encoded !== null &&
  '_tag' in encoded &&
  typeof encoded._tag === 'string'
    ? Option.some(encoded._tag)
    : Option.none();

/** What a replay came to after one entry: the state, and what each part did, if the replay is traced. */
export interface Taken {
  readonly entry: Recording.Entry;
  readonly state: State.State;
  readonly trace: ReadonlyArray<Game.Trace>;
}

/** How `setup` takes one entry after another, from a state to the next, or to where it came apart. */
const taking = (
  setup: Setup,
  options: { readonly trace: boolean; readonly cause: Divergence['cause'] },
) => {
  const demands = new Map(
    setup.game.components
      .filter((component): component is Demand.DemandComponent => component.owner === 'demand')
      .map((component) => [
        component.name,
        (entity: State.Entity, value: unknown) =>
          Option.map(
            Schema.decodeUnknownOption(Schema.toCodecJson(component.schema))(value),
            (decoded) => Demand.of(entity, component, decoded),
          ),
      ]),
  );
  const actions = new Map(
    [...setup.game.actions, ...setup.game.results].map((action) => [
      action.tag,
      Schema.decodeUnknownOption(Schema.toCodecJson(action.schema)),
    ]),
  );
  const read = <A>(found: Option.Option<A>, what: () => string) =>
    Effect.fromOption(found).pipe(Effect.mapError(() => new Unreadable({ reason: what() })));

  return (
    state: State.State,
    entry: Recording.Entry,
  ): Effect.Effect<Result.Result<Taken, Divergence>, Unreadable> =>
    Effect.gen(function* () {
      if (entry._tag === 'Joined') {
        // A join that gives back an entity the state holds already, as a page that came again is given its player, changes nothing.
        if (State.entities(state).includes(entry.entity)) {
          return Result.succeed({ entry, state, trace: [] });
        }
        const [joined, entity] = setup.join(state);
        return entity === entry.entity
          ? Result.succeed({ entry, state: joined, trace: [] })
          : Result.fail({
              tick: state.tick,
              where: { _tag: 'Joined', recorded: entry.entity, replayed: entity },
              cause: options.cause,
            });
      }
      if (entry._tag === 'Restored') {
        return Result.succeed({ entry, state: yield* first(setup.game, entry.state), trace: [] });
      }
      if (entry._tag === 'Left') {
        return Result.succeed({ entry, state: setup.leave(state, entry.entity), trace: [] });
      }
      const given = yield* Effect.forEach(entry.input.demands, ({ entity, component, value }) =>
        read(
          Option.flatMap(Option.fromNullishOr(demands.get(component)), (decode) =>
            decode(entity, value),
          ),
          () => `a demand of ${component} the game cannot read`,
        ),
      );
      const taken = yield* Effect.forEach(entry.input.actions, (encoded) =>
        read(
          Option.flatMap(tagOf(encoded), (tag) =>
            Option.flatMap(
              Option.fromNullishOr(actions.get(tag)),
              (decode): Option.Option<Input.Action> => decode(encoded),
            ),
          ),
          () => 'an action the game cannot read',
        ),
      );
      const stepped = Game.step(
        setup.game,
        state,
        { demands: given, actions: taken },
        {
          freeze: false,
          trace: options.trace,
        },
      );
      return Option.match(
        Fingerprint.difference(entry.fingerprint, Fingerprint.of(setup.game, stepped.state)),
        {
          onNone: () => Result.succeed({ entry, state: stepped.state, trace: stepped.trace }),
          onSome: (where): Result.Result<Taken, Divergence> =>
            Result.fail({ tick: entry.tick, where, cause: options.cause }),
        },
      );
    });
};

/** A state of a recording, as `game` reads it. */
export const first = (game: Game.Game, first: unknown) =>
  Schema.decodeUnknownEffect(Game.schema(game))(first).pipe(
    Effect.mapError((issue) => new Unreadable({ reason: issue.message })),
  );

/** Takes `entries` with `setup` from `state`, traced if asked: what every entry came to, up to where it first came apart, if it did, as the version that recorded them, unless told the code changed since. */
export const from = (
  setup: Setup,
  state: State.State,
  entries: ReadonlyArray<Recording.Entry>,
  options: { readonly trace?: boolean; readonly cause?: Divergence['cause'] } = {},
): Effect.Effect<
  { readonly taken: ReadonlyArray<Taken>; readonly divergence: Option.Option<Divergence> },
  Unreadable
> =>
  Effect.gen(function* () {
    const take = taking(setup, {
      trace: options.trace ?? false,
      cause: options.cause ?? 'Nondeterminism',
    });
    const taken: Array<Taken> = [];
    let now = state;
    for (const entry of entries) {
      const next = yield* take(now, entry);
      if (Result.isFailure(next)) {
        return { taken, divergence: Option.some(next.failure) };
      }
      taken.push(next.success);
      now = next.success.state;
    }
    return { taken, divergence: Option.none() };
  });

/** Replays `segment` with `setup`, traced if asked: how the version replaying it differs from the one that recorded it, if it does, and what every entry came to, up to where it first came apart, if it did. */
export const steps = (
  setup: Setup,
  segment: Recording.Segment,
  options: { readonly trace?: boolean } = {},
) =>
  Effect.gen(function* () {
    const version = Version.mismatch(segment.version, versionOf(setup));
    const state = yield* first(setup.game, segment.first);
    const replayed = yield* from(setup, state, segment.entries, {
      ...options,
      cause: Option.isSome(version) ? 'ChangedCode' : 'Nondeterminism',
    });
    return { ...replayed, version };
  });

/** Checks `segment` for determinism with `setup`, the version that recorded it: where it first came apart, if it did. Another version is refused, since what it found would mean nothing. */
export const check = (
  setup: Setup,
  segment: Recording.Segment,
): Effect.Effect<Option.Option<Divergence>, Unreadable | OtherVersion> =>
  Option.match(Version.mismatch(segment.version, versionOf(setup)), {
    onSome: (mismatch) =>
      Effect.fail(
        new OtherVersion({
          mismatch,
          reason: `a check of determinism needs the version that recorded it: ${Version.told(mismatch)}`,
        }),
      ),
    onNone: () => Effect.map(steps(setup, segment), ({ divergence }) => divergence),
  });

/** What a replay needs of the code a host took up. */
const setupOf = (reloaded: Extract<Host.Happening, { readonly _tag: 'Reloaded' }>): Setup => ({
  game: reloaded.game,
  join: reloaded.join,
  leave: reloaded.leave,
  build: Option.getOrUndefined(reloaded.build),
});

/**
 * Replays what `host` plays, beside it, from now until the scope closes, through a recording of it as it is made: it comes to where the replay first came apart, and never does while the game replays as it is played. For development, since it steps the game twice.
 */
export const alongside = (
  host: Host.Host,
  setup: Setup,
): Effect.Effect<Divergence, Unreadable, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    /** The replay of one build, from `state`: it starts from the state as a recording keeps it, encoded and read back, so it checks what a recording would. */
    const begin = (played: Setup, state: State.State) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(Game.schema(played.game))(state).pipe(
          Effect.orDie,
        );
        return {
          take: taking(played, { trace: false, cause: 'Nondeterminism' }),
          toEntry: Recording.entryOf(played.game),
          state: yield* first(played.game, encoded),
        };
      });
    const replaying = { now: yield* begin(setup, watching.state) };
    const found = yield* watching.happenings.pipe(
      Stream.mapEffect((happening) =>
        happening._tag === 'Reloaded'
          ? Effect.map(begin(setupOf(happening), happening.state), (now) => {
              replaying.now = now;
              return Result.failVoid;
            })
          : Effect.map(
              replaying.now.take(replaying.now.state, replaying.now.toEntry(happening)),
              (taken) => {
                if (Result.isFailure(taken)) {
                  return Result.succeed(taken.failure);
                }
                replaying.now.state = taken.success.state;
                return Result.failVoid;
              },
            ),
      ),
      Stream.filterMap((found) => found),
      Stream.runHead,
    );
    return yield* Option.match(found, { onNone: () => Effect.never, onSome: Effect.succeed });
  });
