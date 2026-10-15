import { Effect, type Scope } from 'effect';
import {
  Break,
  Fn,
  If,
  Loop,
  PI,
  clamp,
  cos,
  cross,
  dot,
  float,
  instanceIndex,
  int,
  max,
  mix,
  normalize,
  screenUV,
  select,
  sin,
  sqrt,
  storage,
  texture,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as HairTracer from '#src/HairTracer.ts';
import * as PathTracer from '#src/PathTracer.ts';
import * as SceneTracer from '#src/SceneTracer.ts';
import * as SurfaceTracer from '#src/SurfaceTracer.ts';
import * as TracedScene from '#src/TracedScene.ts';

/**
 * A photograph of what a viewport shows, path traced: the scene gathered for rays as it is when the photograph is taken, and lit as it is lit then, and a path followed from the camera through every pixel, as `PathTracer.radiance` follows one, the paths averaged, so the picture grows finer the longer it is developed. Each time it is developed, the graphics device follows paths through the next rows of pixels, only once it has followed those before, and as many rows as it follows within its budget, so it never falls behind, with the work waiting on it piling up, nor keeps the page from drawing. The game may go on meanwhile: the photograph is of the moment it was taken.
 */

/** How many times a path bounces at most, as `PathTracer` has it, and from how many bounces on it may fade, as likely as it is dark; and how many suns light it at most. */
const BOUNCES = 32;
const FADING = 3;
const SUNS = 2;

/** How far from a surface a path leaves it, and how far a ray looks for what it meets. */
const AWAY = 1e-4;
const FAR = 1e6;

/** A photograph being developed: paths followed through the next rows of its pixels, once the graphics device has followed those before, added to them and drawn on the viewport's canvas; and how many paths have been followed through every pixel so far. */
export interface Photo {
  readonly develop: Effect.Effect<void>;
  readonly samples: Effect.Effect<number>;
}

/** How long, in milliseconds, the graphics device is given to follow each batch of paths: short enough that it never falls behind what it is asked, nor keeps the page from drawing. */
export const BUDGET = 25;

/** Which paths a photograph follows next: through every pixel how many times over so far, from which pixel, and through how many. */
export interface Batches {
  readonly pass: number;
  readonly first: number;
  readonly size: number;
}

/** The first batch of a photograph `width` pixels across: eight rows from the top. */
export const batchesOf = (width: number): Batches => ({ pass: 0, first: 0, size: width * 8 });

/** The batch after `batches`, which took `took` milliseconds, of a photograph `width` pixels across and `total` in all: from the pixel after it, the next pass begun after the last; as many more pixels as the budget gives time for, at most four times as many, whole rows of them, at least one and at most the photograph. */
export const batched = (
  batches: Batches,
  photograph: { readonly width: number; readonly total: number; readonly took: number },
): Batches => {
  const { width, total, took } = photograph;
  const next = batches.first + Math.min(batches.size, total - batches.first);
  const grown = batches.size * (took > 0 ? Math.min(BUDGET / took, 4) : 4);
  return {
    pass: next >= total ? batches.pass + 1 : batches.pass,
    first: next >= total ? 0 : next,
    size: Math.min(Math.max(Math.round(grown / width), 1) * width, total),
  };
};

/** How a photograph is developed: the curve its light is mapped to the screen's by, as Three's tone mappings name them, and how much it is exposed, the light times this before it is mapped. */
export interface Developing {
  readonly toneMapping: Three.ToneMapping;
  readonly exposure: number;
}

/** How a photograph is developed, as `told`, the rest as `renderer` puts out its frames: so a photograph told nothing looks as the viewport does, and one told a curve keeps highlights the viewport clips. */
export const developingOf = (
  renderer: { readonly toneMapping: Three.ToneMapping; readonly toneMappingExposure: number },
  told: Partial<Developing>,
): Developing => ({
  toneMapping: told.toneMapping ?? renderer.toneMapping,
  exposure: told.exposure ?? renderer.toneMappingExposure,
});

/** How many numbers each picture's placing takes: the two rows of what moves a place in the picture to where its photograph samples it, four numbers each, the fourth nothing. */
export const PLACING = 8;

/** How many pixels across, and down, each picture is laid in the photograph's pictures: every one the same, as layers of one texture are. */
const PICTURE = 1024;

/**
 * Where a place in each of `pictures` lies in the layer the photograph lays it in, as Three samples it: moved by the picture's offset, repeat, and turn, and upside down where Three turns the picture so, the layer holding the picture top row first.
 */
export const placingsOf = (pictures: ReadonlyArray<Three.Texture>): Float32Array => {
  const placings = new Float32Array(Math.max(pictures.length, 1) * PLACING);
  pictures.forEach((picture, index) => {
    picture.updateMatrix();
    // Three keeps its matrices by columns.
    const e = picture.matrix.elements;
    const across = [e[0] ?? 0, e[3] ?? 0, e[6] ?? 0];
    const down = [e[1] ?? 0, e[4] ?? 0, e[7] ?? 0];
    const upright = picture.flipY ? [-(down[0] ?? 0), -(down[1] ?? 0), 1 - (down[2] ?? 0)] : down;
    placings.set([...across, 0, ...upright, 0], index * PLACING);
  });
  return placings;
};

/** Whether `image` is something a canvas can draw. */
const isDrawable = (image: unknown): image is CanvasImageSource =>
  (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
  (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
  (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
  (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas);

/** `pictures` laid as the layers of one texture, read in `colourSpace`, each drawn to the same size, white where a picture holds nothing a canvas can draw, so what it paints is left as it is; one white layer where there are none. */
const layersOf = (
  pictures: ReadonlyArray<Three.Texture>,
  colourSpace: Three.ColorSpace,
): Three.DataArrayTexture => {
  const count = Math.max(pictures.length, 1);
  const pixels = new Uint8Array(PICTURE * PICTURE * 4 * count).fill(255);
  const canvas = new OffscreenCanvas(PICTURE, PICTURE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  pictures.forEach((picture, index) => {
    const image: unknown = picture.image;
    if (context === null || !isDrawable(image)) {
      return;
    }
    context.clearRect(0, 0, PICTURE, PICTURE);
    context.drawImage(image, 0, 0, PICTURE, PICTURE);
    pixels.set(context.getImageData(0, 0, PICTURE, PICTURE).data, index * PICTURE * PICTURE * 4);
  });
  const layers = new Three.DataArrayTexture(pixels, PICTURE, PICTURE, count);
  layers.colorSpace = colourSpace;
  layers.wrapS = Three.RepeatWrapping;
  layers.wrapT = Three.RepeatWrapping;
  layers.magFilter = Three.LinearFilter;
  layers.minFilter = Three.LinearFilter;
  layers.generateMipmaps = false;
  layers.needsUpdate = true;
  return layers;
};

/** A number from a number, mixed as PCG mixes it: a stream of them, one from the last, as random as the graphics device has. */
const mixed = (value: Three.Node<'uint'>) => {
  const state = value.mul(747796405).add(2891336453);
  const word = state.shiftRight(state.shiftRight(28).add(4)).bitXor(state).mul(277803737);
  return word.shiftRight(22).bitXor(word);
};

/**
 * A photograph of what `viewport` shows now, path traced: its scene gathered for rays and its lights taken as they are now, and nothing followed yet, developed as `told`, the rest as the viewport's renderer puts out its frames. Let go of with the scope.
 */
export const take = (
  viewport: {
    readonly renderer: Three.WebGPURenderer;
    readonly scene: Three.Scene;
    readonly camera: Three.PerspectiveCamera;
  },
  told: Partial<Developing> = {},
): Effect.Effect<Photo, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { renderer, scene, camera } = viewport;
    const developing = developingOf(renderer, told);
    const device = SceneTracer.onDevice();
    // Her hair too, every strand where it is drawn now.
    const flat = TracedScene.gathering({ strands: true }).gather(scene, camera);
    device.write(flat);
    const lighting = PathTracer.lightingOf(scene);
    // Pictures of colours, kept as the colours they show; and finishes, how rough and how metal, kept as the numbers they hold.
    const layers = layersOf(flat.pictures, Three.SRGBColorSpace);
    const finishLayers = layersOf(flat.finishes, Three.NoColorSpace);
    // Where places lie in each, the pictures' first and the finishes' after them, in one buffer: a shader may read only so many.
    const everyPicture = [...flat.pictures, ...flat.finishes];
    const placings = storage(
      new Three.StorageBufferAttribute(placingsOf(everyPicture), 4),
      'vec4',
      Math.max(everyPicture.length, 1) * (PLACING / 4),
    ).toReadOnly();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        layers.dispose();
        finishLayers.dispose();
      }),
    );

    const size = renderer.getDrawingBufferSize(new Three.Vector2());
    const width = Math.max(Math.floor(size.x), 1);
    const height = Math.max(Math.floor(size.y), 1);
    const sums = new Three.StorageBufferAttribute(new Float32Array(width * height * 4), 4);
    const summing = storage(sums, 'vec4', width * height);
    const reading = storage(sums, 'vec4', width * height).toReadOnly();

    camera.updateMatrixWorld();
    const cameraWorld = uniform(camera.matrixWorld.clone());
    const projectionInverse = uniform(camera.projectionMatrixInverse.clone());
    const frame = uniform(0, 'uint');
    const firstPixel = uniform(0, 'uint');
    // Written last by every batch, and read back, which waits for the graphics device to finish the batch.
    const finished = new Three.StorageBufferAttribute(new Uint32Array(4), 1);
    const finishing = storage(finished, 'uint', 4);
    const up = vec3(...lighting.up);
    const down = vec3(...lighting.down);
    const suns = Array.from({ length: SUNS }, (_, index) => {
      const sun = lighting.suns[index];
      return {
        toward: vec3(...(sun?.toward ?? [0, 1, 0])),
        irradiance: vec3(...(sun?.irradiance ?? [0, 0, 0])),
      };
    });

    const follow = Fn(() => {
      const pixel = instanceIndex.add(firstPixel);
      const x = pixel.mod(width);
      const y = pixel.div(width);
      const seed = mixed(pixel.add(frame.mul(9781)).add(1)).toVar();
      const next = () => {
        seed.assign(mixed(seed));
        return float(seed).div(4294967296);
      };
      // Through a point of the pixel chosen anew each time, so its edges are averaged too.
      const across = float(x).add(next()).div(width).mul(2).sub(1);
      const upward = float(1).sub(float(y).add(next()).div(height).mul(2));
      const seen = projectionInverse.mul(vec4(across, upward, 1, 1));
      const from = cameraWorld.mul(vec4(0, 0, 0, 1)).xyz.toVar();
      const way = normalize(cameraWorld.mul(vec4(seen.xyz.div(seen.w), 0)).xyz).toVar();
      const light = vec3(0).toVar();
      const carried = vec3(1).toVar();
      Loop(BOUNCES, ({ i }) => {
        const {
          met,
          normal,
          uv,
          along,
          across,
          down: downward,
        } = SceneTracer.traceFacing(device, from, way, float(FAR));
        const placed = int(met.y).toVar();
        If(placed.lessThan(0), () => {
          light.addAssign(carried.mul(mix(down, up, way.y.mul(0.5).add(0.5))));
          Break();
        });
        const base = placed.mul(TracedScene.PLACED / 4);
        const painting = device.placed.node.element(base.add(6)).toVar();
        // Its colour, times its picture's where a picture paints a surface; hair keeps how much light it takes in there instead.
        const finish = device.placed.node.element(base.add(5)).toVar();
        // A shining surface 0, hair 1, or something matte 2.
        const shining = finish.x.lessThan(0.5);
        const surface = finish.x.sub(1).abs().greaterThan(0.5);
        const place = vec3(uv, float(1));
        /** Where the uv met lies in the picture placed `at` among them all, as `placingsOf` placed it. */
        const placedIn = (at: Three.Node<'int'>) =>
          vec2(
            dot(placings.element(at.mul(PLACING / 4)).xyz, place),
            dot(placings.element(at.mul(PLACING / 4).add(1)).xyz, place),
          );
        const layer = int(painting.y);
        const painted = texture(layers, placedIn(layer)).depth(layer).level(int(0)).xyz;
        // How rough and how metal a surface is, times its finish's green and blue where a finish paints them.
        const finishLayer = int(painting.w);
        const finished = texture(finishLayers, placedIn(finishLayer.add(flat.pictures.length)))
          .depth(finishLayer)
          .level(int(0));
        // Which way a surface faces where a relief tilts it, as Three's normal map does: across and down its picture, and out of it.
        const relief = device.placed.node.element(base.add(7)).toVar();
        const reliefLayer = int(relief.y);
        const tilt = texture(finishLayers, placedIn(reliefLayer.add(flat.pictures.length)))
          .depth(reliefLayer)
          .level(int(0))
          .xyz.mul(2)
          .sub(1);
        const tilted = vec3(tilt.xy.mul(relief.zw), tilt.z);
        const acrossFlat = normalize(across.sub(normal.mul(dot(normal, across))));
        const downFlat = normalize(downward.sub(normal.mul(dot(normal, downward))));
        const reliefNormal = normalize(
          acrossFlat.mul(tilted.x).add(downFlat.mul(tilted.y)).add(normal.mul(tilted.z)),
        ).toVar();
        // Never tilted away from where it is seen from, which no surface seen could face.
        const shadingNormal = select(
          relief.x
            .greaterThan(0.5)
            .and(dot(across, across).greaterThan(0.5))
            .and(dot(reliefNormal, way).lessThan(0)),
          reliefNormal,
          normal,
        );
        const roughBy = select(painting.z.mod(2).greaterThan(0.5), finished.y, float(1));
        const metalBy = select(painting.z.greaterThan(1.5), finished.z, float(1));
        const colour = device.placed.node
          .element(base.add(3))
          .xyz.mul(select(surface.and(painting.x.greaterThan(0.5)), painted, vec3(1)))
          .toVar();
        const glow = device.placed.node.element(base.add(4)).xyz;
        light.addAssign(carried.mul(glow));
        const point = from.add(way.mul(met.x)).toVar();
        If(surface.not().and(dot(along, along).greaterThan(0.5)), () => {
          // Hair, as `HairScattering` scatters light: in the strand's own frame, along it, across it, and toward where it is seen from.
          const material = device.placed.node.element(base.add(5));
          const taking = device.placed.node.element(base.add(6));
          const seenWorld = way.negate();
          const acrossRaw = seenWorld.sub(along.mul(dot(seenWorld, along)));
          const toward = select(
            dot(acrossRaw, acrossRaw).greaterThan(1e-12),
            normalize(acrossRaw),
            normal,
          ).toVar();
          const side = cross(toward, along).toVar();
          const local = (world: Three.Node<'vec3'>) =>
            vec3(dot(world, along), dot(world, side), dot(world, toward));
          const shape = vec4(clamp(dot(normal, side), -1, 1), material.w, material.y, material.z);
          const seenHere = local(seenWorld).toVar();
          for (const sun of suns) {
            // Light goes through a strand: it is lit from wherever a sun is not hidden.
            const hidden = SceneTracer.trace(device, point, sun.toward, float(FAR));
            If(hidden.y.lessThan(0), () => {
              light.addAssign(
                carried
                  .mul(HairTracer.scattered(seenHere, local(sun.toward), shape, taking))
                  .mul(sun.irradiance),
              );
            });
          }
          const chosenHere = HairTracer.chosen(
            seenHere,
            vec4(next(), next(), next(), next()),
            shape,
            taking,
          ).toVar();
          const likely = HairTracer.likelihood(seenHere, chosenHere, shape, taking);
          carried.mulAssign(
            select(
              likely.greaterThan(0),
              HairTracer.scattered(seenHere, chosenHere, shape, taking).div(likely),
              vec3(0),
            ),
          );
          // On from where it met the strand, through it or away from it.
          from.assign(point);
          way.assign(
            normalize(
              along.mul(chosenHere.x).add(side.mul(chosenHere.y)).add(toward.mul(chosenHere.z)),
            ),
          );
        }).Else(() => {
          const facing = shadingNormal.toVar();
          const at = point.add(normal.mul(AWAY)).toVar();
          // The surface's own frame: two ways square to the way it faces, and that way.
          const helper = select(facing.x.abs().greaterThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0));
          const first = normalize(cross(helper, facing)).toVar();
          const second = cross(facing, first).toVar();
          const local = (world: Three.Node<'vec3'>) =>
            vec3(dot(world, first), dot(world, second), dot(world, facing));
          const seenHere = local(way.negate()).toVar();
          const rough = vec2(finish.y.mul(roughBy), finish.z.mul(metalBy));
          for (const sun of suns) {
            const lit = dot(facing, sun.toward).toVar();
            If(lit.greaterThan(0), () => {
              // In a photograph whatever stands between a surface and a sun shades it, whether or not a game asked it to cast a shadow.
              const hidden = SceneTracer.trace(device, at, sun.toward, float(FAR));
              If(hidden.y.lessThan(0), () => {
                // A shining surface as `SurfaceScattering` has it; something matte as Lambert has it.
                const sent = select(
                  shining,
                  SurfaceTracer.scattered(seenHere, local(sun.toward), colour, rough),
                  colour.mul(lit).div(PI),
                );
                light.addAssign(carried.mul(sent).mul(sun.irradiance));
              });
            });
          }
          from.assign(at);
          If(shining, () => {
            const chosenHere = SurfaceTracer.chosen(
              seenHere,
              vec3(next(), next(), next()),
              colour,
              rough,
            ).toVar();
            const likely = SurfaceTracer.likelihood(seenHere, chosenHere, colour, rough);
            carried.mulAssign(
              select(
                likely.greaterThan(0),
                SurfaceTracer.scattered(seenHere, chosenHere, colour, rough).div(likely),
                vec3(0),
              ),
            );
            way.assign(
              normalize(
                first.mul(chosenHere.x).add(second.mul(chosenHere.y)).add(facing.mul(chosenHere.z)),
              ),
            );
          }).Else(() => {
            carried.mulAssign(colour);
            // The next way as likely as its cosine to the surface, as a matte surface scatters light.
            const angle = next().mul(2 * Math.PI);
            const rise = next();
            const out = sqrt(float(1).sub(rise));
            way.assign(
              normalize(
                first
                  .mul(cos(angle).mul(out))
                  .add(second.mul(sin(angle).mul(out)))
                  .add(facing.mul(sqrt(rise))),
              ),
            );
          });
        });
        // From the fourth bounce a path fades as likely as it is dark, what remains of it carried on as much brighter, so no light is lost on average.
        If(int(i).greaterThanEqual(FADING), () => {
          const keep = clamp(max(carried.x, max(carried.y, carried.z)), 0, 1).toVar();
          If(next().greaterThanEqual(keep), () => {
            Break();
          });
          carried.divAssign(keep);
        });
      });
      const before = summing.element(pixel);
      before.assign(select(frame.equal(0), vec4(light, 1), before.add(vec4(light, 1))));
      If(instanceIndex.equal(0), () => {
        finishing.element(0).assign(frame.add(1));
      });
    })().compute(width * height);

    // The paths so far averaged, for each pixel of the canvas.
    const developed = new Three.MeshBasicNodeMaterial();
    const pixelAt = uint(screenUV.y.mul(height).floor())
      .mul(width)
      .add(uint(screenUV.x.mul(width).floor()));
    const sum = reading.element(pixelAt);
    developed.colorNode = sum.xyz.div(max(sum.w, 1));
    const quad = new Three.QuadMesh(developed);
    yield* Effect.addFinalizer(() => Effect.sync(() => developed.dispose()));

    // The batch to follow next, and whether the graphics device is still following the last.
    const total = width * height;
    const kept = { batches: batchesOf(width), following: false };
    return {
      develop: Effect.sync(() => {
        if (!kept.following) {
          const { batches } = kept;
          frame.value = batches.pass;
          firstPixel.value = batches.first;
          kept.following = true;
          const started = performance.now();
          // The renderer is ready, so it computes at once and gives back no promise.
          void renderer.compute(follow, Math.min(batches.size, total - batches.first));
          void renderer.getArrayBufferAsync(finished).then(
            () => {
              kept.batches = batched(batches, { width, total, took: performance.now() - started });
              kept.following = false;
            },
            () => {
              kept.following = false;
            },
          );
        }
        // Put out as the photograph is developed, the renderer left as it puts out the viewport's frames.
        const { toneMapping, toneMappingExposure } = renderer;
        renderer.toneMapping = developing.toneMapping;
        renderer.toneMappingExposure = developing.exposure;
        quad.render(renderer);
        renderer.toneMapping = toneMapping;
        renderer.toneMappingExposure = toneMappingExposure;
      }),
      samples: Effect.sync(() => kept.batches.pass),
    };
  });
