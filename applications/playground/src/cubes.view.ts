import { View } from '@egonitida/client';
import { Effect, Schema } from 'effect';
import * as Three from 'three/webgpu';
import * as Cubes from '#src/cubes.ts';
import type * as Look from '#src/look.ts';

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

/** Where the player looks at the cubes from: ahead of the grid, or straight down onto it. The player chooses it once, and the page keeps it in its Model. */
export const Viewpoint = Schema.Literals(['Ahead', 'Overhead']);
export type Viewpoint = typeof Viewpoint.Type;

/** How the cubes are seen, which changes only how they are drawn for the player, so the views read it as the drawing's input: from where the page says, looked around as far as the player's devices turned them every frame. */
export interface Seen {
  readonly viewpoint: Viewpoint;
  readonly look: Look.Look;
}

/** How steeply the camera looks down from each viewpoint, where it stands, before the player looks around. */
const FROM: Readonly<
  Record<Viewpoint, { readonly at: Three.Vector3Tuple; readonly down: number }>
> = {
  Ahead: { at: [0, 3, 10], down: 0.25 },
  Overhead: { at: [0, 14, -2], down: Math.PI / 2 },
};

/** The camera, where the player looks from, turned as far as they looked around: about the upright first, then up or down, so the horizon stays level. */
export const looking = View.rig([], (camera, _held, _frame, _drawn, { viewpoint, look }: Seen) => {
  const { at, down } = FROM[viewpoint];
  camera.position.set(...at);
  camera.rotation.set(look.pitch - down, look.yaw, 0, 'YXZ');
});

/** The views of the cubes, and the camera they are seen through. */
export const views = [cubes, looking];
