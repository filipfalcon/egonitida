import { View } from '@nitida/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Walkers from '#src/walkers.ts';

/** Every walker, as a ball in its own colour where it stands. */
export const walkers = View.each([Walkers.Walker, Walkers.Position], {
  acquire: (held) =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh(
            new Three.SphereGeometry(0.4, 32, 16),
            new Three.MeshStandardNodeMaterial({
              color: new Three.Color().setHSL(held(Walkers.Walker).hue / 360, 0.7, 0.6),
            }),
          ),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    const { x, z } = held(Walkers.Position);
    mesh.position.set(x, 0.4, z);
  },
});

/** The views of the room. */
export const views = [walkers];
