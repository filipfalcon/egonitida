import type { World } from '@lightocean/core';
import { Effect, Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

/**
 * A test told through a game's views: worlds shown one frame each, as a client draws them, with no renderer, canvas, or browser. What the views drew is found by view and entity, never by walking the scene graph, and what a click would find, by a point of the screen; what they put out that is not drawn, such as a sound, goes through services, which a test gives as Layers that record.
 *
 * A world to show comes from wherever a test has one, such as where a story ended.
 */
export interface Scene<R = never> {
  /** Everything the views drew. */
  readonly root: Three.Group;
  /** The camera the views' rigs draw for the player, as a client's would. */
  readonly camera: Three.PerspectiveCamera;
  /** Draws `world` as the next frame. */
  readonly show: (world: World.World) => Effect.Effect<void, never, R>;
  /** What `view` drew for `entity` in the last frame shown, if anything. */
  readonly find: View.Views<R>['find'];
  /** What is under a point of the screen, seen through a camera, in the last frame shown, as a click would find it. */
  readonly pick: View.Views<R>['pick'];
}

/** A scene drawn through `views`, until the scope closes, with its camera drawn by their rigs for `player`, if there is one. */
export const make = <R = never>(
  views: ReadonlyArray<View.View<R>>,
  player: Option.Option<World.Entity> = Option.none(),
): Effect.Effect<Scene<Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const camera = new Three.PerspectiveCamera();
    const working = yield* View.make(
      views,
      Option.map(player, (entity) => ({ camera, player: entity })),
    );
    const state = { previous: Option.none<Timeline.View>() };
    return {
      root: working.root,
      camera,
      show: (world) =>
        Effect.suspend(() => {
          const view = Timeline.still(world);
          const frame = Drawing.frameOf(view, state.previous);
          state.previous = Option.some(view);
          return working.frame(frame);
        }),
      find: working.find,
      pick: working.pick,
    };
  });
