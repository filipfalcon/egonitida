import { View } from '@lightocean/client';
import { Effect, Schema } from 'effect';
import * as Three from 'three/webgpu';
import * as Cubes from '#src/cubes.ts';

/** The axis every cube turns about, tilted so a turn shows more than one face. */
const AXIS = new Three.Vector3(0.3, 1, 0.2).normalize();

/** How fast the cube in `slot` turns, in radians a second: one of three speeds, so neighbours turn apart. */
const speedOf = (slot: number) => 0.8 + (slot % 3) * 0.3;

/** Every cube, as a box where its place in the grid is, in the colour it is painted, turning as time goes on. */
export const cubes = View.each([Cubes.Cube, Cubes.Paint], {
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
  draw: (mesh, held, frame) => {
    const { slot } = held(Cubes.Cube);
    mesh.position.set(Cubes.xOf(slot), 0, Cubes.zOf(slot));
    mesh.material.color.setHex(Cubes.PALETTE[held(Cubes.Paint).shade] ?? 0xffffff);
    mesh.quaternion.setFromAxisAngle(AXIS, (frame.tick / Cubes.game.stepRate) * speedOf(slot));
  },
});

/** Where the player looks at the cubes from: ahead of the grid, or straight down onto it. It changes only how the cubes are drawn for them, so the page keeps it, and gives it to the views as the drawing's input. */
export const Viewpoint = Schema.Literals(['Ahead', 'Overhead']);
export type Viewpoint = typeof Viewpoint.Type;

/** The camera, where the player looks from. */
export const looking = View.rig([], (camera, _held, _frame, _drawn, viewpoint: Viewpoint) => {
  if (viewpoint === 'Ahead') {
    camera.position.set(0, 3, 10);
    camera.rotation.set(-0.25, 0, 0);
  } else {
    camera.position.set(0, 14, -2);
    camera.rotation.set(-Math.PI / 2, 0, 0);
  }
});

/** The views of the cubes, and the camera they are seen through. */
export const views = [cubes, looking];
