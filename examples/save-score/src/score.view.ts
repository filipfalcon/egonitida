import { View } from '@nitida/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Score from '#src/score.ts';

/** Every target, as a ball where it stands. */
export const targets = View.each([Score.Target], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh(
            new Three.SphereGeometry(0.5, 32, 16),
            new Three.MeshStandardNodeMaterial({ color: 0xff6b6b }),
          ),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    const { x, z } = held(Score.Target);
    mesh.position.set(x, 0.5, z);
  },
});

/** The views of the round. */
export const views = [targets];
