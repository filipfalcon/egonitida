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
