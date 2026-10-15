import { describe, expect, it } from '@effect/vitest';
import { Ragdoll } from '@nitida/core';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Ragdolling from '#src/Ragdolling.ts';

/** A body standing at the origin as a model is delivered: a pelvis a metre up, a hip a fifth of a metre to each side of it, a knee half a metre below each hip, and a foot half a metre below each knee; a chest half a metre above the pelvis. */
const figure = () => {
  const bone = (name: string, x: number, y: number, parent: Three.Object3D) => {
    const made = new Three.Bone();
    made.name = name;
    made.position.set(x, y, 0);
    parent.add(made);
    return made;
  };
  const model = new Three.Group();
  const pelvis = bone('pelvis', 0, 1, model);
  bone('chest', 0, 0.5, pelvis);
  for (const [side, x] of [
    ['l', 0.2],
    ['r', -0.2],
  ] as const) {
    const hip = bone(`hip_${side}`, x, 0, pelvis);
    const knee = bone(`knee_${side}`, 0, -0.5, hip);
    bone(`foot_${side}`, 0, -0.5, knee);
  }
  return model;
};

const ragdolling = Ragdolling.make({
  pelvis: { toward: 'chest', side: ['hip_r', 'hip_l'] },
  hip_l: { toward: 'knee_l' },
  knee_l: { toward: 'foot_l' },
  hip_r: { toward: 'knee_r' },
  knee_r: { toward: 'foot_r' },
});

/** Where the bone `name` of `model` stands in the world now. */
const worldOf = (model: Three.Object3D, name: string) => {
  model.updateMatrixWorld(true);
  return (
    model.getObjectByName(name)?.getWorldPosition(new Three.Vector3()) ?? new Three.Vector3(NaN)
  );
};

/** How far `a` is from `x`, `y`, `z`. */
const off = (a: Three.Vector3, x: number, y: number, z: number) =>
  a.distanceTo(new Three.Vector3(x, y, z));

/** The points of the figure lying on its back along +x, its feet toward +x, a tenth of a metre up. */
const lying: Ragdolling.Points = {
  pelvis: { x: 0, y: 0.1, z: 0 },
  chest: { x: -0.5, y: 0.1, z: 0 },
  hip_l: { x: 0, y: 0.1, z: -0.2 },
  hip_r: { x: 0, y: 0.1, z: 0.2 },
  knee_l: { x: 0.5, y: 0.1, z: -0.2 },
  knee_r: { x: 0.5, y: 0.1, z: 0.2 },
  foot_l: { x: 1, y: 0.1, z: -0.2 },
  foot_r: { x: 1, y: 0.1, z: 0.2 },
};

describe('Ragdolling.fit', () => {
  it.effect('refuses a model that has no bone a ragdoll moves, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Ragdolling.fit(
          figure(),
          Ragdolling.make({ pelvis: { toward: 'neck' }, elbow_l: { toward: 'hand_l' } }),
        ),
      );

      expect(unfitted.absent).toEqual(['neck', 'elbow_l', 'hand_l']);
    }),
  );
});

describe('Ragdolled.pose', () => {
  it.effect(
    'stands its root where its point is, and turns each bone toward the next, so every joint lies where the ragdoll does',
    () =>
      Effect.gen(function* () {
        const model = figure();
        const ragdolled = yield* Ragdolling.fit(model, ragdolling);

        ragdolled.pose(lying, 1);

        expect(off(worldOf(model, 'pelvis'), 0, 0.1, 0)).toBeLessThan(1e-6);
        expect(off(worldOf(model, 'chest'), -0.5, 0.1, 0)).toBeLessThan(1e-6);
        expect(off(worldOf(model, 'knee_l'), 0.5, 0.1, -0.2)).toBeLessThan(1e-6);
        expect(off(worldOf(model, 'foot_r'), 1, 0.1, 0.2)).toBeLessThan(1e-6);
      }),
  );

  it.effect('lies where the ragdoll does wherever the model stands and however it is turned', () =>
    Effect.gen(function* () {
      const model = figure();
      const placed = new Three.Group();
      placed.position.set(3, 0, -2);
      placed.rotation.y = 1.1;
      placed.add(model);
      const ragdolled = yield* Ragdolling.fit(model, ragdolling);

      ragdolled.pose(lying, 1);

      expect(off(worldOf(placed, 'pelvis'), 0, 0.1, 0)).toBeLessThan(1e-6);
      expect(off(worldOf(placed, 'foot_l'), 1, 0.1, -0.2)).toBeLessThan(1e-6);
    }),
  );

  it.effect('leaves the pose it had at nothing, and goes over to the ragdoll by its weight', () =>
    Effect.gen(function* () {
      const model = figure();
      const ragdolled = yield* Ragdolling.fit(model, ragdolling);
      const standing = worldOf(model, 'foot_l');

      ragdolled.pose(lying, 0);
      const untouched = worldOf(model, 'foot_l');
      ragdolled.pose(lying, 0.5);
      const halfway = worldOf(model, 'pelvis');

      expect(untouched.distanceTo(standing)).toBeLessThan(1e-6);
      expect(off(halfway, 0, 0.55, 0)).toBeLessThan(1e-6);
    }),
  );

  it.effect(
    'turns its root about where it aims as its side says, its left hip where the ragdoll has it',
    () =>
      Effect.gen(function* () {
        const model = figure();
        const ragdolled = yield* Ragdolling.fit(model, ragdolling);
        // Lying on its front instead: its left hip toward +z.
        const front: Ragdolling.Points = {
          ...lying,
          hip_l: { x: 0, y: 0.1, z: 0.2 },
          hip_r: { x: 0, y: 0.1, z: -0.2 },
        };

        ragdolled.pose(front, 1);

        expect(off(worldOf(model, 'hip_l'), 0, 0.1, 0.2)).toBeLessThan(1e-6);
      }),
  );
});

describe('Ragdolling.mpfb', () => {
  it('aims only at the points the ragdoll MPFB figures fall as has, every one of them aimed or aimed at', () => {
    const named = new Set(
      Object.entries(Ragdolling.mpfb.aims).flatMap(([bone, { toward, side }]) => [
        bone,
        toward,
        ...(side ?? []),
      ]),
    );

    expect([...named].sort()).toEqual([...Ragdoll.mpfb.names].sort());
  });

  it('turns her trunk about its sides, her limbs and her head the shortest way', () => {
    expect(Ragdolling.mpfb.aims['pelvis']?.side).toEqual(['thigh_r', 'thigh_l']);
    expect(Ragdolling.mpfb.aims['spine_03']?.side).toEqual(['upperarm_r', 'upperarm_l']);
    expect(Ragdolling.mpfb.aims['calf_l']).toEqual({ toward: 'foot_l' });
  });
});
