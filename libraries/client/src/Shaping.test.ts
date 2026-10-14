import { describe, expect, it } from '@effect/vitest';
import { Component, State } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import * as Three from 'three/webgpu';
import * as Scene from '#src/Scene.ts';
import * as Shaping from '#src/Shaping.ts';
import * as View from '#src/View.ts';

/** A mesh of one triangle carrying a morph target for each of `targets`, each moving its corners up by one. */
const meshWith = (name: string, targets: ReadonlyArray<string>) => {
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute(
    'position',
    new Three.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.morphAttributes.position = targets.map((target) => {
    const moved = new Three.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3);
    moved.name = target;
    return moved;
  });
  const mesh = new Three.Mesh(geometry, new Three.MeshBasicNodeMaterial());
  mesh.name = name;
  return mesh;
};

/** A figure as a model is delivered: a body, a shirt that follows its bust and hips, and teeth that follow neither. */
const figure = () => {
  const model = new Three.Group();
  model.add(
    meshWith('body', ['hips-decr', 'hips-incr', 'breast-size']),
    meshWith('shirt', ['hips-decr', 'hips-incr', 'breast-size']),
    meshWith('teeth', []),
  );
  return model;
};

/** The weight `mesh` gives `target` now, if it carries it. */
const weightOf = (model: Three.Object3D, mesh: string, target: string) =>
  Option.flatMap(Option.fromNullishOr(model.getObjectByName(mesh)), (found) =>
    found instanceof Three.Mesh
      ? Option.flatMap(Option.fromNullishOr(found.morphTargetDictionary?.[target]), (index) =>
          Option.fromNullishOr(found.morphTargetInfluences?.[index]),
        )
      : Option.none(),
  );

const shaping = Shaping.make({
  hips: Shaping.morph({ less: 'hips-decr', more: 'hips-incr' }),
  bust: Shaping.morph('breast-size'),
});

describe('Shaping.fit', () => {
  it.effect('refuses a model that carries no morph target a dial turns, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Shaping.fit(
          figure(),
          Shaping.make({
            bust: Shaping.morph('breast-size'),
            cheeks: Shaping.morph('cheeks-full'),
            waist: Shaping.morph({ less: 'waist-decr', more: 'waist-incr' }),
          }),
        ),
      );

      expect(unfitted._tag).toEqual('Unfitted');
      expect(unfitted.absent).toEqual(['cheeks-full', 'waist-decr', 'waist-incr']);
    }),
  );
});

describe('Shaped.shape', () => {
  it.effect('turns a morph target on every mesh that carries it, and no other', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(figure(), shaping);

      shaped.shape({ hips: 0, bust: 0.4 });

      expect(weightOf(shaped, 'body', 'breast-size')).toEqual(Option.some(0.4));
      expect(weightOf(shaped, 'shirt', 'breast-size')).toEqual(Option.some(0.4));
      expect(weightOf(shaped, 'body', 'hips-incr')).toEqual(Option.some(0));
    }),
  );

  it.effect('turns a dial of two targets to one side at a time, by how far from nothing', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(figure(), shaping);

      shaped.shape({ hips: -0.5, bust: 0 });
      const narrower = [
        weightOf(shaped, 'body', 'hips-decr'),
        weightOf(shaped, 'body', 'hips-incr'),
      ];
      shaped.shape({ hips: 0.25, bust: 0 });
      const wider = [weightOf(shaped, 'body', 'hips-decr'), weightOf(shaped, 'body', 'hips-incr')];

      expect(narrower).toEqual([Option.some(0.5), Option.some(0)]);
      expect(wider).toEqual([Option.some(0), Option.some(0.25)]);
    }),
  );

  it.effect('shapes the model as the values say, whatever it was shaped before', () =>
    Effect.gen(function* () {
      const once = yield* Shaping.fit(figure(), shaping);
      const often = yield* Shaping.fit(figure(), shaping);

      once.shape({ hips: 0.3, bust: 0.6 });
      often.shape({ hips: -1, bust: 1 });
      often.shape({ hips: 0.3, bust: 0.6 });
      often.shape({ hips: 0.3, bust: 0.6 });

      for (const [mesh, target] of [
        ['body', 'hips-decr'],
        ['body', 'hips-incr'],
        ['shirt', 'breast-size'],
      ] as const) {
        expect(weightOf(often, mesh, target)).toEqual(weightOf(once, mesh, target));
      }
    }),
  );
});

/** How a figure is shaped, as a player chose it. */
const Shape = Component.make('Shape', Schema.Struct({ hips: Schema.Finite, bust: Schema.Finite }), {
  owner: 'rules',
  network: 'server',
});

const figures = View.each([Shape], {
  acquire: () => Effect.orDie(Shaping.fit(figure(), shaping)),
  draw: (shaped, held) => {
    shaped.shape(held(Shape));
  },
});

it.effect('draws a figure shaped as the state holds it', () =>
  Effect.gen(function* () {
    const [state, her] = State.spawn(State.empty({ seed: 1 }), [
      Shape.of({ hips: 0.2, bust: 0.7 }),
    ]);
    const scene = yield* Scene.make([figures]);

    yield* scene.show(state);
    const shaped = scene.find(figures, her);

    expect(Option.flatMap(shaped, (drawn) => weightOf(drawn, 'shirt', 'breast-size'))).toEqual(
      Option.some(0.7),
    );
    expect(Option.flatMap(shaped, (drawn) => weightOf(drawn, 'body', 'hips-incr'))).toEqual(
      Option.some(0.2),
    );
  }),
);

/** A leg as a model is delivered: a hip, a knee a metre below it, and a foot `shin` below that, a metre unless told, with its skin a point at each, and one halfway down the shin, held by the knee and the foot alike. */
const leg = (shin = 1) => {
  const hip = new Three.Bone();
  hip.name = 'hip';
  const knee = new Three.Bone();
  knee.name = 'knee';
  knee.position.set(0, -1, 0);
  const foot = new Three.Bone();
  foot.name = 'foot';
  foot.position.set(0, -shin, 0);
  hip.add(knee);
  knee.add(foot);
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute(
    'position',
    new Three.Float32BufferAttribute([0, 0, 0, 0, -1, 0, 0, -1 - shin / 2, 0, 0, -1 - shin, 0], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new Three.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 2, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new Three.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0], 4),
  );
  const mesh = new Three.SkinnedMesh(geometry, new Three.MeshBasicNodeMaterial());
  mesh.name = 'leg';
  mesh.add(hip);
  const model = new Three.Group();
  model.add(mesh);
  mesh.bind(new Three.Skeleton([hip, knee, foot]));
  return model;
};

/** The leg's skin, its points as made: at the hip, the knee, halfway down the shin, and the foot. */
const HIP = 0;
const KNEE = 1;
const SHIN = 2;
const FOOT = 3;

const legs = Shaping.make({ legs: Shaping.lengthen(['foot'], { by: 0.5 }) });

/** The skinned mesh of `model` named `name`, if it has one. */
const skinnedIn = (model: Three.Object3D, name: string) =>
  Option.flatMap(Option.fromNullishOr(model.getObjectByName(name)), (found) =>
    found instanceof Three.SkinnedMesh ? Option.some(found) : Option.none(),
  );

/** Where the leg's point `at` is drawn, as its bones hold it now. */
const drawnAt = (model: Three.Object3D, at: number) => {
  model.updateMatrixWorld(true);
  return Option.map(skinnedIn(model, 'leg'), (mesh) =>
    mesh.getVertexPosition(at, new Three.Vector3()),
  );
};

/** How far `drawn` is from `x`, `y`, `z`, or Infinity if nothing was drawn. */
const distanceFrom = (drawn: Option.Option<Three.Vector3>, x: number, y: number, z: number) =>
  Option.match(drawn, {
    onNone: () => Infinity,
    onSome: (point) => point.distanceTo(new Three.Vector3(x, y, z)),
  });

describe('Shaping.lengthen', () => {
  it.effect('refuses a model that has no bone a dial lengthens, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Shaping.fit(
          leg(),
          Shaping.make({ legs: Shaping.lengthen(['shin', 'foot', 'toe'], { by: 1 }) }),
        ),
      );

      expect(unfitted.absent).toEqual(['shin', 'toe']);
    }),
  );

  it.effect("draws a bone's offset from its parent out, and the skin it holds with it", () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(leg(), legs);

      shaped.shape({ legs: 1 });

      expect(distanceFrom(drawnAt(shaped, HIP), 0, 0, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, KNEE), 0, -1, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, SHIN), 0, -1.75, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, FOOT), 0, -2.5, 0)).toBeLessThan(1e-6);
    }),
  );

  it.effect('draws a bone in as far as a value below nothing', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(leg(), legs);

      shaped.shape({ legs: -1 });

      expect(distanceFrom(drawnAt(shaped, FOOT), 0, -1.5, 0)).toBeLessThan(1e-6);
    }),
  );

  it.effect('bends a lengthened model as one made that long bends', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(leg(), legs);
      const madeLong = leg(1.5);

      shaped.shape({ legs: 1 });
      for (const model of [shaped, madeLong]) {
        model.getObjectByName('knee')?.rotation.set(0, 0, Math.PI / 2);
        model.getObjectByName('foot')?.rotation.set(0, 0, Math.PI / 2);
      }

      for (const at of [HIP, KNEE, SHIN, FOOT]) {
        const expected = Option.getOrThrow(drawnAt(madeLong, at));
        expect(distanceFrom(drawnAt(shaped, at), expected.x, expected.y, expected.z)).toBeLessThan(
          1e-6,
        );
      }
    }),
  );

  it.effect('leaves the model exactly as it was made at nothing', () =>
    Effect.gen(function* () {
      const made = leg();
      const positions = Option.map(skinnedIn(made, 'leg'), (mesh) => [
        ...mesh.geometry.getAttribute('position').array,
      ]);
      const inverses = Option.map(skinnedIn(made, 'leg'), (mesh) =>
        mesh.skeleton.boneInverses.map((inverse) => [...inverse.elements]),
      );
      const shaped = yield* Shaping.fit(made, legs);

      shaped.shape({ legs: 1 });
      shaped.shape({ legs: 0 });

      expect(
        Option.map(skinnedIn(shaped, 'leg'), (mesh) => [
          ...mesh.geometry.getAttribute('position').array,
        ]),
      ).toEqual(positions);
      expect(
        Option.map(skinnedIn(shaped, 'leg'), (mesh) =>
          mesh.skeleton.boneInverses.map((inverse) => [...inverse.elements]),
        ),
      ).toEqual(inverses);
      expect(shaped.getObjectByName('foot')?.position.toArray()).toEqual([0, -1, 0]);
    }),
  );

  it.effect('lengthens the model as the values say, whatever it was lengthened before', () =>
    Effect.gen(function* () {
      const once = yield* Shaping.fit(leg(), legs);
      const often = yield* Shaping.fit(leg(), legs);

      once.shape({ legs: 0.5 });
      often.shape({ legs: -1 });
      often.shape({ legs: 1 });
      often.shape({ legs: 0.5 });

      for (const at of [HIP, KNEE, SHIN, FOOT]) {
        const expected = Option.getOrThrow(drawnAt(once, at));
        expect(distanceFrom(drawnAt(often, at), expected.x, expected.y, expected.z)).toBeLessThan(
          1e-6,
        );
      }
    }),
  );
});
