import { View } from '@egonitida/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Cube from '#src/cube.ts';

/** Every cube, as a box turned as far as it has turned. */
export const cubes = View.each([Cube.Spin], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh(
            new Three.BoxGeometry(1, 1, 1),
            new Three.MeshStandardNodeMaterial({ color: 0x3fa7d6 }),
          ),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    mesh.rotation.y = held(Cube.Spin).angle;
  },
});

export const views = [cubes];
