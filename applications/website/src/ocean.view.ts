import { View } from '@lightocean/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Ocean from '#src/ocean.ts';

/** How far apart lights stand, in the scene's units. */
const SPACING = 1.1;

/** Where across the light at `across` stands: the square about the middle. */
export const xOf = (across: number) => (across - (Ocean.SIZE - 1) / 2) * SPACING;

/** How far back the light at `back` stands: the square about the middle. */
export const zOf = (back: number) => (back - (Ocean.SIZE - 1) / 2) * SPACING;

/** The glow of a light deep in a trough, and of one at a crest. */
const DEEP = new Three.Color(0x0a2a5c);
const CREST = new Three.Color(0x9fe8ff);

/** How high a light must stand to glow as a crest, and how low to glow as a trough. */
const TROUGH_HEIGHT = -0.4;
const CREST_HEIGHT = 0.8;

/** Every light, as a tile where its place in the square is, as high as it swells, glowing the brighter the higher it stands. */
export const lights = View.each([Ocean.Light, Ocean.Swell], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh(
            new Three.BoxGeometry(0.8, 0.2, 0.8),
            new Three.MeshStandardNodeMaterial({ color: 0x0b1530, roughness: 0.4 }),
          ),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    const { across, back } = held(Ocean.Light);
    const { height } = held(Ocean.Swell);
    mesh.position.set(xOf(across), height, zOf(back));
    const glow = Math.min(
      1,
      Math.max(0, (height - TROUGH_HEIGHT) / (CREST_HEIGHT - TROUGH_HEIGHT)),
    );
    mesh.material.emissive.copy(DEEP).lerp(CREST, glow);
  },
});

/** The views of the ocean. */
export const views = [lights];
