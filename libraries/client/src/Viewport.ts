import { Data, Effect, Option, Queue, type Scope } from 'effect';
import * as Three from 'three/webgpu';

/**
 * A game's world drawn onto a canvas by a `WebGPURenderer`: a scene to put views' objects in, a camera, and a loop that draws a frame at every frame the display shows. It lives in the browser only.
 *
 * Time comes from the display: each frame is told the time between the moments the display showed this frame and the one before, never when code happens to run.
 */
export interface Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly scene: Three.Scene;
  readonly camera: Three.PerspectiveCamera;
  /** Draws the scene as it is now. */
  readonly render: Effect.Effect<void>;
  /** Runs `frame` with the seconds since the frame before, at every frame the display shows, then draws the scene; until the scope closes. */
  readonly loop: <R>(
    frame: (seconds: number) => Effect.Effect<void, never, R>,
  ) => Effect.Effect<void, never, R | Scope.Scope>;
}

export class ViewportError extends Data.TaggedError('ViewportError')<{
  readonly reason: string;
}> {}

/** The longest a frame is told passed: a tab in the background comes back to a short step, not a leap. */
const LONGEST_FRAME = 0.25;

/** The seconds between the display's moment for the frame before, if there was one, and for this one: never less than none, never more than a short step. */
export const secondsBetween = (previous: Option.Option<number>, now: number): number =>
  Option.match(previous, {
    onNone: () => 0,
    onSome: (then) => Math.min(Math.max((now - then) / 1000, 0), LONGEST_FRAME),
  });

const startRenderer = (canvas: HTMLCanvasElement) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const renderer = new Three.WebGPURenderer({ canvas, antialias: true });
        await renderer.init();
        return renderer;
      },
      catch: (cause) =>
        new ViewportError({
          reason: cause instanceof Error ? cause.message : 'The renderer failed to start.',
        }),
    }),
    (renderer) => Effect.promise(() => renderer.dispose()),
  );

export const make = (
  canvas: HTMLCanvasElement,
): Effect.Effect<Viewport, ViewportError, Scope.Scope> =>
  Effect.gen(function* () {
    const renderer = yield* startRenderer(canvas);
    const scene = new Three.Scene();
    const camera = new Three.PerspectiveCamera();

    const fit = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    fit();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const observer = new ResizeObserver(fit);
        observer.observe(canvas);
        return observer;
      }),
      (observer) => Effect.sync(() => observer.disconnect()),
    );

    const render = Effect.sync(() => renderer.render(scene, camera));

    const loop = <R>(frame: (seconds: number) => Effect.Effect<void, never, R>) =>
      Effect.gen(function* () {
        // The display's moment for each frame, newest only: a frame not yet drawn when the next comes is skipped.
        const shown = yield* Queue.sliding<number>(1);
        yield* Effect.acquireRelease(
          Effect.promise(() =>
            renderer.setAnimationLoop((time) => {
              Queue.offerUnsafe(shown, time);
            }),
          ),
          () => Effect.promise(() => renderer.setAnimationLoop(null)),
        );
        const state = { previous: Option.none<number>() };
        yield* Effect.gen(function* () {
          const now = yield* Queue.take(shown);
          const seconds = secondsBetween(state.previous, now);
          state.previous = Option.some(now);
          yield* frame(seconds);
          yield* render;
        }).pipe(Effect.forever, Effect.forkScoped);
      });

    return { canvas, scene, camera, render, loop };
  });
