import { View } from '@lightocean/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Body from '#src/body.ts';
import * as Survivor from '#src/survivor.ts';

const ALIVE = 0xe8d5b0;
const DEAD = 0x5a5550;

/** A mesh, with what it is made of let go once it is. */
const mesh = (geometry: Three.BufferGeometry, color: number) =>
  Effect.acquireRelease(
    Effect.sync(() => new Three.Mesh(geometry, new Three.MeshStandardNodeMaterial({ color }))),
    (made) =>
      Effect.sync(() => {
        made.geometry.dispose();
        made.material.dispose();
      }),
  );

/** Every survivor, as a figure with a gun, standing where they stand and turned the way they aim; a dead one lies grey. */
export const survivors = View.each([Survivor.Life, Body.Position, Survivor.Stick], {
  acquire: () =>
    Effect.gen(function* () {
      const torso = yield* mesh(new Three.CapsuleGeometry(0.3, 0.9), ALIVE);
      const gun = yield* mesh(new Three.BoxGeometry(0.6, 0.1, 0.1), 0x222222);
      gun.position.set(0.4, 0.25, 0.2);
      torso.add(gun);
      return torso;
    }),
  draw: (torso, held) => {
    const { x, z } = held(Body.Position);
    const dead = held(Survivor.Life)._tag === 'Dead';
    torso.position.set(x, dead ? 0.3 : 0.75, z);
    torso.rotation.set(0, -held(Survivor.Stick).aim, dead ? Math.PI / 2 : 0);
    torso.material.color.setHex(dead ? DEAD : ALIVE);
  },
});

export const views = [survivors];
