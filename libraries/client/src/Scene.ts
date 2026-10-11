import type { World } from '@lightocean/core';
import { Effect, Option, type Scope } from 'effect';
import type * as Three from 'three/webgpu';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

/**
 * A test told through a game's views: worlds shown one frame each, as a client draws them, with no renderer, canvas, or browser. What the views drew is found by view and entity, never by walking the scene graph; what they put out that is not drawn, such as a sound, goes through services, which a test gives as Layers that record.
 *
 * A world to show comes from wherever a test has one, such as where a story ended.
 */
export interface Scene<R = never> {
  /** Everything the views drew. */
  readonly root: Three.Group;
  /** Draws `world` as the next frame. */
  readonly show: (world: World.World) => Effect.Effect<void, never, R>;
  /** What `view` drew for `entity` in the last frame shown, if anything. */
  readonly find: View.Views<R>['find'];
}

/** A scene drawn through `views`, until the scope closes. */
export const make = <R = never>(
  views: ReadonlyArray<View.View<R>>,
): Effect.Effect<Scene<Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const working = yield* View.make(views);
    const state = { previous: Option.none<Timeline.View>() };
    return {
      root: working.root,
      show: (world) =>
        Effect.suspend(() => {
          const view = Timeline.still(world);
          const frame = Drawing.frameOf(view, state.previous);
          state.previous = Option.some(view);
          return working.frame(frame);
        }),
      find: working.find,
    };
  });
