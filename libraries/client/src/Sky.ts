import * as Three from 'three/webgpu';

/**
 * A sky as a picture all round a scene, as Three reads an environment: lighting what the scene holds from every way at once, and reflected in what shines, as a game draws it, and lighting a photograph's every path that leaves the scene, as `PathTracer` and `Photo` read it, so both are lit by the one sky.
 */

/** How many pixels the picture of a sky has, down it; it has twice as many across, a way for each. */
const HEIGHT = 32;

/** A sky as bright as `up` straight up, `down` straight down, and between them as far up as a way looks, `intensity` times, as a hemisphere light of those colours lights what it falls on: each way as bright as its colour times the intensity over π. */
export const gradient = (
  up: Three.Color,
  down: Three.Color,
  intensity: number,
): Three.DataTexture => {
  const width = HEIGHT * 2;
  const data = new Float32Array(width * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row++) {
    // Each row as far up as Three's equirectangular picture puts it, from straight down at the first.
    const rise = Math.sin(((row + 0.5) / HEIGHT - 0.5) * Math.PI);
    const share = 0.5 + 0.5 * rise;
    const scale = intensity / Math.PI;
    const colour = [
      (down.r + (up.r - down.r) * share) * scale,
      (down.g + (up.g - down.g) * share) * scale,
      (down.b + (up.b - down.b) * share) * scale,
    ];
    for (let column = 0; column < width; column++) {
      data.set([...colour, 1], (row * width + column) * 4);
    }
  }
  const sky = new Three.DataTexture(data, width, HEIGHT, Three.RGBAFormat, Three.FloatType);
  sky.mapping = Three.EquirectangularReflectionMapping;
  sky.colorSpace = Three.LinearSRGBColorSpace;
  sky.magFilter = Three.LinearFilter;
  sky.minFilter = Three.LinearFilter;
  sky.needsUpdate = true;
  return sky;
};
