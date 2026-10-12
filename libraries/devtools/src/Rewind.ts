import type { Client, Host, State } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Recording from '#src/Recording.ts';
import * as Replay from '#src/Replay.ts';

/**
 * Going back in a hosted game: the state the host was at, at any tick of a bounded span of time, shown to its clients through the same views while time is suspended, and played on from if asked. It keeps a keyframe, a state the host stepped to, every so many steps, and what happened after each, and comes to any tick by replaying from the keyframe before it, so a tick costs at most a few steps.
 *
 * It runs beside a host, in development; a page drives it with controls. When the host takes up a new build of its game, it starts over from there, since the past was played by another.
 */

export interface Options {
  /** How many steps apart keyframes are kept: fewer costs memory, more costs steps to come to a tick. */
  readonly every: number;
  /** How far back it keeps, in seconds of the game's time. */
  readonly keepSeconds: number;
}

/** A tick it may come back to, and how: from a keyframe, and the entries after it. */
interface Keyframe {
  readonly state: State.State;
  /** Where in the moments kept it stands: the moments after it are what came of it. */
  readonly at: number;
}

/** Something that happened to the host's state, and the tick the state was at after it. */
interface Moment {
  readonly entry: Recording.Entry;
  readonly tick: number;
}

export interface Rewind {
  /** The oldest and newest ticks it can come back to. */
  readonly span: Effect.Effect<{ readonly oldest: number; readonly newest: number }>;
  /** The state the host was at, at `tick`, if it keeps that tick. */
  readonly stateAt: (tick: number) => Effect.Effect<Option.Option<State.State>, Replay.Unreadable>;
  /** The state at `from`, and everything that happened after it up to the state at `to`, if it keeps both. */
  readonly between: (
    from: number,
    to: number,
  ) => Effect.Effect<
    Option.Option<{
      readonly state: State.State;
      readonly entries: ReadonlyArray<Recording.Entry>;
    }>,
    Replay.Unreadable
  >;
  /** The build of the game it goes back in now. */
  readonly setup: Effect.Effect<Replay.Setup>;
  /** Goes back to the state at `tick` and plays on from it: what came after it is gone. */
  readonly playFrom: (tick: number) => Effect.Effect<void, Replay.Unreadable>;
  readonly host: Host.Host;
}

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
      /** The build played now, which every tick kept is gone back to with. */
      setup,
      toEntry: Recording.entryOf(setup.game),
      keyframes: [{ state: watching.state, at: 0 }] satisfies Array<Keyframe>,
      moments: new Array<Moment>(),
      /** How many moments have been forgotten, so a keyframe's place stays where it was. */
      forgotten: 0,
      newest: watching.state.tick,
      /** Whether the host is going back to a state this rewind gave it, and its keyframes are cut to match already. */
      restoring: false,
    };

    /** Starts over from `state`, keeping nothing from before it. */
    const startFrom = (state: State.State) => {
      rewinding.forgotten += rewinding.moments.length;
      rewinding.moments = [];
      rewinding.keyframes = [{ state, at: rewinding.forgotten }];
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
            rewinding.setup = {
              game: happening.game,
              join: happening.join,
              leave: happening.leave,
            };
            rewinding.toEntry = Recording.entryOf(happening.game);
            startFrom(happening.state);
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
          rewinding.moments.push({ entry: rewinding.toEntry(happening), tick });
          rewinding.newest = tick;
          if (happening._tag === 'Stepped' && tick % options.every === 0) {
            rewinding.keyframes.push({
              state: happening.state,
              at: rewinding.forgotten + rewinding.moments.length,
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

    const stateAt = (tick: number) =>
      Effect.gen(function* () {
        const place = placeOf(tick);
        if (Option.isNone(place)) {
          return Option.none<State.State>();
        }
        const keyframe = rewinding.keyframes.findLast(({ at }) => at <= place.value);
        if (keyframe === undefined) {
          return Option.none<State.State>();
        }
        const entries = rewinding.moments
          .slice(keyframe.at - rewinding.forgotten, place.value - rewinding.forgotten)
          .map(({ entry }) => entry);
        const { taken, divergence } = yield* Replay.from(rewinding.setup, keyframe.state, entries);
        // A game that does not replay cannot be gone back in; the replay beside the host says where.
        return Option.isSome(divergence)
          ? Option.none<State.State>()
          : Option.some(taken.at(-1)?.state ?? keyframe.state);
      });

    return {
      host,
      setup: Effect.sync(() => rewinding.setup),
      between: (from, to) =>
        Effect.gen(function* () {
          const state = yield* stateAt(from);
          const start = placeOf(from);
          const end = placeOf(to);
          if (Option.isNone(state) || Option.isNone(start) || Option.isNone(end)) {
            return Option.none();
          }
          return Option.some({
            state: state.value,
            entries: rewinding.moments
              .slice(start.value - rewinding.forgotten, end.value - rewinding.forgotten)
              .map(({ entry }) => entry),
          });
        }),
      span: Effect.sync(() => ({
        oldest: rewinding.keyframes[0]?.state.tick ?? rewinding.newest,
        newest: rewinding.newest,
      })),
      stateAt,
      playFrom: (tick) =>
        Effect.gen(function* () {
          const state = yield* stateAt(tick);
          const place = placeOf(tick);
          if (Option.isNone(state) || Option.isNone(place)) {
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
          Effect.catch((unreadable) =>
            Effect.logError('The game cannot be gone back in', unreadable),
          ),
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
