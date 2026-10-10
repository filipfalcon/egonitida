import { Data, Effect, type Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import type * as Scene from '#src/Scene.ts';
import * as SceneHost from '#src/SceneHost.ts';

/**
 * A `SceneHost` drawn onto a canvas by a `WebGPURenderer`. It lives in the browser only: everything it adds over the host is the renderer, the canvas, and the conversion from the page's coordinates into the scene's.
 */
export interface Viewport<Message> {
  readonly canvas: HTMLCanvasElement;
  /** Draws one frame: reconciles `scene` if it differs from the last one drawn, advances motion by `seconds`, and renders. */
  readonly frame: (scene: Scene.Scene<Message>, seconds: number) => Effect.Effect<void>;
  /** The Message of the nearest clickable object under a point on the page. */
  readonly pick: (point: ClientPoint) => Effect.Effect<Option.Option<Message>>;
}

export class ViewportError extends Data.TaggedError('ViewportError')<{
  readonly reason: string;
}> {}

/** Where an element sits on the page, as `getBoundingClientRect` reports it. */
export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A point on the page, as pointer events report it. */
export interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export const toPointer = (bounds: Bounds, point: ClientPoint): SceneHost.Pointer => ({
  x: ((point.clientX - bounds.left) / bounds.width) * 2 - 1,
  y: 1 - ((point.clientY - bounds.top) / bounds.height) * 2,
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

export const make = <Message>(
  canvas: HTMLCanvasElement,
): Effect.Effect<Viewport<Message>, ViewportError, Scope.Scope> =>
  Effect.gen(function* () {
    const host = yield* SceneHost.make<Message>();
    const renderer = yield* startRenderer(canvas);

    const fit = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height, false);
      host.camera.aspect = width / height;
      host.camera.updateProjectionMatrix();
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

    const state: { drawn: Scene.Scene<Message> | undefined } = { drawn: undefined };

    const frame = (scene: Scene.Scene<Message>, seconds: number) =>
      Effect.gen(function* () {
        // A Model change produces a new scene; between changes the same one is handed back every frame, so identity is enough to skip reconciling.
        if (scene !== state.drawn) {
          yield* host.render(scene);
          state.drawn = scene;
        }
        yield* host.step(seconds);
        renderer.render(host.root, host.camera);
      });

    const pick = (point: ClientPoint) =>
      host.pick(toPointer(canvas.getBoundingClientRect(), point));

    return { canvas, frame, pick };
  });
