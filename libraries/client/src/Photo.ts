import { Effect, type Scope } from 'effect';
import {
  Break,
  Fn,
  If,
  Loop,
  PI,
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
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as PathTracer from '#src/PathTracer.ts';
import * as SceneTracer from '#src/SceneTracer.ts';
import * as TracedScene from '#src/TracedScene.ts';

/**
 * A photograph of what a viewport shows, path traced: the scene gathered for rays as it is when the photograph is taken, and lit as it is lit then, and a path followed from the camera through every pixel each time it is developed, as `PathTracer.radiance` follows one, the paths averaged, so the picture grows finer the longer it is developed. The game may go on meanwhile: the photograph is of the moment it was taken.
 */

/** How many times a path bounces at most, and how many suns light it at most. */
const BOUNCES = 6;
const SUNS = 2;

/** How far from a surface a path leaves it, and how far a ray looks for what it meets. */
const AWAY = 1e-4;
const FAR = 1e6;

/** A photograph being developed: one more path through every pixel, added to those before and drawn on the viewport's canvas, and how many paths have been followed through each so far. */
export interface Photo {
  readonly develop: Effect.Effect<void>;
  readonly samples: Effect.Effect<number>;
}

/** A number from a number, mixed as PCG mixes it: a stream of them, one from the last, as random as the graphics device has. */
const mixed = (value: Three.Node<'uint'>) => {
  const state = value.mul(747796405).add(2891336453);
  const word = state.shiftRight(state.shiftRight(28).add(4)).bitXor(state).mul(277803737);
  return word.shiftRight(22).bitXor(word);
};

/**
 * A photograph of what `viewport` shows now, path traced: its scene gathered for rays and its lights taken as they are now, and nothing followed yet. Let go of with the scope.
 */
export const take = (viewport: {
  readonly renderer: Three.WebGPURenderer;
  readonly scene: Three.Scene;
  readonly camera: Three.PerspectiveCamera;
}): Effect.Effect<Photo, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { renderer, scene, camera } = viewport;
    const device = SceneTracer.onDevice();
    device.write(TracedScene.gathering().gather(scene, camera));
    const lighting = PathTracer.lightingOf(scene);

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
      const pixel = instanceIndex;
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
      Loop(BOUNCES, () => {
        const { met, normal } = SceneTracer.traceFacing(device, from, way, float(FAR));
        const placed = int(met.y).toVar();
        If(placed.lessThan(0), () => {
          light.addAssign(carried.mul(mix(down, up, way.y.mul(0.5).add(0.5))));
          Break();
        });
        const base = placed.mul(TracedScene.PLACED / 4);
        const colour = device.placed.node.element(base.add(3)).xyz.toVar();
        const glow = device.placed.node.element(base.add(4)).xyz;
        const facing = normal.toVar();
        const at = from.add(way.mul(met.x)).add(facing.mul(AWAY)).toVar();
        light.addAssign(carried.mul(glow));
        for (const sun of suns) {
          const lit = dot(facing, sun.toward).toVar();
          If(lit.greaterThan(0), () => {
            // In a photograph whatever stands between a surface and a sun shades it, whether or not a game asked it to cast a shadow.
            const hidden = SceneTracer.trace(device, at, sun.toward, float(FAR));
            If(hidden.y.lessThan(0), () => {
              light.addAssign(carried.mul(colour).mul(sun.irradiance).mul(lit).div(PI));
            });
          });
        }
        carried.mulAssign(colour);
        // The next way as likely as its cosine to the surface, as a matte surface scatters light.
        const angle = next().mul(2 * Math.PI);
        const rise = next();
        const helper = select(facing.x.abs().greaterThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0));
        const first = normalize(cross(helper, facing));
        const second = cross(facing, first);
        const out = sqrt(float(1).sub(rise));
        from.assign(at);
        way.assign(
          normalize(
            first
              .mul(cos(angle).mul(out))
              .add(second.mul(sin(angle).mul(out)))
              .add(facing.mul(sqrt(rise))),
          ),
        );
      });
      const before = summing.element(pixel);
      before.assign(select(frame.equal(0), vec4(light, 1), before.add(vec4(light, 1))));
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

    const followed = { count: 0 };
    return {
      develop: Effect.sync(() => {
        frame.value = followed.count;
        void renderer.compute(follow);
        followed.count += 1;
        quad.render(renderer);
      }),
      samples: Effect.sync(() => followed.count),
    };
  });
