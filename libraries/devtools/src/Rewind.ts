import type { Client, Host, State } from '@nitida/core';
import { Data, Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Recording from '#src/Recording.ts';
import * as Replay from '#src/Replay.ts';

/**
 * Going back in a hosted game: the state the host was at, at any tick of a bounded span of time, shown to its clients through the same views while time is suspended, and played on from if asked. It keeps a keyframe, a state the host stepped to, every so many steps, and what happened after each, and comes to any tick by replaying from the keyframe before it, so a tick costs at most a few steps.
 *
 * It runs beside a host, in development; a page drives it with controls. The time it keeps is one, across every new build of the game the host takes up: each tick is replayed by the build that played it, and each reload is marked where it came. A tick of an earlier build can be shown, but not played on from, since that build no longer runs.
 */

export interface Options {
  /** How many steps apart keyframes are kept: fewer costs memory, more costs steps to come to a tick. */
  readonly every: number;
  /** How far back it keeps, in seconds of the game's time. */
  readonly keepSeconds: number;
}

/** A tick asked of an earlier build than the one the host plays, which cannot be played on from, and why. */
export class Earlier extends Data.TaggedError('Earlier')<{ readonly reason: string }> {}

/** A build the host played: how its ticks are replayed, and what its bundler named it. */
interface Played {
  readonly setup: Replay.Setup;
  readonly toEntry: (happening: Recording.Happening) => Recording.Entry;
}

/** A tick it may come back to, and how: from a keyframe, and the entries after it. */
interface Keyframe {
  readonly state: State.State;
  /** Where in the moments kept it stands: the moments after it are what came of it. */
  readonly at: number;
  /** The build that played it, by its place among those played. */
  readonly played: number;
}

/** Something that happened to the host's state, and the tick the state was at after it: an entry of a recording, or the host taking up another build, which a keyframe always follows. */
type Moment =
  | { readonly _tag: 'Entry'; readonly entry: Recording.Entry; readonly tick: number }
  | { readonly _tag: 'Reloaded'; readonly tick: number; readonly played: number };

/** The ticks between two, as one build played them: the state at the first, and what happened after it. */
export interface Stretch {
  readonly setup: Replay.Setup;
  readonly state: State.State;
  readonly entries: ReadonlyArray<Recording.Entry>;
}

export interface Rewind {
  /** The oldest and newest ticks it can come back to, and every tick in between at which the host took up another build, with the build. */
  readonly span: Effect.Effect<{
    readonly oldest: number;
    readonly newest: number;
    readonly reloads: ReadonlyArray<{
      readonly tick: number;
      readonly build: Option.Option<string>;
    }>;
  }>;
  /** The state the host was at, at `tick`, if it keeps that tick. */
  readonly stateAt: (tick: number) => Effect.Effect<Option.Option<State.State>, Replay.Unreadable>;
  /** The state at `from`, and everything that happened after it up to the state at `to`, if it keeps both: a stretch for each build that played them, in order. */
  readonly between: (
    from: number,
    to: number,
  ) => Effect.Effect<Option.Option<ReadonlyArray<Stretch>>, Replay.Unreadable>;
  /** The build of the game the host plays now. */
  readonly setup: Effect.Effect<Replay.Setup>;
  /** Goes back to the state at `tick` and plays on from it: what came after it is gone. Only a tick of the build the host plays now can be played on from. */
  readonly playFrom: (tick: number) => Effect.Effect<void, Replay.Unreadable | Earlier>;
  readonly host: Host.Host;
}

/** What a replay needs of the build a host plays now. */
const setupOf = (
  reloaded: Extract<Host.Happening, { readonly _tag: 'Reloaded' }>,
): Replay.Setup => ({
  game: reloaded.game,
  join: reloaded.join,
  leave: reloaded.leave,
  build: Option.getOrUndefined(reloaded.build),
});

/** Keeps what `host` plays, from now until the scope closes, so it can come back to any tick of the last `keepSeconds`. */
export const make = (
  host: Host.Host,
  setup: Replay.Setup,
  options: Options,
): Effect.Effect<Rewind, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    const keepTicks = options.keepSeconds * setup.game.stepRate;
    const rewinding = {
      /** Every build played since keeping began, the one played now last. */
      played: [{ setup, toEntry: Recording.entryOf(setup.game) }] satisfies Array<Played>,
      keyframes: [{ state: watching.state, at: 0, played: 0 }] satisfies Array<Keyframe>,
      moments: new Array<Moment>(),
      /** How many moments have been forgotten, so a keyframe's place stays where it was. */
      forgotten: 0,
      newest: watching.state.tick,
      /** Whether the host is going back to a state this rewind gave it, and its keyframes are cut to match already. */
      restoring: false,
    };
    const now = () => rewinding.played.length - 1;
    const playedBy = (index: number): Played =>
      rewinding.played[index] ??
      rewinding.played[now()] ?? { setup, toEntry: Recording.entryOf(setup.game) };

    /** Starts over from `state`, keeping nothing from before it. */
    const startFrom = (state: State.State) => {
      rewinding.forgotten += rewinding.moments.length;
      rewinding.moments = [];
      rewinding.keyframes = [{ state, at: rewinding.forgotten, played: now() }];
      rewinding.newest = state.tick;
    };

    /** Forgets what has grown older than it keeps, keyframe by keyframe. */
    const forget = () => {
      const kept = rewinding.keyframes.filter(
        ({ state }) => state.tick >= rewinding.newest - keepTicks,
      );
      const oldest = kept[0];
      if (oldest === undefined || kept.length === rewinding.keyframes.length) {
        return;
      }
      rewinding.moments = rewinding.moments.slice(oldest.at - rewinding.forgotten);
      rewinding.forgotten = oldest.at;
      rewinding.keyframes = kept;
    };

    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Reloaded') {
            const reloaded = setupOf(happening);
            rewinding.played.push({ setup: reloaded, toEntry: Recording.entryOf(reloaded.game) });
            rewinding.moments.push({ _tag: 'Reloaded', tick: happening.state.tick, played: now() });
            rewinding.keyframes.push({
              state: happening.state,
              at: rewinding.forgotten + rewinding.moments.length,
              played: now(),
            });
            rewinding.newest = happening.state.tick;
            return;
          }
          if (happening._tag === 'Restored') {
            if (rewinding.restoring) {
              rewinding.restoring = false;
            } else {
              startFrom(happening.state);
            }
            return;
          }
          const tick = happening._tag === 'Stepped' ? happening.state.tick : rewinding.newest;
          rewinding.moments.push({
            _tag: 'Entry',
            entry: playedBy(now()).toEntry(happening),
            tick,
          });
          rewinding.newest = tick;
          if (happening._tag === 'Stepped' && tick % options.every === 0) {
            rewinding.keyframes.push({
              state: happening.state,
              at: rewinding.forgotten + rewinding.moments.length,
              played: now(),
            });
            forget();
          }
        }),
      ),
      Effect.forkScoped,
    );

    /** Where the state was last at `tick`: a place among the moments, counting the state before the first. */
    const placeOf = (tick: number): Option.Option<number> => {
      const oldest = rewinding.keyframes[0];
      if (oldest === undefined || tick < oldest.state.tick || tick > rewinding.newest) {
        return Option.none();
      }
      const after = rewinding.moments.reduce<Option.Option<number>>(
        (found, moment, index) => (moment.tick === tick ? Option.some(index + 1) : found),
        Option.none(),
      );
      return Option.some(rewinding.forgotten + Option.getOrElse(after, () => 0));
    };

    /** The keyframe a place is come to from: the last at or before it. */
    const keyframeAt = (place: number) => rewinding.keyframes.findLast(({ at }) => at <= place);

    /** The entries between two places, which a reload never falls between, since a keyframe always follows one. */
    const entriesBetween = (from: number, to: number) =>
      rewinding.moments
        .slice(from - rewinding.forgotten, to - rewinding.forgotten)
        .flatMap((moment) => (moment._tag === 'Entry' ? [moment.entry] : []));

    /** The state at a place, by its keyframe, replayed by the build that played it. */
    const stateAtPlace = (place: number) =>
      Effect.gen(function* () {
        const keyframe = keyframeAt(place);
        if (keyframe === undefined) {
          return Option.none<State.State>();
        }
        const { taken, divergence } = yield* Replay.from(
          playedBy(keyframe.played).setup,
          keyframe.state,
          entriesBetween(keyframe.at, place),
        );
        // A game that does not replay cannot be gone back in; the replay beside the host says where.
        return Option.isSome(divergence)
          ? Option.none<State.State>()
          : Option.some(taken.at(-1)?.state ?? keyframe.state);
      });

    const stateAt = (tick: number) =>
      Option.match(placeOf(tick), {
        onNone: () => Effect.succeed(Option.none<State.State>()),
        onSome: stateAtPlace,
      });

    return {
      host,
      setup: Effect.sync(() => playedBy(now()).setup),
      between: (from, to) =>
        Effect.gen(function* () {
          const start = placeOf(from);
          const end = placeOf(to);
          if (Option.isNone(start) || Option.isNone(end)) {
            return Option.none();
          }
          // Cut at every reload in between: each stretch begins at the keyframe that follows one.
          const cuts = rewinding.keyframes
            .filter(
              ({ at }) =>
                at > start.value &&
                at <= end.value &&
                rewinding.moments[at - rewinding.forgotten - 1]?._tag === 'Reloaded',
            )
            .map(({ at }) => at);
          const bounds = [start.value, ...cuts, end.value];
          const stretches: Array<Stretch> = [];
          for (let index = 0; index + 1 < bounds.length; index++) {
            const [from, to] = [bounds[index] ?? 0, bounds[index + 1] ?? 0];
            const state = yield* stateAtPlace(from);
            const keyframe = keyframeAt(from);
            if (Option.isNone(state) || keyframe === undefined) {
              return Option.none();
            }
            stretches.push({
              setup: playedBy(keyframe.played).setup,
              state: state.value,
              // The last stretch ends at `to`; one before a reload ends where the reload came.
              entries: entriesBetween(from, index + 2 < bounds.length ? to - 1 : to),
            });
          }
          return Option.some(stretches);
        }),
      span: Effect.sync(() => ({
        oldest: rewinding.keyframes[0]?.state.tick ?? rewinding.newest,
        newest: rewinding.newest,
        reloads: rewinding.moments.flatMap((moment) =>
          moment._tag === 'Reloaded'
            ? [
                {
                  tick: moment.tick,
                  build: Option.fromNullishOr(playedBy(moment.played).setup.build),
                },
              ]
            : [],
        ),
      })),
      stateAt,
      playFrom: (tick) =>
        Effect.gen(function* () {
          const place = placeOf(tick);
          if (Option.isNone(place)) {
            return;
          }
          const keyframe = keyframeAt(place.value);
          if (keyframe !== undefined && keyframe.played !== now()) {
            return yield* new Earlier({
              reason: `tick ${tick} was played by an earlier build of the game, which no longer runs`,
            });
          }
          const state = yield* stateAtPlace(place.value);
          if (Option.isNone(state)) {
            return;
          }
          rewinding.moments = rewinding.moments.slice(0, place.value - rewinding.forgotten);
          rewinding.keyframes = rewinding.keyframes.filter(({ at }) => at <= place.value);
          rewinding.newest = tick;
          rewinding.restoring = true;
          yield* host.restore(state.value);
        }),
    };
  });

/** What a page asks of a rewind: to show a tick, or a tick so many steps from the one shown; to play on from the tick shown; or to go back to the live state. */
export const Control = Schema.Union([
  Schema.TaggedStruct('Seek', { tick: Schema.Int }),
  Schema.TaggedStruct('Step', { steps: Schema.Int }),
  Schema.TaggedStruct('PlayFromHere', {}),
  Schema.TaggedStruct('Live', {}),
]);
export type Control = typeof Control.Type;

/** Carries out the controls the host's clients send `rewind`, until the scope closes. */
export const serve = (host: Host.Host, rewind: Rewind): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const seeking = { shown: Option.none<number>() };
    const show = (tick: number) =>
      Effect.gen(function* () {
        const { oldest, newest } = yield* rewind.span;
        const within = Math.min(Math.max(tick, oldest), newest);
        const state = yield* rewind.stateAt(within);
        if (Option.isSome(state)) {
          seeking.shown = Option.some(within);
          yield* host.show(state.value);
        }
      });
    const carryOut = (control: Control) =>
      Effect.gen(function* () {
        switch (control._tag) {
          case 'Seek':
            return yield* show(control.tick);
          case 'Step': {
            const from = yield* Option.match(seeking.shown, {
              onNone: () => Effect.map(rewind.span, ({ newest }) => newest),
              onSome: Effect.succeed,
            });
            return yield* show(from + control.steps);
          }
          case 'PlayFromHere':
            if (Option.isSome(seeking.shown)) {
              yield* rewind.playFrom(seeking.shown.value);
              seeking.shown = Option.none();
            }
            return;
          case 'Live':
            if (Option.isSome(seeking.shown)) {
              seeking.shown = Option.none();
              yield* host.show(yield* host.state);
            }
            return;
        }
      });
    yield* host.controls.pipe(
      Stream.filterMap(({ payload }) => Schema.decodeUnknownResult(Control)(payload)),
      Stream.runForEach((control) =>
        carryOut(control).pipe(
          Effect.catch((refused) => Effect.logError('The game cannot be gone back in', refused)),
        ),
      ),
      Effect.forkScoped,
    );
  });

/** A page's way to drive a rewind beside the host it is joined to: it suspends time, and playing on or going live resumes it. */
export const controls = (client: Client.Client) => {
  const send = (control: Control) => client.control(Schema.encodeSync(Control)(control));
  return {
    suspend: client.suspend,
    seek: (tick: number) => send({ _tag: 'Seek', tick }),
    step: (steps: number) => send({ _tag: 'Step', steps }),
    playFromHere: Effect.andThen(send({ _tag: 'PlayFromHere' }), client.resume),
    live: Effect.andThen(send({ _tag: 'Live' }), client.resume),
  };
};
