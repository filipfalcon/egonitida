import { Data, Effect } from 'effect';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type * as Three from 'three/webgpu';
import url from '#src/footballer.glb?url';

/**
 * The baller's model, loaded from `footballer.glb`: her feet at her origin and her front toward +z, as glTF has it, the same file her bones, joints, and touch points are read from as the game is built.
 */

/** Her model could not be loaded, and why. */
export class Unloaded extends Data.TaggedError('Unloaded')<{ readonly reason: string }> {}

/** Her model, loaded. */
export const load: Effect.Effect<Three.Object3D, Unloaded> = Effect.map(
  Effect.tryPromise({
    try: () => new GLTFLoader().loadAsync(url),
    catch: (cause) => new Unloaded({ reason: `${url}: ${String(cause)}` }),
  }),
  ({ scene }) => scene,
);
