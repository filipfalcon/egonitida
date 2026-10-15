import {
  Fn,
  If,
  abs,
  exp,
  float,
  instanceIndex,
  int,
  max,
  normalize,
  packHalf2x16,
  pow,
  select,
  sqrt,
  storage,
  uint,
  uintBitsToFloat,
  unpackHalf2x16,
  unpackSnorm2x16,
  unpackUnorm4x8,
  uvec2,
  vec2,
  vec3,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as Denoising from '#src/Denoising.ts';

/**
 * A photograph's noise smoothed away on the graphics device, as `Denoising.denoised` smooths it: from the paths a photograph has followed so far and what its camera first met in each pixel, the light alone prepared, then blurred five times over, each time twice as far apart, between two buffers in turn, at half precision, so a photograph as large as the screen keeps its memory. What it comes to is read where the photograph is drawn.
 */

/** What the camera first met in each pixel, as a photograph writes it: its colour, packed four to a number; which way it faces, folded flat as an octahedron and packed two to a number; how far it lies, nothing where it met nothing; and every path's brightness squared, added up, so how far a pixel may stray is known. Four whole numbers a pixel. */
export const GUIDES = 4;

const brightness = (colour: Three.Node<'vec3'>) => colour.dot(vec3(0.2126, 0.7152, 0.0722));

// Packed and unpacked as their types are: Three's own types of them say less.
const halfPacked = (pair: Three.Node<'vec2'>) =>
  new Three.ConvertNode<'uint'>(packHalf2x16(pair), 'uint');
const halfUnpacked = (packed: Three.Node<'uint'>) =>
  new Three.ConvertNode<'vec2'>(unpackHalf2x16(packed), 'vec2');
const snormUnpacked = (packed: Three.Node<'uint'>) =>
  new Three.ConvertNode<'vec2'>(unpackSnorm2x16(packed), 'vec2');

/** Which way `folded` faces, folded flat as an octahedron. */
const unfolded = (folded: Three.Node<'vec2'>) => {
  const z = float(1).sub(abs(folded.x)).sub(abs(folded.y)).toVar();
  const shift = max(z.negate(), 0);
  return normalize(
    vec3(
      folded.x.add(select(folded.x.greaterThanEqual(0), shift.negate(), shift)),
      folded.y.add(select(folded.y.greaterThanEqual(0), shift.negate(), shift)),
      z,
    ),
  );
};

/** A way of length one folded flat as an octahedron, two numbers from -1 to 1, as `unfolded` unfolds it. */
export const folded = (way: Three.Node<'vec3'>) => {
  const flat = way.xy.div(abs(way.x).add(abs(way.y)).add(abs(way.z)));
  const sides = vec2(
    select(flat.x.greaterThanEqual(0), float(1), float(-1)),
    select(flat.y.greaterThanEqual(0), float(1), float(-1)),
  );
  return select(way.z.lessThan(0), vec2(1).sub(abs(flat.yx)).mul(sides), flat);
};

/** A denoiser for a photograph `width` by `height` pixels: `run` smooths what the photograph has followed so far, and `developed` is what it came to at a pixel. */
export interface Denoiser {
  readonly run: () => void;
  readonly developed: (pixel: Three.Node<'uint'>) => Three.Node<'vec3'>;
}

/** A denoiser over the sums `sums`, four numbers a pixel, its light added up and how many paths, and the guides `guides` of a photograph `width` by `height` pixels. */
export const make = (
  renderer: Three.WebGPURenderer,
  photograph: {
    readonly width: number;
    readonly height: number;
    readonly sums: Three.StorageBufferAttribute;
    readonly guides: Three.StorageBufferAttribute;
  },
): Denoiser => {
  const { width, height } = photograph;
  const count = width * height;
  const sums = storage(photograph.sums, 'vec4', count).toReadOnly();
  const guides = storage(photograph.guides, 'uvec4', count).toReadOnly();
  // The light alone and how far it may stray, at half precision, two whole numbers a pixel, in two buffers in turn.
  const buffers = [0, 1].map(() => new Three.StorageBufferAttribute(new Uint32Array(count * 2), 2));
  const reading = buffers.map((buffer) => storage(buffer, 'uvec2', count).toReadOnly());
  const writing = buffers.map((buffer) => storage(buffer, 'uvec2', count));

  const colourAt = (pixel: Three.Node<'uint'>) =>
    max(
      new Three.ConvertNode<'vec4'>(unpackUnorm4x8(guides.element(pixel).x), 'vec4').xyz,
      vec3(Denoising.LEAST),
    );
  const depthAt = (pixel: Three.Node<'uint'>) =>
    new Three.ConvertNode<'float'>(uintBitsToFloat(guides.element(pixel).z), 'float');
  const meanAt = (pixel: Three.Node<'uint'>) => {
    const sum = sums.element(pixel);
    return sum.xyz.div(max(sum.w, 1));
  };

  // The light alone, the colour of what it fell on divided out, and how far its brightness may stray from the average.
  const prepare = Fn(() => {
    const pixel = instanceIndex;
    const sum = sums.element(pixel);
    const paths = max(sum.w, 1);
    const mean = sum.xyz.div(paths).toVar();
    const squared = new Three.ConvertNode<'float'>(
      uintBitsToFloat(guides.element(pixel).w),
      'float',
    ).div(paths);
    const variance = max(squared.sub(brightness(mean).mul(brightness(mean))), 0).div(paths);
    const colour = colourAt(pixel);
    const shade = brightness(colour);
    const light = mean.div(colour);
    writing[0]
      ?.element(pixel)
      .assign(
        uvec2(halfPacked(light.xy), halfPacked(vec2(light.z, variance.div(shade.mul(shade))))),
      );
  })().compute(count);

  /** One blur, `step` pixels apart, from the buffer `from` into the other. */
  const blur = (step: number, from: number) =>
    Fn(() => {
      const pixel = instanceIndex;
      const into = writing[1 - from];
      const source = reading[from];
      if (into === undefined || source === undefined) {
        return;
      }
      const lightAt = (at: Three.Node<'uint'>) => {
        const packed = source.element(at);
        const first = halfUnpacked(packed.x);
        const second = halfUnpacked(packed.y);
        return { light: vec3(first, second.x), straying: second.y };
      };
      const here = lightAt(pixel);
      const lying = depthAt(pixel).toVar();
      const facing = unfolded(snormUnpacked(guides.element(pixel).y)).toVar();
      const bright = brightness(here.light).toVar();
      const deviation = sqrt(max(here.straying, 0)).toVar();
      const x = int(pixel.mod(width));
      const y = int(pixel.div(width));
      const total = float(0).toVar();
      const strayed = float(0).toVar();
      const sum = vec3(0).toVar();
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const qx = x.add(dx * step);
          const qy = y.add(dy * step);
          If(
            qx
              .greaterThanEqual(0)
              .and(qy.greaterThanEqual(0))
              .and(qx.lessThan(width))
              .and(qy.lessThan(height)),
            () => {
              const other = uint(qy.mul(width).add(qx));
              const otherLying = depthAt(other);
              If(otherLying.greaterThan(0), () => {
                const there = lightAt(other);
                const alike = max(facing.dot(unfolded(snormUnpacked(guides.element(other).y))), 0);
                const weight = float(
                  (Denoising.KERNEL[dx + 2] ?? 0) * (Denoising.KERNEL[dy + 2] ?? 0),
                )
                  .mul(pow(alike, Denoising.FACING))
                  .mul(
                    exp(
                      abs(lying.sub(otherLying))
                        .negate()
                        .div(lying.mul(Denoising.LYING * Math.hypot(dx, dy) * step).add(1e-6)),
                    ),
                  )
                  .mul(
                    exp(
                      abs(bright.sub(brightness(there.light)))
                        .negate()
                        .div(deviation.mul(Denoising.BRIGHTNESS).add(1e-6)),
                    ),
                  )
                  .toVar();
                total.addAssign(weight);
                strayed.addAssign(weight.mul(weight).mul(there.straying));
                sum.addAssign(there.light.mul(weight));
              });
            },
          );
        }
      }
      const smooth = select(lying.greaterThan(0), sum.div(max(total, 1e-12)), here.light);
      const straying = select(
        lying.greaterThan(0),
        strayed.div(max(total.mul(total), 1e-24)),
        here.straying,
      );
      into
        .element(pixel)
        .assign(uvec2(halfPacked(smooth.xy), halfPacked(vec2(smooth.z, straying))));
    })().compute(count);

  const blurs = Array.from({ length: Denoising.ITERATIONS }, (_, iteration) =>
    blur(1 << iteration, iteration % 2),
  );
  // After an odd number of blurs, the last is in the second buffer.
  const last = reading[Denoising.ITERATIONS % 2];

  return {
    run: () => {
      // The renderer is ready, so it computes at once and gives back no promise.
      void renderer.compute([prepare, ...blurs]);
    },
    developed: (pixel) => {
      const packed = last?.element(pixel);
      const smooth =
        packed === undefined
          ? meanAt(pixel)
          : vec3(halfUnpacked(packed.x), halfUnpacked(packed.y).x);
      return select(depthAt(pixel).greaterThan(0), smooth.mul(colourAt(pixel)), meanAt(pixel));
    },
  };
};
