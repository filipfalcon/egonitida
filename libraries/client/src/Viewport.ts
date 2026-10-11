import { Data, Effect, Option, Queue, type Scope, Stream } from 'effect';
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
  /** Every click on the canvas from now on, as a point of the screen, from -1 to 1 across it and up it. */
  readonly clicks: Stream.Stream<{ readonly x: number; readonly y: number }>;
  /** Draws the scene as it is now. */
  readonly render: Effect.Effect<void>;
  /** Draws the scene as it is now and takes a shot of it: a PNG, as base64, at most `width` pixels across if given, and its size; for showing a tool what a person sees. */
  readonly capture: (
    width: Option.Option<number>,
  ) => Effect.Effect<
    { readonly png: string; readonly width: number; readonly height: number },
    ViewportError
  >;
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

/** A shot of what `canvas` holds now, as a PNG in base64, at most `width` pixels across if given, over the canvas's own background as the page styles it. A canvas holds what was drawn only until the task that drew it ends, so a shot is taken in the same task as the drawing: for a page that draws with a renderer of its own rather than a viewport. */
export const shot = (
  canvas: HTMLCanvasElement,
  width: Option.Option<number>,
): Effect.Effect<
  { readonly png: string; readonly width: number; readonly height: number },
  ViewportError
> =>
  Effect.suspend(() => {
    const scale = Option.match(width, {
      onNone: () => 1,
      onSome: (most) => Math.min(1, most / Math.max(canvas.width, 1)),
    });
    const taken = document.createElement('canvas');
    taken.width = Math.max(1, Math.round(canvas.width * scale));
    taken.height = Math.max(1, Math.round(canvas.height * scale));
    const drawing = taken.getContext('2d');
    if (drawing === null) {
      return Effect.fail(new ViewportError({ reason: 'A shot cannot be drawn here.' }));
    }
    // What shows through where nothing is drawn is the canvas's own background, as the page styles it.
    drawing.fillStyle = getComputedStyle(canvas).backgroundColor;
    drawing.fillRect(0, 0, taken.width, taken.height);
    drawing.drawImage(canvas, 0, 0, taken.width, taken.height);
    const url = taken.toDataURL('image/png');
    return Effect.succeed({
      png: url.slice(url.indexOf(',') + 1),
      width: taken.width,
      height: taken.height,
    });
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

/** Where a pointer at `pointer` is on a canvas at `canvas`, from -1 to 1 across it and up it, as Three.js's normalized device coordinates run. */
export const pointOf = (
  pointer: { readonly clientX: number; readonly clientY: number },
  canvas: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
) => ({
  x: ((pointer.clientX - canvas.left) / canvas.width) * 2 - 1,
  y: 1 - ((pointer.clientY - canvas.top) / canvas.height) * 2,
});

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
    // Whether the loop has drawn a frame yet, before which a shot would show nothing of the world.
    const drawn = { once: false };

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
          drawn.once = true;
        }).pipe(Effect.forever, Effect.forkScoped);
      });

    // A click is a press of the primary button, or a touch, on the canvas.
    const clicks = Stream.callback<{ readonly x: number; readonly y: number }>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = (event: PointerEvent) => {
            if (event.button === 0) {
              Queue.offerUnsafe(queue, pointOf(event, canvas.getBoundingClientRect()));
            }
          };
          canvas.addEventListener('pointerdown', listener);
          return listener;
        }),
        (listener) => Effect.sync(() => canvas.removeEventListener('pointerdown', listener)),
      ),
    );

    // The canvas holds what was drawn only until the task that drew it ends, so the shot is taken in the same task.
    const capture = (width: Option.Option<number>) =>
      Effect.suspend(() => {
        if (!drawn.once) {
          return Effect.fail(
            new ViewportError({
              reason: 'Nothing has been drawn yet: the page is still starting.',
            }),
          );
        }
        renderer.render(scene, camera);
        return shot(canvas, width);
      });

    return { canvas, scene, camera, clicks, render, capture, loop };
  });
