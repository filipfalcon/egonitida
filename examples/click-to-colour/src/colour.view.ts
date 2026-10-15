import { View } from '@nitida/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Colour from '#src/colour.ts';

/** Every cube, as a box where it stands, in the colour it is painted. */
export const cubes = View.each([Colour.Cube, Colour.Paint], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () => new Three.Mesh(new Three.BoxGeometry(1, 1, 1), new Three.MeshStandardNodeMaterial()),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    mesh.position.x = held(Colour.Cube).x;
    mesh.material.color.setHex(Colour.PALETTE[held(Colour.Paint).shade] ?? 0xffffff);
  },
});

export const views = [cubes];
