import { type Client, Pointing, State } from '@egonitida/core';
import { Effect, Option, type Scope, Stream } from 'effect';
import type * as Three from 'three/webgpu';
import type * as View from '#src/View.ts';

/**
 * Clicks on a canvas, as the game's `Pointing.Clicked`: each click finds the entity whose object is nearest under the pointer, and if that entity has a `Label`, the client takes the action for it. One with no label takes the click and does nothing, as anything in front of what a player meant does.
 */

/** A point of the screen, from -1 to 1 across it and up it. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Acts every click of `clicks` on the labelled entity under it, seen through `camera` as `views` drew it, until the scope closes. */
export const serve = (options: {
  readonly clicks: Stream.Stream<Point>;
  readonly camera: Three.Camera;
  readonly views: Pick<View.Views<never>, 'pick'>;
  readonly client: Pick<Client.Client, 'state' | 'act'>;
}): Effect.Effect<void, never, Scope.Scope> =>
  options.clicks.pipe(
    Stream.runForEach((point) =>
      Option.match(options.views.pick(options.camera, point), {
        onNone: () => Effect.void,
        onSome: ({ entity }) =>
          Effect.flatMap(options.client.state, (state) =>
            Option.isSome(State.get(state, entity, Pointing.Label))
              ? options.client.act(Pointing.Clicked, { entity })
              : Effect.void,
          ),
      }),
    ),
    Effect.forkScoped,
    Effect.asVoid,
  );
