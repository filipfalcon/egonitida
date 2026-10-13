import { Data, Deferred, Effect, Option, Queue, type Scope, Stream } from 'effect';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import SSAAPassNode from 'three/addons/tsl/display/SSAAPassNode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import {
  builtinAOContext,
  unpackRGBToNormal,
  packNormalToRGB,
  mrt,
  normalView,
  output,
  pass,
  rtt,
  sample,
  screenUV,
  velocity,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as Antialiasing from '#src/Antialiasing.ts';

/**
 * A game's state drawn onto a canvas by a `WebGPURenderer`: a scene to put views' objects in, a camera, and a loop that runs at every frame the display shows. It lives in the browser only.
 *
 * Time comes from the display: each frame is told the time between the moments the display showed this frame and the one before, never when code happens to run.
 *
 * The renderer, the scene, and the camera are Three.js's own, as bare Three.js has them: what a viewport does not do, such as drawing another camera's picture into a texture, is done with them as Three.js does it.
 */
export interface Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Three.WebGPURenderer;
  readonly scene: Three.Scene;
  readonly camera: Three.PerspectiveCamera;
  /** Every click on the canvas from now on, as a point of the screen, from -1 to 1 across it and up it. */
  readonly clicks: Stream.Stream<{ readonly x: number; readonly y: number }>;
  /** Draws the scene as it is now, from the camera; nothing once the graphics device is lost. */
  readonly render: Effect.Effect<void>;
  /** Waits until the graphics device is lost, such as when a driver resets or the browser takes it back, and is why: nothing is drawn after it. */
  readonly lost: Effect.Effect<{ readonly reason: string }>;
  /** Draws the scene as it is now and takes a shot of it: a PNG, as base64, at most `width` pixels across if given, and its size; for showing a tool what a person sees. */
  readonly capture: (
    width: Option.Option<number>,
  ) => Effect.Effect<
    { readonly png: string; readonly width: number; readonly height: number },
    ViewportError
  >;
  /** Runs `frame` with the seconds since the frame before, at every frame the display shows, until the scope closes. A frame draws with `render` when there is something to draw, as a frame of bare Three.js's draws itself: one paused can leave the picture as it was. */
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

/** A viewport drawing into a picture, from which the screen's is made at the end: with ambient occlusion, if given, and antialiased as told, by multisampling unless told otherwise. What blends over what is behind it blends in the picture's linear colours. */
export interface Pictured {
  readonly output?: 'Picture';
  readonly occlusion?: Option.Option<Occlusion>;
  readonly antialiasing?: Antialiasing.Antialiasing;
}

/** A viewport drawing straight onto the screen, each shader putting its colours in the screen's as it draws, with no picture in between: cheaper, and what blends over what is behind it blends in the screen's colours, as WebGL's renderer has it. With no picture, nothing is drawn through passes after it: it is antialiased by the renderer alone, by multisampling unless told otherwise. */
export interface Direct {
  readonly output: 'Direct';
  readonly antialiasing?: Antialiasing.Alone;
}

/** How a viewport draws: into a picture unless told to draw straight onto the screen, with as many pixels for each of the screen's as `pixelRatio` makes of its density, a pixel for each of them unless told otherwise. It is asked again whenever the canvas changes its size or moves to a screen of another density. */
export type Options = {
  readonly pixelRatio?: (screen: number) => number;
} & (Pictured | Direct);

/** How a viewport draws, as its options come to: the renderer alone, multisampled or not; straight onto the screen, multisampled or not; or through passes. */
export type Drawing =
  | { readonly _tag: 'Alone'; readonly multisampled: boolean }
  | { readonly _tag: 'Direct'; readonly multisampled: boolean }
  | {
      readonly _tag: 'Passes';
      readonly occlusion: Option.Option<Occlusion>;
      readonly antialiasing: Antialiasing.Antialiasing;
    };

/** How a viewport told `options` draws: the renderer draws alone unless ambient occlusion or antialiasing needs a pass. */
export const drawingOf = (options: Options): Drawing => {
  if (options.output === 'Direct') {
    const antialiasing = options.antialiasing ?? Antialiasing.multisample;
    return { _tag: 'Direct', multisampled: Antialiasing.multisampled(antialiasing) };
  }
  const occlusion = options.occlusion ?? Option.none();
  const antialiasing = options.antialiasing ?? Antialiasing.multisample;
  return Option.isNone(occlusion) &&
    (antialiasing._tag === 'None' || antialiasing._tag === 'Multisample')
    ? { _tag: 'Alone', multisampled: Antialiasing.multisampled(antialiasing) }
    : { _tag: 'Passes', occlusion, antialiasing };
};

/** How many pixels a viewport told `options` draws for each of a screen of `screen` pixels a point. */
export const pixelRatioOf = (options: Options, screen: number): number =>
  (options.pixelRatio ?? ((density) => density))(screen);

/** Something drawn with that holds resources on the graphics device until it is let go of. */
interface Held {
  readonly dispose: () => void;
}

/** The ambient occlusion of `scene` seen from `camera`, as `told`, worked out at `resolution`, a share of the canvas's, and blended over the frames when `temporal`: first the scene's depth and its normals alone, from which the occlusion is worked out and then smoothed. Everything it is drawn with is given to `hold`. */
const occlusionOf = (
  scene: Three.Scene,
  camera: Three.PerspectiveCamera,
  told: Occlusion,
  drawing: { readonly resolution: number; readonly temporal: boolean },
  hold: <A extends Held>(held: A) => A,
) => {
  // One sample a pixel: the occlusion reads the depth as it is, which it cannot from a smoothed one.
  const shapes = hold(pass(scene, camera, { samples: 0 }));
  shapes.transparent = false;
  shapes.setResolutionScale(drawing.resolution);
  shapes.setMRT(mrt({ output: packNormalToRGB(normalView) }));
  // Normals need no more than a byte each.
  shapes.getTexture('output').type = Three.UnsignedByteType;
  const normals = sample((uv) => unpackRGBToNormal(shapes.getTextureNode().sample(uv)));
  const shade = hold(ao(shapes.getTextureNode('depth'), normals, camera));
  shade.resolutionScale = told.resolution;
  shade.radius.value = told.radius;
  shade.scale.value = told.strength;
  // Blended over the frames, each frame's samples are turned aside from the last's, so together they see more.
  shade.useTemporalFiltering = drawing.temporal;
  // Worked out from a few samples a pixel, at a share of the resolution, the occlusion is noisy and coarse: it is smoothed and brought to the whole resolution along the surfaces it lies on, never across an edge between them, once a frame.
  const smoothed = hold(
    denoise(shade.getTextureNode(), shapes.getTextureNode('depth'), normals, camera),
  );
  return hold(rtt(smoothed)).sample(screenUV).r;
};

/** A supersampling pass that draws with its context, as every other pass does, which Three's leaves out: the ambient occlusion among it. */
class Supersampled extends SSAAPassNode {
  override updateBefore(frame: Three.NodeFrame) {
    const { renderer } = frame;
    const drawnWith = this.contextNode;
    if (renderer === null || drawnWith === null) {
      return super.updateBefore(frame);
    }
    const before = renderer.contextNode;
    renderer.contextNode = drawnWith;
    try {
      return super.updateBefore(frame);
    } finally {
      renderer.contextNode = before;
    }
  }
}

/** The scene drawn `samples` times a frame, each a fraction of a pixel aside, and averaged. */
const supersampled = (scene: Three.Scene, camera: Three.PerspectiveCamera, samples: number) => {
  const drawn = new Supersampled(scene, camera);
  drawn.sampleLevel = Math.log2(samples);
  return drawn;
};

/** The passes `scene` is drawn through from `camera`, with ambient occlusion if given, and antialiased as `antialiasing` asks; let go of with the scope. */
const pipelineOf = (
  renderer: Three.WebGPURenderer,
  scene: Three.Scene,
  camera: Three.PerspectiveCamera,
  occlusion: Option.Option<Occlusion>,
  antialiasing: Antialiasing.Antialiasing,
) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const held = new Array<Held>();
      const hold = <A extends Held>(resource: A): A => {
        held.push(resource);
        return resource;
      };
      const drawing = {
        resolution: antialiasing._tag === 'Temporal' ? antialiasing.resolution : 1,
        temporal: antialiasing._tag === 'Temporal',
      };
      const drawn = hold(
        antialiasing._tag === 'Supersample'
          ? supersampled(scene, camera, antialiasing.samples)
          : pass(scene, camera),
      );
      drawn.setResolutionScale(drawing.resolution);
      // Blending a frame into the ones before follows where each pixel moved since.
      if (drawing.temporal) {
        drawn.setMRT(mrt({ output, velocity }));
      }
      if (Option.isSome(occlusion)) {
        drawn.contextNode = builtinAOContext(
          occlusionOf(scene, camera, occlusion.value, drawing, hold),
        );
      }
      const shown = (() => {
        switch (antialiasing._tag) {
          case 'None':
          case 'Multisample':
          case 'Supersample':
            return drawn;
          case 'Morphological':
            return hold(smaa(drawn.getTextureNode()));
          case 'Temporal': {
            const resolve = antialiasing.resolution < 1 ? taau : traa;
            return hold(
              resolve(
                drawn.getTextureNode('output'),
                drawn.getTextureNode('depth'),
                drawn.getTextureNode('velocity'),
                camera,
              ),
            );
          }
        }
      })();
      const pipeline = hold(new Three.RenderPipeline(renderer, shown));
      return { render: () => pipeline.render(), held };
    }),
    ({ held }) =>
      Effect.sync(() => {
        for (const resource of held) resource.dispose();
      }),
  );

const startRenderer = (canvas: HTMLCanvasElement, antialias: boolean) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const renderer = new Three.WebGPURenderer({ canvas, antialias });
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

/** A viewport drawing onto `canvas`, as `options` tell it to: into a picture with no ambient occlusion unless told otherwise, antialiased by multisampling, a pixel for each of the screen's. */
export const make = (
  canvas: HTMLCanvasElement,
  options: Options = {},
): Effect.Effect<Viewport, ViewportError, Scope.Scope> =>
  Effect.gen(function* () {
    const drawing = drawingOf(options);
    const renderer = yield* startRenderer(
      canvas,
      drawing._tag !== 'Passes' && drawing.multisampled,
    );
    const scene = new Three.Scene();
    const camera = new Three.PerspectiveCamera();
    const draw = yield* (() => {
      switch (drawing._tag) {
        case 'Alone':
          return Effect.succeed(() => renderer.render(scene, camera));
        case 'Direct':
          return Effect.map(
            Effect.acquireRelease(
              Effect.sync(() => new Three.DirectRenderPipeline(renderer)),
              (direct) => Effect.sync(() => direct.dispose()),
            ),
            (direct) => () => direct.render(scene, camera),
          );
        case 'Passes':
          return Effect.map(
            pipelineOf(renderer, scene, camera, drawing.occlusion, drawing.antialiasing),
            (pipeline) => pipeline.render,
          );
      }
    })();

    // The graphics device lost is never had again: nothing is drawn on it.
    const lost = yield* Deferred.make<{ readonly reason: string }>();
    const tell = renderer.onDeviceLost;
    renderer.onDeviceLost = (info) => {
      tell.call(renderer, info);
      Deferred.doneUnsafe(lost, Effect.succeed({ reason: info.message }));
    };
    // Whether a frame has been drawn yet, before which a shot would show nothing of the state.
    const drawn = { once: false };
    const drawNow = () => {
      if (Deferred.isDoneUnsafe(lost)) return;
      draw();
      drawn.once = true;
    };

    const fit = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setPixelRatio(pixelRatioOf(options, window.devicePixelRatio));
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

    // Moved to a screen of another density, the canvas changes no size: the density is watched on its own, afresh after every change.
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const density = { query: matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) };
        const changed = () => {
          density.query.removeEventListener('change', changed);
          fit();
          density.query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
          density.query.addEventListener('change', changed);
        };
        density.query.addEventListener('change', changed);
        return () => density.query.removeEventListener('change', changed);
      }),
      (stop) => Effect.sync(stop),
    );

    const render = Effect.sync(drawNow);

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
        if (Deferred.isDoneUnsafe(lost)) {
          return Effect.fail(new ViewportError({ reason: 'The graphics device was lost.' }));
        }
        if (!drawn.once) {
          return Effect.fail(
            new ViewportError({
              reason: 'Nothing has been drawn yet: the page is still starting.',
            }),
          );
        }
        drawNow();
        return shot(canvas, width);
      });

    return {
      canvas,
      renderer,
      scene,
      camera,
      clicks,
      render,
      lost: Deferred.await(lost),
      capture,
      loop,
    };
  });
