import { View } from '@egonitida/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Body from '#src/body.ts';
import * as Game from '#src/game.ts';
import * as Horde from '#src/horde.ts';

/** How long a shot is seen after it is fired, in steps. */
const SHOT_STEPS = Math.round(0.08 * Game.game.stepRate);

/** Every zombie, upright where it shambles; a fallen one lies where it fell and sinks into the floor until it is gone. */
export const zombies = View.each([Horde.Zombie, Body.Position], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const body = new Three.Mesh(
          new Three.CapsuleGeometry(0.3, 0.9),
          new Three.MeshStandardNodeMaterial({ color: 0x6b8e4e }),
        );
        return body;
      }),
      (body) =>
        Effect.sync(() => {
          body.geometry.dispose();
          body.material.dispose();
        }),
    ),
  draw: (body, held, frame) => {
    const { x, z } = held(Body.Position);
    const mode = held(Horde.Zombie);
    if (mode._tag === 'Shambling') {
      body.position.set(x, 0.75, z);
      body.rotation.x = 0;
      return;
    }
    const lain = (frame.tick - mode.at) / (Horde.FALLEN_SECONDS * Game.game.stepRate);
    body.position.set(x, 0.3 - Math.min(lain, 1) * 0.6, z);
    body.rotation.x = -Math.PI / 2;
  },
});

/** Every survivor's last shot, as a streak from the gun to where it stopped, seen only the moment it is fired. */
export const shots = View.each([Horde.LastShot], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const geometry = new Three.BufferGeometry();
        geometry.setAttribute('position', new Three.Float32BufferAttribute(new Float32Array(6), 3));
        return new Three.Line(geometry, new Three.LineBasicNodeMaterial({ color: 0xfff1a8 }));
      }),
      (line) =>
        Effect.sync(() => {
          line.geometry.dispose();
          line.material.dispose();
        }),
    ),
  draw: (line, held, frame) => {
    const { at, from, to } = held(Horde.LastShot);
    const ends = line.geometry.getAttribute('position');
    ends.setXYZ(0, from.x, 1, from.z);
    ends.setXYZ(1, to.x, 1, to.z);
    ends.needsUpdate = true;
    line.visible = frame.tick - at < SHOT_STEPS;
  },
});

export const views = [zombies, shots];
