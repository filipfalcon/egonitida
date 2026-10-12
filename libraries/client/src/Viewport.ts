import { Data, Effect, Option, Queue, type Scope, Stream } from 'effect';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import {
  builtinAOContext,
  unpackRGBToNormal,
  packNormalToRGB,
  mrt,
  normalView,
  pass,
  rtt,
  sample,
  screenUV,
} from 'three/tsl';
import * as Three from 'three/webgpu';

/**
 * A game's state drawn onto a canvas by a `WebGPURenderer`: a scene to put views' objects in, a camera, and a loop that draws a frame at every frame the display shows. It lives in the browser only.
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

/** Ambient occlusion: the ambient light darkened where surfaces close in on each other, in creases, corners, and beneath what stands on the ground, which grounds objects in the scene. Only the ambient light is darkened; direct light and its shadows are left as they are. */
export interface Occlusion {
  /** How far, in the scene's units, a surface darkens the ambient light reaching what lies near it. */
  readonly radius: number;
  /** How dark it makes it: 0 not at all, 1 as dark as it works out, and more darker still. */
  readonly strength: number;
  /** The share of the canvas's resolution it is worked out at, from a tenth to all of it: half is enough for most scenes, at a quarter of the cost. */
  readonly resolution: number;
}

/** Ambient occlusion as told, the rest as most scenes want it: shading what lies within half a unit, at full strength, worked out at half the resolution. */
export const occlusion = (told: Partial<Occlusion> = {}): Occlusion => ({
  radius: Math.max(told.radius ?? 0.5, 0),
  strength: Math.max(told.strength ?? 1, 0),
  resolution: Math.min(Math.max(told.resolution ?? 0.5, 0.1), 1),
});

/** How a viewport draws: with ambient occlusion, if given. */
export interface Options {
  readonly occlusion: Option.Option<Occlusion>;
}

/** Draws `scene` from `camera` with ambient occlusion: first its depth and its normals alone, from which the occlusion is worked out and then smoothed, then the scene itself, its ambient light darkened by it. */
const occluded = (
  renderer: Three.WebGPURenderer,
  scene: Three.Scene,
  camera: Three.PerspectiveCamera,
  told: Occlusion,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      // One sample a pixel: the occlusion reads the depth as it is, which it cannot from a smoothed one.
      const shapes = pass(scene, camera, { samples: 0 });
      shapes.transparent = false;
      shapes.setMRT(mrt({ output: packNormalToRGB(normalView) }));
      // Normals need no more than a byte each.
      shapes.getTexture('output').type = Three.UnsignedByteType;
      const normals = sample((uv) => unpackRGBToNormal(shapes.getTextureNode().sample(uv)));
      const shade = ao(shapes.getTextureNode('depth'), normals, camera);
      shade.resolutionScale = told.resolution;
      shade.radius.value = told.radius;
      shade.scale.value = told.strength;
      // Worked out from a few samples a pixel, at a share of the resolution, the occlusion is noisy and coarse: it is smoothed and brought to the whole resolution along the surfaces it lies on, never across an edge between them, once a frame.
      const smoothed = denoise(
        shade.getTextureNode(),
        shapes.getTextureNode('depth'),
        normals,
        camera,
      );
      const smooth = rtt(smoothed);
      const lit = pass(scene, camera);
      lit.contextNode = builtinAOContext(smooth.sample(screenUV).r);
      const pipeline = new Three.RenderPipeline(renderer, lit);
      return Object.assign(pipeline, { shade, smoothed, smooth });
    }),
    (pipeline) =>
      Effect.sync(() => {
        pipeline.smooth.dispose();
        pipeline.smoothed.dispose();
        pipeline.shade.dispose();
        pipeline.dispose();
      }),
  );

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

/** A viewport drawing onto `canvas`, as `options` tell it to: with no ambient occlusion unless given. */
export const make = (
  canvas: HTMLCanvasElement,
  options: Options = { occlusion: Option.none() },
): Effect.Effect<Viewport, ViewportError, Scope.Scope> =>
  Effect.gen(function* () {
    const renderer = yield* startRenderer(canvas);
    const scene = new Three.Scene();
    const camera = new Three.PerspectiveCamera();
    const pipeline = yield* Option.match(options.occlusion, {
      onNone: () => Effect.succeed(Option.none<Three.RenderPipeline>()),
      onSome: (told) => Effect.asSome(occluded(renderer, scene, camera, told)),
    });
    const draw = () =>
      Option.match(pipeline, {
        onNone: () => renderer.render(scene, camera),
        onSome: (drawn) => drawn.render(),
      });

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

    const render = Effect.sync(draw);
    // Whether the loop has drawn a frame yet, before which a shot would show nothing of the state.
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
        const clock = { previous: Option.none<number>() };
        yield* Effect.gen(function* () {
          const now = yield* Queue.take(shown);
          const seconds = secondsBetween(clock.previous, now);
          clock.previous = Option.some(now);
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
        draw();
        return shot(canvas, width);
      });

    return { canvas, scene, camera, clicks, render, capture, loop };
  });
