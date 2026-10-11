import type { Client, Host, World } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Recording from '#src/Recording.ts';
import * as Replay from '#src/Replay.ts';

/**
 * Going back in a hosted game: the world the host was at, at any tick of a bounded span of time, shown to its clients through the same views while time is held, and played on from if asked. It keeps a keyframe, a world the host stepped to, every so many steps, and what happened after each, and comes to any tick by replaying from the keyframe before it, so a tick costs at most a few steps.
 *
 * It runs beside a host, in development; a page drives it with controls. When the host takes up a new build of its game, it starts over from there, since the past was played by another.
 */

export interface Options {
  /** How many steps apart keyframes are kept: fewer costs memory, more costs steps to come to a tick. */
  readonly every: number;
  /** How far back it keeps, in seconds of the world's time. */
  readonly keepSeconds: number;
}

/** A tick it may come back to, and how: from a keyframe, and the entries after it. */
interface Keyframe {
  readonly world: World.World;
  /** Where in the moments kept it stands: the moments after it are what came of it. */
  readonly at: number;
}

/** Something that happened to the host's world, and the tick the world was at after it. */
interface Moment {
  readonly entry: Recording.Entry;
  readonly tick: number;
}

export interface Rewind {
  /** The oldest and newest ticks it can come back to. */
  readonly span: Effect.Effect<{ readonly oldest: number; readonly newest: number }>;
  /** The world the host was at, at `tick`, if it keeps that tick. */
  readonly worldAt: (tick: number) => Effect.Effect<Option.Option<World.World>, Replay.Unreadable>;
  /** Goes back to the world at `tick` and plays on from it: what came after it is gone. */
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
    const state = {
      /** The build played now, which every tick kept is gone back to with. */
      setup,
      toEntry: Recording.entryOf(setup.game),
      keyframes: [{ world: watching.world, at: 0 }] satisfies Array<Keyframe>,
      moments: new Array<Moment>(),
      /** How many moments have been forgotten, so a keyframe's place stays where it was. */
      forgotten: 0,
      newest: watching.world.tick,
      /** Whether the host is going back to a world this rewind gave it, and its keyframes are cut to match already. */
      restoring: false,
    };

    /** Starts over from `world`, keeping nothing from before it. */
    const startFrom = (world: World.World) => {
      state.forgotten += state.moments.length;
      state.moments = [];
      state.keyframes = [{ world, at: state.forgotten }];
      state.newest = world.tick;
    };

    /** Forgets what has grown older than it keeps, keyframe by keyframe. */
    const forget = () => {
      const kept = state.keyframes.filter(({ world }) => world.tick >= state.newest - keepTicks);
      const oldest = kept[0];
      if (oldest === undefined || kept.length === state.keyframes.length) {
        return;
      }
      state.moments = state.moments.slice(oldest.at - state.forgotten);
      state.forgotten = oldest.at;
      state.keyframes = kept;
    };

    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Reloaded') {
            state.setup = { game: happening.game, join: happening.join, leave: happening.leave };
            state.toEntry = Recording.entryOf(happening.game);
            startFrom(happening.world);
            return;
          }
          if (happening._tag === 'Restored') {
            if (state.restoring) {
              state.restoring = false;
            } else {
              startFrom(happening.world);
            }
            return;
          }
          const tick = happening._tag === 'Stepped' ? happening.world.tick : state.newest;
          state.moments.push({ entry: state.toEntry(happening), tick });
          state.newest = tick;
          if (happening._tag === 'Stepped' && tick % options.every === 0) {
            state.keyframes.push({
              world: happening.world,
              at: state.forgotten + state.moments.length,
            });
            forget();
          }
        }),
      ),
      Effect.forkScoped,
    );

    /** Where the world was last at `tick`: a place among the moments, counting the world before the first. */
    const placeOf = (tick: number): Option.Option<number> => {
      const oldest = state.keyframes[0];
      if (oldest === undefined || tick < oldest.world.tick || tick > state.newest) {
        return Option.none();
      }
      const after = state.moments.reduce<Option.Option<number>>(
        (found, moment, index) => (moment.tick === tick ? Option.some(index + 1) : found),
        Option.none(),
      );
      return Option.some(state.forgotten + Option.getOrElse(after, () => 0));
    };

    const worldAt = (tick: number) =>
      Effect.gen(function* () {
        const place = placeOf(tick);
        if (Option.isNone(place)) {
          return Option.none<World.World>();
        }
        const keyframe = state.keyframes.findLast(({ at }) => at <= place.value);
        if (keyframe === undefined) {
          return Option.none<World.World>();
        }
        const entries = state.moments
          .slice(keyframe.at - state.forgotten, place.value - state.forgotten)
          .map(({ entry }) => entry);
        const { taken, divergence } = yield* Replay.from(state.setup, keyframe.world, entries);
        // A game that does not replay cannot be gone back in; the replay beside the host says where.
        return Option.isSome(divergence)
          ? Option.none<World.World>()
          : Option.some(taken.at(-1)?.world ?? keyframe.world);
      });

    return {
      host,
      span: Effect.sync(() => ({
        oldest: state.keyframes[0]?.world.tick ?? state.newest,
        newest: state.newest,
      })),
      worldAt,
      playFrom: (tick) =>
        Effect.gen(function* () {
          const world = yield* worldAt(tick);
          const place = placeOf(tick);
          if (Option.isNone(world) || Option.isNone(place)) {
            return;
          }
          state.moments = state.moments.slice(0, place.value - state.forgotten);
          state.keyframes = state.keyframes.filter(({ at }) => at <= place.value);
          state.newest = tick;
          state.restoring = true;
          yield* host.restore(world.value);
        }),
    };
  });

/** What a page asks of a rewind: to show a tick, or a tick so many steps from the one shown; to play on from the tick shown; or to go back to the live world. */
export const Control = Schema.Union([
  Schema.TaggedStruct('Seek', { tick: Schema.Int }),
  Schema.TaggedStruct('Step', { steps: Schema.Int }),
  Schema.TaggedStruct('PlayFromHere', {}),
  Schema.TaggedStruct('Live', {}),
]);
export type Control = typeof Control.Type;

/** Answers the controls the host's clients send `rewind`, until the scope closes. */
export const serve = (host: Host.Host, rewind: Rewind): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = { shown: Option.none<number>() };
    const show = (tick: number) =>
      Effect.gen(function* () {
        const { oldest, newest } = yield* rewind.span;
        const within = Math.min(Math.max(tick, oldest), newest);
        const world = yield* rewind.worldAt(within);
        if (Option.isSome(world)) {
          state.shown = Option.some(within);
          yield* host.show(world.value);
        }
      });
    const answer = (control: Control) =>
      Effect.gen(function* () {
        switch (control._tag) {
          case 'Seek':
            return yield* show(control.tick);
          case 'Step': {
            const from = yield* Option.match(state.shown, {
              onNone: () => Effect.map(rewind.span, ({ newest }) => newest),
              onSome: Effect.succeed,
            });
            return yield* show(from + control.steps);
          }
          case 'PlayFromHere':
            if (Option.isSome(state.shown)) {
              yield* rewind.playFrom(state.shown.value);
              state.shown = Option.none();
            }
            return;
          case 'Live':
            if (Option.isSome(state.shown)) {
              state.shown = Option.none();
              yield* host.show(yield* host.world);
            }
            return;
        }
      });
    yield* host.controls.pipe(
      Stream.filterMap(({ payload }) => Schema.decodeUnknownResult(Control)(payload)),
      Stream.runForEach((control) =>
        answer(control).pipe(
          Effect.catch((unreadable) =>
            Effect.logError('The game cannot be gone back in', unreadable),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  });

/** A page's way to drive a rewind beside the host it is joined to: pausing holds time, and playing on or going live lets go of it. */
export const controls = (client: Client.Client) => {
  const send = (control: Control) => client.control(Schema.encodeSync(Control)(control));
  return {
    pause: client.hold,
    seek: (tick: number) => send({ _tag: 'Seek', tick }),
    step: (steps: number) => send({ _tag: 'Step', steps }),
    playFromHere: Effect.andThen(send({ _tag: 'PlayFromHere' }), client.release),
    live: Effect.andThen(send({ _tag: 'Live' }), client.release),
  };
};
