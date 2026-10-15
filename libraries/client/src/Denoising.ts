/**
 * A photograph's noise smoothed away, as an edge-avoiding À-Trous wavelet filter does it (Dammertz, Sewtz, Hanika, and Lensch, 2010), steered as SVGF steers it (Schied and others, 2017): the light on each surface, its colour divided out so its picture stays sharp, blurred five times over, each time twice as far apart, each neighbour weighed by how alike it is where the camera first met it, how it faces, how far it lies, and how bright it is beside how far its brightness may stray. What meets nothing, such as the sky, is left as it is. Here as the graphics device works it out, so what it finds can be told against it.
 */

/** A photograph as its paths so far average it, and what the camera first met in each pixel: its colour, which way it faces, how far it lies, nothing where it met nothing, and how far its brightness may stray from the average, as a variance. Three numbers a pixel for colours and ways, one for the rest. */
export interface Image {
  readonly width: number;
  readonly height: number;
  readonly radiance: Float32Array;
  readonly albedo: Float32Array;
  readonly normal: Float32Array;
  readonly depth: Float32Array;
  readonly variance: Float32Array;
}

/** How each neighbour weighs by how far it lies, as a cubic B-spline does, five taps across. */
export const KERNEL = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16] as const;

/** How many times the light is blurred, each twice as far apart. */
export const ITERATIONS = 5;

/** How sharply a neighbour facing apart is set aside, as a power of the cosine between them. */
export const FACING = 128;

/** How far a neighbour may lie from a pixel, as a share of how far the pixel lies for every pixel apart, before it is set aside. */
export const LYING = 0.05;

/** How far a neighbour's brightness may stray from a pixel's, in its standard deviations, before it is set aside. */
export const BRIGHTNESS = 4;

/** The least a colour is taken as, so dividing it out never divides by nothing. */
export const LEAST = 0.01;

const brightness = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** `image` with its noise smoothed away, three numbers a pixel. */
export const denoised = (image: Image): Float32Array => {
  const { width, height, radiance, albedo, normal, depth, variance } = image;
  const count = width * height;
  const coloured = (pixel: number, part: number) => Math.max(albedo[pixel * 3 + part] ?? 0, LEAST);
  // The light alone, the colour of what it fell on divided out, and how far its brightness may stray.
  let light = new Float32Array(count * 3);
  let straying = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel++) {
    for (let part = 0; part < 3; part++) {
      light[pixel * 3 + part] = (radiance[pixel * 3 + part] ?? 0) / coloured(pixel, part);
    }
    const shade = brightness(coloured(pixel, 0), coloured(pixel, 1), coloured(pixel, 2));
    straying[pixel] = (variance[pixel] ?? 0) / (shade * shade);
  }
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const step = 1 << iteration;
    const next = new Float32Array(count * 3);
    const nextStraying = new Float32Array(count);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const lying = depth[pixel] ?? 0;
        if (lying <= 0) {
          continue;
        }
        const here = brightness(
          light[pixel * 3] ?? 0,
          light[pixel * 3 + 1] ?? 0,
          light[pixel * 3 + 2] ?? 0,
        );
        const deviation = Math.sqrt(Math.max(straying[pixel] ?? 0, 0));
        let total = 0;
        let strayed = 0;
        const sum = [0, 0, 0];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const qx = x + dx * step;
            const qy = y + dy * step;
            if (qx < 0 || qy < 0 || qx >= width || qy >= height) {
              continue;
            }
            const other = qy * width + qx;
            const otherLying = depth[other] ?? 0;
            if (otherLying <= 0) {
              continue;
            }
            const facing = Math.max(
              (normal[pixel * 3] ?? 0) * (normal[other * 3] ?? 0) +
                (normal[pixel * 3 + 1] ?? 0) * (normal[other * 3 + 1] ?? 0) +
                (normal[pixel * 3 + 2] ?? 0) * (normal[other * 3 + 2] ?? 0),
              0,
            );
            const apart = Math.hypot(dx, dy) * step;
            const there = brightness(
              light[other * 3] ?? 0,
              light[other * 3 + 1] ?? 0,
              light[other * 3 + 2] ?? 0,
            );
            const weight =
              (KERNEL[dx + 2] ?? 0) *
              (KERNEL[dy + 2] ?? 0) *
              facing ** FACING *
              Math.exp(-Math.abs(lying - otherLying) / (LYING * lying * apart + 1e-6)) *
              Math.exp(-Math.abs(here - there) / (BRIGHTNESS * deviation + 1e-6));
            total += weight;
            strayed += weight * weight * (straying[other] ?? 0);
            for (let part = 0; part < 3; part++) {
              sum[part] = (sum[part] ?? 0) + weight * (light[other * 3 + part] ?? 0);
            }
          }
        }
        for (let part = 0; part < 3; part++) {
          next[pixel * 3 + part] = (sum[part] ?? 0) / total;
        }
        nextStraying[pixel] = strayed / (total * total);
      }
    }
    light = next;
    straying = nextStraying;
  }
  // The colour multiplied back in; what met nothing as it was.
  const result = new Float32Array(count * 3);
  for (let pixel = 0; pixel < count; pixel++) {
    for (let part = 0; part < 3; part++) {
      result[pixel * 3 + part] =
        (depth[pixel] ?? 0) > 0
          ? (light[pixel * 3 + part] ?? 0) * coloured(pixel, part)
          : (radiance[pixel * 3 + part] ?? 0);
    }
  }
  return result;
};
