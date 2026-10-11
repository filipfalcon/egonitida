import { View } from '@lightocean/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Objects from '#src/objects.ts';

/** A degree, in radians. */
const DEGREE = Math.PI / 180;

/** The unit shapes every object is drawn as, shared by them all, so changing an object's shape builds nothing. */
const BOX = new Three.BoxGeometry(1, 1, 1);
const SPHERE = new Three.SphereGeometry(0.5, 32, 16);

/** Every object, as its shape, where it stands, turned as it is set and as far as it has spun, sized, and in its colour. */
export const objects = View.each([Objects.Shape, Objects.Transform, Objects.Colour, Objects.Turn], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh<Three.BufferGeometry, Three.MeshStandardNodeMaterial>(
            BOX,
            new Three.MeshStandardNodeMaterial(),
          ),
      ),
      (mesh) => Effect.sync(() => mesh.material.dispose()),
    ),
  draw: (mesh, held) => {
    const { position, rotation, scale } = held(Objects.Transform);
    mesh.geometry = held(Objects.Shape).kind === 'Box' ? BOX : SPHERE;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(
      rotation[0] * DEGREE,
      rotation[1] * DEGREE + held(Objects.Turn).angle,
      rotation[2] * DEGREE,
    );
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.material.color.setHex(held(Objects.Colour).hex);
  },
});

export const views = [objects];
