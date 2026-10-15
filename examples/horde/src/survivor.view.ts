import { Haptics, Lighting, View } from '@nitida/client';
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

/** How a bite feels, and harder the bite that kills. */
export const BITE: Haptics.Rumble = { strong: 0.4, weak: 0.8, seconds: 0.15 };
export const DEATH: Haptics.Rumble = { strong: 1, weak: 1, seconds: 0.6 };
/** A gun's trigger: it pushes back over a stretch of its travel and gives way just before it fires. */
export const GUN: Haptics.Triggers = {
  left: Haptics.free,
  right: { _tag: 'Clicking', from: 0.2, to: 0.45, strength: 0.8 },
};

/** What a survivor's player feels: a bite, the bite that kills harder, and their gun's trigger while they live. */
export const felt = View.on(Survivor.Life, (life, frame, survivor) =>
  Effect.gen(function* () {
    const haptics = yield* Haptics.Haptics;
    // A survivor who comes into the arena hurt, or dead, was not hurt just now.
    const arrived = frame.gained(Survivor.Life).includes(survivor);
    if (life._tag === 'Dead') {
      if (!arrived) {
        yield* haptics.rumble(survivor, DEATH);
      }
      yield* haptics.triggers(survivor, Haptics.freeTriggers);
      return;
    }
    if (life.health < Survivor.HEALTH && !arrived) {
      yield* haptics.rumble(survivor, BITE);
    }
    yield* haptics.triggers(survivor, GUN);
  }),
);

/** The light of a dead survivor's player: a dim red. */
export const DEAD_LIGHT: Lighting.Colour = { red: 0.2, green: 0, blue: 0 };

/** What a survivor's player's lights show: how much health they have left, green while whole and redder as it runs out, and a dim red once they are dead. */
export const lit = View.on(Survivor.Life, (life, _frame, survivor) =>
  Effect.gen(function* () {
    const lighting = yield* Lighting.Lighting;
    if (life._tag === 'Dead') {
      yield* lighting.colour(survivor, DEAD_LIGHT);
      return;
    }
    const left = life.health / Survivor.HEALTH;
    yield* lighting.colour(survivor, { red: 1 - left, green: left, blue: 0 });
  }),
);

/** Every view of survivors, with what they need: haptics and lighting for what their player feels and sees. */
export const views: ReadonlyArray<View.View<Haptics.Haptics | Lighting.Lighting>> = [
  survivors,
  felt,
  lit,
];
