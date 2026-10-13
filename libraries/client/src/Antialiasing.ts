/**
 * How a viewport smooths the jagged edges of what it draws, and the shimmer within it. Each way trades sharpness, steadiness, and cost differently:
 *
 * - `None` draws one sample a pixel: the cheapest, and sharp, with every edge jagged.
 * - `Multisample` (MSAA) samples each pixel's edges of geometry four times: sharp, but it smooths nothing within a surface.
 * - `Morphological` (SMAA) finds edges in the drawn picture and blends across them: cheap, and steady, but it cannot tell an edge from a detail, and softens fine ones.
 * - `Supersample` (SSAA) draws the whole scene several times a frame, each a fraction of a pixel aside, and averages them: the best there is, at as many times the cost.
 * - `Temporal` (TAA) draws the scene a fraction of a pixel aside each frame and blends each frame into the ones before, following what moved: it smooths edges, shimmer, and the noise of ambient occlusion alike, softer than the rest, and leaving a faint trail behind what moves fast. Drawn at a share of the resolution, it brings the picture to the whole from the frames before (TAAU), for less cost.
 */
export type Antialiasing =
  | None
  | Multisample
  | { readonly _tag: 'Morphological' }
  | Supersample
  | Temporal;

/** No antialiasing. */
export interface None {
  readonly _tag: 'None';
}

/** Multisampling, which the renderer does as it draws. */
export interface Multisample {
  readonly _tag: 'Multisample';
}

/** The antialiasing a renderer does alone as it draws, with no pass after it: none, or multisampling. */
export type Alone = None | Multisample;

/** Supersampling, `samples` times a frame. */
export interface Supersample {
  readonly _tag: 'Supersample';
  readonly samples: number;
}

/** Temporal antialiasing, drawn at `resolution`, a share of the canvas's. */
export interface Temporal {
  readonly _tag: 'Temporal';
  readonly resolution: number;
}

/** No antialiasing: one sample a pixel. */
export const none: None = { _tag: 'None' };

/** Multisampling: four samples a pixel along the edges of geometry, as many as a browser draws. */
export const multisample: Multisample = { _tag: 'Multisample' };

/** Morphological antialiasing: edges found in the drawn picture, and blended across. */
export const morphological: Antialiasing = { _tag: 'Morphological' };

/** Supersampling: the scene drawn `samples` times a frame, the nearest power of two from 2 to 32, four unless told. */
export const supersample = (samples = 4): Supersample => ({
  _tag: 'Supersample',
  samples: 2 ** Math.min(Math.max(Math.round(Math.log2(Math.max(samples, 1))), 1), 5),
});

/** Temporal antialiasing: drawn at `resolution`, a share of the canvas's from a half to all of it, and brought to the whole; all of it unless told. */
export const temporal = (told: { readonly resolution?: number } = {}): Temporal => ({
  _tag: 'Temporal',
  resolution: Math.min(Math.max(told.resolution ?? 1, 0.5), 1),
});

/** Whether `antialiasing` has the renderer draw several samples a pixel, which only multisampling does. */
export const multisampled = (antialiasing: Antialiasing): boolean =>
  antialiasing._tag === 'Multisample';
