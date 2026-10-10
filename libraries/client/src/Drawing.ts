import type { Client, World } from '@lightocean/core';
import { Effect, Option, type Scope, Stream } from 'effect';
import * as Timeline from '#src/Timeline.ts';

/**
 * What a client draws from, frame by frame: its timeline, fed with every world the client receives. Code that draws, such as a renderer or a game's own imperative code during a migration, reads the world from here and never writes to it.
 *
 * Taking a frame is plain synchronous work, called once per displayed frame: no Effect runs per frame.
 */

/** What to draw this frame, and which entities came into the drawing or left it since the last frame, so whatever stands for them can be made or put away. */
export interface View extends Timeline.View {
  readonly entered: ReadonlyArray<World.Entity>;
  readonly left: ReadonlyArray<World.Entity>;
}

export interface Drawing {
  /** Moves drawing on by `seconds` of real time and returns what to draw; called once a frame. */
  readonly frame: (seconds: number) => Option.Option<View>;
  /** Plays the past from `from`, in seconds of the world's time, at `rate` times real time, until `live`. */
  readonly present: (options: { readonly from: number; readonly rate: number }) => void;
  /** Returns drawing to the live world. */
  readonly live: () => void;
}

export const make = (
  client: Client.Client,
  options: { readonly keepSeconds: number },
): Effect.Effect<Drawing, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = {
      timeline: Timeline.make({ stepRate: client.stepRate, keepSeconds: options.keepSeconds }),
      /** The entities the last frame drew. */
      drawn: new Set<World.Entity>(),
    };
    yield* client.worlds.pipe(
      Stream.runForEach((world) =>
        Effect.sync(() => {
          state.timeline = Timeline.receive(state.timeline, world);
        }),
      ),
      Effect.forkScoped,
    );
    return {
      frame: (seconds) => {
        state.timeline = Timeline.advance(state.timeline, seconds);
        return Option.map(Timeline.view(state.timeline), (view) => {
          const now = new Set(view.entities);
          const entered = view.entities.filter((entity) => !state.drawn.has(entity));
          const left = [...state.drawn].filter((entity) => !now.has(entity));
          state.drawn = now;
          return { ...view, entered, left };
        });
      },
      present: (presentation) => {
        state.timeline = Timeline.present(state.timeline, presentation);
      },
      live: () => {
        state.timeline = Timeline.live(state.timeline);
      },
    };
  });
