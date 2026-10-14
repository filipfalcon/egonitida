import { Option } from 'effect';

/**
 * Ray tracing: light worked out by following rays from what is drawn, as light travels, rather than guessed from the surface alone. Two things are traced: the light surfaces cast on one another, a red wall reddening the floor beside it and corners darkening where little reaches them (indirect light and its occlusion), and what surfaces reflect.
 *
 * Rays are traced through one of two things:
 *
 * - `Screen` traces them through the picture just drawn, its depth and its surfaces, as software ray tracing does: cheap, and running wherever WebGPU does, but it knows only what is on the screen, so what lies behind the camera, off its edges, or behind something else casts nothing.
 * - `Scene` traces them through the scene's own triangles, held in two levels of bounding volume hierarchy, a hierarchy for each shape and one over where the shapes stand, as ray-tracing hardware holds a scene: it meets what is off the screen and behind as well, so occlusion and reflections hold wherever the camera turns, and what moves costs only the top level, built again each frame. It traces on the graphics device's shader cores, as no browser yet lets a page reach the cores made for rays; what a ray meets that is on the screen is lit as drawn, and what is not, by its colour in the scene's ambient light.
 *
 * Tracing through the scene, it shadows the direct light too: from every surface drawn, a ray to every light that Three.js does not shadow with a shadow map, and what casts a shadow in its way, as Three.js marks a mesh that casts one, keeps that light from the surface. A level's torches stay on their side of the rock this way, with no map drawn for them.
 *
 * The light and the reflections are noisy from a few rays a pixel, and steadiest with temporal antialiasing, which blends the frames together.
 */
export type RayTracing = Screen | Scene;

/** What is traced, and at what share of the canvas's resolution, from a tenth to all of it. */
export interface Traced {
  readonly light: Option.Option<Light>;
  readonly reflections: Option.Option<Reflections>;
  readonly resolution: number;
}

/** Ray tracing through the picture just drawn. */
export interface Screen extends Traced {
  readonly _tag: 'Screen';
}

/** Ray tracing through the scene's own triangles, `rays` rays a pixel each frame for its light, and its direct light shadowed as `shadows` says. */
export interface Scene extends Traced {
  readonly _tag: 'Scene';
  readonly rays: number;
  readonly shadows: Option.Option<Shadows>;
}

/** The direct light's shadows: as dark as `strength` makes them, from none of the light kept from a surface to all of it. */
export interface Shadows {
  readonly strength: number;
}

/** Shadows as told: all of the light kept from what is in shadow, unless told otherwise. */
export const shadows = (told: Partial<Shadows> = {}): Shadows => ({
  strength: Math.min(Math.max(told.strength ?? 1, 0), 1),
});

/** The light surfaces cast on one another: as bright as `strength` makes it, 0 none and 1 as it works out; occlusion as dark as `occlusion` makes it, alike; and found as far as `radius`, in the scene's units. */
export interface Light {
  readonly strength: number;
  readonly occlusion: number;
  readonly radius: number;
}

/** What surfaces reflect: as strongly as `strength` makes it, 0 none and 1 as it works out, of what lies as far as `distance`, in the scene's units. */
export interface Reflections {
  readonly strength: number;
  readonly distance: number;
}

/** Indirect light as told, the rest as most scenes want it: as bright and as dark as it works out, found within four units. */
export const light = (told: Partial<Light> = {}): Light => ({
  strength: Math.max(told.strength ?? 1, 0),
  occlusion: Math.max(told.occlusion ?? 1, 0),
  radius: Math.max(told.radius ?? 4, 0),
});

/** Reflections as told, the rest as most scenes want them: as strong as they work out, of what lies within twenty units. */
export const reflections = (told: Partial<Reflections> = {}): Reflections => ({
  strength: Math.max(told.strength ?? 1, 0),
  distance: Math.max(told.distance ?? 20, 0),
});

/** What both ways of tracing are told: what to trace, light and reflections unless told none, and at what share of the resolution. */
interface Told {
  readonly light?: Option.Option<Light>;
  readonly reflections?: Option.Option<Reflections>;
  readonly resolution?: number;
}

/** What is traced, as told: light and reflections as most scenes want them unless told otherwise, at half the resolution. */
const tracedOf = (told: Told): Traced => ({
  light: told.light ?? Option.some(light()),
  reflections: told.reflections ?? Option.some(reflections()),
  resolution: Math.min(Math.max(told.resolution ?? 0.5, 0.1), 1),
});

/** Ray tracing through the picture just drawn, as told. */
export const screen = (told: Told = {}): Screen => ({ _tag: 'Screen', ...tracedOf(told) });

/** Ray tracing through the scene's own triangles, as told: two rays a pixel each frame for the light unless told otherwise, from one to sixteen, and the direct light shadowed unless told none. */
export const scene = (
  told: Told & { readonly rays?: number; readonly shadows?: Option.Option<Shadows> } = {},
): Scene => ({
  _tag: 'Scene',
  ...tracedOf(told),
  rays: Math.min(Math.max(Math.round(told.rays ?? 2), 1), 16),
  shadows: told.shadows ?? Option.some(shadows()),
});
