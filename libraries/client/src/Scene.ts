import type { State } from '@egonitida/core';
import { Effect, Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

/**
 * A test told through a game's views: states shown one frame each, as a client draws them, with no renderer, canvas, or browser. What the views drew is found by view and entity, never by walking the scene graph, and what a click would find, by a point of the screen; what they put out that is not drawn, such as a sound, goes through services, which a test gives as Layers that record.
 *
 * A state to show comes from wherever a test has one, such as where a story ended.
 */
export interface Scene<R = never> {
  /** Everything the views drew. */
  readonly root: Three.Group;
  /** The camera the views' rigs draw for the player, as a client's would. */
  readonly camera: Three.PerspectiveCamera;
  /** Draws `state` as the next frame. */
  readonly show: (state: State.State) => Effect.Effect<void, never, R>;
  /** What `view` drew for `entity` in the last frame shown, if anything. */
  readonly find: View.Views<R>['find'];
  /** What a view of the whole frame drew in the last frame shown, if it has drawn one. */
  readonly whole: View.Views<R>['whole'];
  /** What is under a point of the screen, seen through a camera, in the last frame shown, as a click would find it. */
  readonly pick: View.Views<R>['pick'];
}

/** A scene drawn through `views`, until the scope closes, with its camera drawn by their rigs for `player`, if there is one, and the drawing's input as `input` gives it, if they read one: such as through whose eyes the player looks, which a test says without putting anything in the state. */
export function make<const Given extends ReadonlyArray<View.View<unknown, undefined>>>(
  views: Given,
  player?: Option.Option<State.Entity>,
): Effect.Effect<
  Scene<Exclude<View.NeedsOf<Given>, Scope.Scope>>,
  never,
  View.NeedsOf<Given> | Scope.Scope
>;
export function make<const Given extends ReadonlyArray<View.View<unknown, V>>, V>(
  views: Given,
  player: Option.Option<State.Entity>,
  input: () => V,
): Effect.Effect<
  Scene<Exclude<View.NeedsOf<Given>, Scope.Scope>>,
  never,
  View.NeedsOf<Given> | Scope.Scope
>;
export function make<R, V>(
  views: ReadonlyArray<View.View<R, V | undefined>>,
  player: Option.Option<State.Entity> = Option.none(),
  input: () => V | undefined = () => undefined,
): Effect.Effect<Scene<Exclude<R, Scope.Scope>>, never, R | Scope.Scope> {
  return Effect.gen(function* () {
    const camera = new Three.PerspectiveCamera();
    const working = yield* View.make(
      views,
      Option.map(player, (entity) => ({ camera, player: entity })),
      input,
    );
    const seen = { previous: Option.none<Timeline.View>() };
    return {
      root: working.root,
      camera,
      show: (state) =>
        Effect.suspend(() => {
          const view = Timeline.still(state);
          const frame = Drawing.frameOf(view, seen.previous);
          seen.previous = Option.some(view);
          return working.frame(frame);
        }),
      find: working.find,
      whole: working.whole,
      pick: working.pick,
    };
  });
}
