import { Data, Deferred, Effect, Option, PubSub, Queue, type Scope, Stream } from 'effect';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { motionBlur as blurredBy } from 'three/addons/tsl/display/MotionBlur.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import SSAAPassNode from 'three/addons/tsl/display/SSAAPassNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import {
  builtinAOContext,
  diffuseColor,
  int,
  metalness,
  roughness,
  unpackRGBToNormal,
  packNormalToRGB,
  mrt,
  normalView,
  output,
  pass,
  rtt,
  sample,
  screenUV,
  vec4,
  vec2,
  velocity,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as Antialiasing from '#src/Antialiasing.ts';
import type * as RayTracing from '#src/RayTracing.ts';
import * as SceneTracer from '#src/SceneTracer.ts';

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
  /** Every time from now on the canvas is fitted anew, to a new size or a screen of another density: blank after it until drawn again, so a frame that leaves the picture as it was, such as one paused, draws it once more. */
  readonly fitted: Stream.Stream<void>;
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

/** The longest a page is waited on to show what it was told, where no frame comes, as for a tab in the background. */
const PAINTED_AT_LATEST = 200;

/** Done once the page has shown what it was just told, two frames of the display on, or a short while on where no frame comes: for a page about to hold the browser up, such as while its shaders are made, to say so first. */
export const painted: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const finish = () => resume(Effect.void);
  const timer = setTimeout(finish, PAINTED_AT_LATEST);
  const frames = { first: 0, second: 0 };
  frames.first = requestAnimationFrame(() => {
    frames.second = requestAnimationFrame(finish);
  });
  return Effect.sync(() => {
    clearTimeout(timer);
    cancelAnimationFrame(frames.first);
    cancelAnimationFrame(frames.second);
  });
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

/** Motion blur: what moves across the screen while a frame is shown is smeared along its way, as a camera's shutter smears it, so motion reads smooth at any rate of frames: the shutter open for `shutter` of a frame's time, from none of it to all of it, and the smear sampled `samples` times along the way. */
export interface MotionBlur {
  readonly shutter: number;
  readonly samples: number;
}

/** Motion blur as told, the rest as most scenes want it: the shutter open half a frame, as a film camera's at its usual angle, sampled twelve times along the way, from two to thirty-two. */
export const motionBlur = (told: Partial<MotionBlur> = {}): MotionBlur => ({
  shutter: Math.min(Math.max(told.shutter ?? 0.5, 0), 1),
  samples: Math.min(Math.max(Math.round(told.samples ?? 12), 2), 32),
});

/** A viewport drawing into a picture, from which the screen's is made at the end: with ambient occlusion, ray tracing, and motion blur, if given, and antialiased as told, not at all unless told otherwise. What blends over what is behind it blends in the picture's linear colours. */
export interface Pictured {
  readonly output?: 'Picture';
  readonly occlusion?: Option.Option<Occlusion>;
  readonly rayTracing?: Option.Option<RayTracing.RayTracing>;
  readonly motionBlur?: Option.Option<MotionBlur>;
  readonly antialiasing?: Antialiasing.Antialiasing;
}

/** A viewport drawing straight onto the screen, each shader putting its colours in the screen's as it draws, with no picture in between: cheaper, and what blends over what is behind it blends in the screen's colours, as WebGL's renderer has it. With no picture, nothing is drawn through passes after it: it is antialiased by the renderer alone, if told to. */
export interface Direct {
  readonly output: 'Direct';
  readonly antialiasing?: Antialiasing.Alone;
}

/** How a viewport draws: into a picture unless told to draw straight onto the screen, with as many pixels for each of the canvas's as `pixelRatio` makes of the screen's density, one unless told otherwise. It is asked again whenever the canvas changes its size or moves to a screen of another density. Unless told otherwise, a viewport draws as bare Three.js does; what more it should do is asked for, one thing at a time or through a preset such as `sharp`. */
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
      readonly rayTracing: Option.Option<RayTracing.RayTracing>;
      readonly motionBlur: Option.Option<MotionBlur>;
      readonly antialiasing: Antialiasing.Antialiasing;
    };

/** How a viewport told `options` draws: the renderer draws alone unless ambient occlusion, ray tracing, motion blur, or antialiasing needs a pass. */
export const drawingOf = (options: Options): Drawing => {
  if (options.output === 'Direct') {
    const antialiasing = options.antialiasing ?? Antialiasing.none;
    return { _tag: 'Direct', multisampled: Antialiasing.multisampled(antialiasing) };
  }
  const occlusion = options.occlusion ?? Option.none();
  const rayTracing = options.rayTracing ?? Option.none();
  const motionBlur = options.motionBlur ?? Option.none();
  const antialiasing = options.antialiasing ?? Antialiasing.none;
  return Option.isNone(occlusion) &&
    Option.isNone(rayTracing) &&
    Option.isNone(motionBlur) &&
    (antialiasing._tag === 'None' || antialiasing._tag === 'Multisample')
    ? { _tag: 'Alone', multisampled: Antialiasing.multisampled(antialiasing) }
    : { _tag: 'Passes', occlusion, rayTracing, motionBlur, antialiasing };
};

/** How many pixels a viewport told `options` draws for each of a screen of `screen` pixels a point. */
export const pixelRatioOf = (options: Options, screen: number): number =>
  (options.pixelRatio ?? (() => 1))(screen);

/** A pixel drawn for each of the screen's, however dense, the screen's own density. */
export const screenDensity = (screen: number) => screen;

/** Sharp: multisampled, and a pixel drawn for each of the screen's. A preset to spread into options and change as needed, such as `{ ...Viewport.sharp, output: 'Direct' }`. */
export const sharp: {
  readonly antialiasing: Antialiasing.Multisample;
  readonly pixelRatio: (screen: number) => number;
} = { antialiasing: Antialiasing.multisample, pixelRatio: screenDensity };

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

/** How far Three's screen-space indirect light, which sums what each of its steps finds, is scaled for a strength of 1: as bright as the scene's own tracing finds it. */
const SCREEN_LIGHT = 4;

/** The indirect light and reflections of `scene` from `camera`, traced as `told`, from what `drawn` drew, and what is done each frame before the passes draw. Everything it is drawn with is given to `hold`. */
const tracedOf = (
  scene: Three.Scene,
  camera: Three.PerspectiveCamera,
  told: RayTracing.RayTracing,
  drawn: Three.PassNode,
  temporal: boolean,
  hold: <A extends Held>(held: A) => A,
): {
  readonly light: Option.Option<{
    readonly gi: Three.Node<'vec3'>;
    readonly reaching: Three.Node<'float'>;
  }>;
  readonly reflections: Option.Option<Three.Node<'vec4'>>;
  readonly before: () => void;
} => {
  const picture = drawn.getTextureNode('output');
  const depth = drawn.getTextureNode('depth');
  const normals = drawn.getTextureNode('normal');
  const normal = (at: Three.Node<'vec2'>) =>
    unpackRGBToNormal(normals.sample(at).level(int(0)).rgb);
  const surfaces = sample((at) => unpackRGBToNormal(normals.sample(at).rgb));
  const diffuse = drawn.getTextureNode('diffuse');
  if (told._tag === 'Screen') {
    return {
      light: Option.map(told.light, ({ strength, occlusion, radius }) => {
        const traced = hold(ssgi(picture, depth, surfaces, camera));
        // The radius in the scene's units, as the scene's tracing takes it, rather than a share of the screen.
        traced.useScreenSpaceSampling.value = false;
        traced.radius.value = radius;
        traced.giIntensity.value = strength * SCREEN_LIGHT;
        traced.aoIntensity.value = occlusion;
        traced.useTemporalFiltering = temporal;
        return { gi: traced.getGINode().rgb, reaching: traced.getAONode().r };
      }),
      reflections: Option.map(told.reflections, ({ strength, distance }) => {
        const traced = hold(
          ssr(picture, depth, surfaces, {
            metalnessNode: diffuse.a,
            roughnessNode: normals.a,
            camera,
          }),
        );
        traced.maxDistance.value = distance;
        traced.intensity.value = strength;
        traced.resolutionScale = told.resolution;
        return traced;
      }),
      before: () => {},
    };
  }
  const tracing = SceneTracer.tracing(
    scene,
    camera,
    { picture, depth, normal, surfaces: normals, diffuse },
    told,
  );
  hold(tracing);
  return {
    // Traced from a ray or two a pixel, the light is noisy: it is smoothed along the surfaces it lies on, never across an edge between them, its colour and how much reaches each surface alike.
    light: Option.map(tracing.light, (traced) => {
      const gi = hold(rtt(hold(denoise(traced, depth, surfaces, camera)))).sample(screenUV);
      const reaching = hold(rtt(hold(denoise(vec4(traced.a), depth, surfaces, camera)))).sample(
        screenUV,
      );
      return { gi: gi.rgb, reaching: reaching.r };
    }),
    reflections: tracing.reflections,
    before: tracing.sync,
  };
};

/** The passes `scene` is drawn through from `camera`, with ambient occlusion, ray tracing, and motion blur if given, and antialiased as `antialiasing` asks; let go of with the scope. */
const pipelineOf = (
  renderer: Three.WebGPURenderer,
  scene: Three.Scene,
  camera: Three.PerspectiveCamera,
  occlusion: Option.Option<Occlusion>,
  rayTracing: Option.Option<RayTracing.RayTracing>,
  motionBlur: Option.Option<MotionBlur>,
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
      // Multisampled, the scene is drawn four times along the edges of geometry into the picture, as the renderer would draw it onto the screen.
      const drawn = hold(
        antialiasing._tag === 'Supersample'
          ? supersampled(scene, camera, antialiasing.samples)
          : pass(scene, camera, { samples: Antialiasing.multisampled(antialiasing) ? 4 : 0 }),
      );
      drawn.setResolutionScale(drawing.resolution);
      // Ray tracing reads which way each surface faces, its colour, and how metal and rough it is; blending a frame into the ones before, and smearing what moves, follow where each pixel moved since.
      drawn.setMRT(
        mrt({
          output,
          ...(drawing.temporal || Option.isSome(motionBlur) ? { velocity } : {}),
          // Two pictures a byte a part: which way each surface faces and how rough it is, and its colour and how metal it is, within what every device lets a pixel write.
          ...(Option.isSome(rayTracing)
            ? {
                normal: vec4(packNormalToRGB(normalView), roughness),
                diffuse: vec4(diffuseColor.rgb, metalness),
              }
            : {}),
        }),
      );
      if (Option.isSome(rayTracing)) {
        for (const name of ['normal', 'diffuse']) {
          drawn.getTexture(name).type = Three.UnsignedByteType;
        }
      }
      if (Option.isSome(occlusion)) {
        drawn.contextNode = builtinAOContext(
          occlusionOf(scene, camera, occlusion.value, drawing, hold),
        );
      }
      const traced = Option.map(rayTracing, (told) =>
        tracedOf(scene, camera, told, drawn, drawing.temporal, hold),
      );
      const picture = drawn.getTextureNode('output');
      // Lit by what the surfaces cast on one another, the ambient light kept from where it does not reach, and then what they reflect laid over it.
      const lit: Three.TextureNode = Option.match(traced, {
        onNone: () => picture,
        onSome: ({ light, reflections }) => {
          const withLight = Option.match(light, {
            onNone: () => picture,
            onSome: ({ gi, reaching }) =>
              vec4(
                picture.rgb.mul(reaching).add(drawn.getTextureNode('diffuse').rgb.mul(gi)),
                picture.a,
              ),
          });
          // What a surface reflects comes already weighed by how strongly it does, and is added to what it shows.
          return hold(
            rtt(
              Option.match(reflections, {
                onNone: () => withLight,
                onSome: (reflected) => vec4(withLight.rgb.add(reflected.rgb), withLight.a),
              }),
            ),
          );
        },
      });
      const shown = (() => {
        switch (antialiasing._tag) {
          case 'None':
          case 'Multisample':
          case 'Supersample':
            return lit;
          case 'Morphological':
            return hold(smaa(lit));
          case 'Temporal': {
            const resolve = antialiasing.resolution < 1 ? taau : traa;
            return hold(
              resolve(lit, drawn.getTextureNode('depth'), drawn.getTextureNode('velocity'), camera),
            );
          }
        }
      })();
      // Smeared last, once the picture is whole and smooth, along where each pixel moved while the shutter was open: half of how far it moved across the screen, as the screen runs two units across, sampled about where it is now.
      const blurred = Option.match(motionBlur, {
        onNone: () => shown,
        onSome: ({ shutter, samples }) =>
          blurredBy(
            shown === lit ? lit : hold(rtt(shown)),
            drawn.getTextureNode('velocity').xy.mul(vec2(0.5, -0.5).mul(shutter)),
            int(samples),
          ),
      });
      const pipeline = hold(new Three.RenderPipeline(renderer, blurred));
      const before = Option.match(traced, { onNone: () => () => {}, onSome: (it) => it.before });
      return {
        render: () => {
          before();
          pipeline.render();
        },
        held,
      };
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

/** A viewport drawing onto `canvas`, as `options` tell it to, and as bare Three.js does unless told otherwise: into a picture, with no ambient occlusion and no antialiasing, a pixel for each of the canvas's. */
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
            pipelineOf(
              renderer,
              scene,
              camera,
              drawing.occlusion,
              drawing.rayTracing,
              drawing.motionBlur,
              drawing.antialiasing,
            ),
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

    const refits = yield* PubSub.unbounded<void>();
    const fit = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setPixelRatio(pixelRatioOf(options, window.devicePixelRatio));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      PubSub.publishUnsafe(refits, undefined);
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
      fitted: Stream.fromPubSub(refits),
      render,
      lost: Deferred.await(lost),
      capture,
      loop,
    };
  });
