import { describe, expect, it } from '@effect/vitest';
import { Component, Shape, State } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
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

const shaping = Shape.make({
  hips: Shape.morph({ less: 'hips-decr', more: 'hips-incr' }),
  bust: Shape.morph('breast-size'),
});

describe('Shaping.fit', () => {
  it.effect('refuses a model that carries no morph target a dial turns, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Shaping.fit(
          figure(),
          Shape.make({
            bust: Shape.morph('breast-size'),
            cheeks: Shape.morph('cheeks-full'),
            waist: Shape.morph({ less: 'waist-decr', more: 'waist-incr' }),
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
const Shaped = Component.make(
  'Shaped',
  Schema.Struct({ hips: Schema.Finite, bust: Schema.Finite }),
  {
    owner: 'rules',
    network: 'server',
  },
);

const figures = View.each([Shaped], {
  acquire: () => Effect.orDie(Shaping.fit(figure(), shaping)),
  draw: (shaped, held) => {
    shaped.shape(held(Shaped));
  },
});

it.effect('draws a figure shaped as the state holds it', () =>
  Effect.gen(function* () {
    const [state, her] = State.spawn(State.empty({ seed: 1 }), [
      Shaped.of({ hips: 0.2, bust: 0.7 }),
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

const legs = Shape.make({ legs: Shape.lengthen(['foot'], { by: 0.5 }) });

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

describe('a dial that lengthens', () => {
  it.effect('refuses a model that has no bone a dial lengthens, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Shaping.fit(
          leg(),
          Shape.make({ legs: Shape.lengthen(['shin', 'foot', 'toe'], { by: 1 }) }),
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

  it.effect(
    'lengthens each copy of one model on its own, as a game copies a model it loaded once for each of many',
    () =>
      Effect.gen(function* () {
        const loaded = leg();
        const short = yield* Shaping.fit(clone(loaded), legs);
        const long = yield* Shaping.fit(clone(loaded), legs);

        long.shape({ legs: 1 });
        short.shape({ legs: -1 });
        const later = yield* Shaping.fit(clone(loaded), legs);
        later.shape({ legs: 1 });

        // Each bent at the knee and the ankle, as one made as long as it was shaped bends.
        for (const [shaped, madeAs] of [
          [short, leg(0.5)],
          [long, leg(1.5)],
          [later, leg(1.5)],
        ] as const) {
          for (const model of [shaped, madeAs]) {
            model.getObjectByName('knee')?.rotation.set(0, 0, Math.PI / 2);
            model.getObjectByName('foot')?.rotation.set(0, 0, Math.PI / 2);
          }
          for (const at of [HIP, KNEE, SHIN, FOOT]) {
            const expected = Option.getOrThrow(drawnAt(madeAs, at));
            expect(
              distanceFrom(drawnAt(shaped, at), expected.x, expected.y, expected.z),
            ).toBeLessThan(1e-6);
          }
        }
      }),
  );

  it.effect(
    'lets go of the skin it copied to lengthen once its scope closes, and of nothing it was given',
    () =>
      Effect.gen(function* () {
        const loaded = leg();
        const given = Option.getOrThrow(skinnedIn(loaded, 'leg')).geometry;
        const released: Array<Three.BufferGeometry> = [];
        given.addEventListener('dispose', () => released.push(given));

        const copied = yield* Effect.scoped(
          Effect.map(Shaping.fit(clone(loaded), legs), (shaped) => {
            const geometry = Option.getOrThrow(skinnedIn(shaped, 'leg')).geometry;
            geometry.addEventListener('dispose', () => released.push(geometry));
            return geometry;
          }),
        );

        expect(copied).not.toBe(given);
        expect(released).toEqual([copied]);
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

/** A leg standing on the ground, as a figure stands: a root on the ground, a hip two metres over it, a knee a metre below the hip, and a foot a metre below that, on the ground, with its skin a point at each. */
const standing = () => {
  const root = new Three.Bone();
  root.name = 'root';
  const hip = new Three.Bone();
  hip.name = 'hip';
  hip.position.set(0, 2, 0);
  const knee = new Three.Bone();
  knee.name = 'knee';
  knee.position.set(0, -1, 0);
  const foot = new Three.Bone();
  foot.name = 'foot';
  foot.position.set(0, -1, 0);
  root.add(hip);
  hip.add(knee);
  knee.add(foot);
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute(
    'position',
    new Three.Float32BufferAttribute([0, 2, 0, 0, 1, 0, 0, 0, 0], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new Three.Uint16BufferAttribute([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new Three.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const mesh = new Three.SkinnedMesh(geometry, new Three.MeshBasicNodeMaterial());
  mesh.name = 'leg';
  mesh.add(root);
  const model = new Three.Group();
  model.add(mesh);
  mesh.bind(new Three.Skeleton([root, hip, knee, foot]));
  return model;
};

/** The standing leg's skin: its points at the hip, the knee, and the foot. */
const STANDING_HIP = 0;
const STANDING_FOOT = 2;

describe('a lengthening that raises', () => {
  const raising = Shape.make({
    legs: Shape.lengthen(['knee', 'foot'], { by: 0.5, raises: 'hip' }),
  });

  it.effect('refuses a model that has no bone a dial raises, naming it', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Shaping.fit(
          standing(),
          Shape.make({ legs: Shape.lengthen(['foot'], { by: 1, raises: 'pelvis' }) }),
        ),
      );

      expect(unfitted.absent).toEqual(['pelvis']);
    }),
  );

  it.effect(
    'raises the bone as much as the bones beneath it grew, so the foot stays on the ground',
    () =>
      Effect.gen(function* () {
        const shaped = yield* Shaping.fit(standing(), raising);

        shaped.shape({ legs: 1 });

        expect(distanceFrom(drawnAt(shaped, STANDING_HIP), 0, 3, 0)).toBeLessThan(1e-6);
        expect(distanceFrom(drawnAt(shaped, STANDING_FOOT), 0, 0, 0)).toBeLessThan(1e-6);
        expect(shaped.getObjectByName('hip')?.position.y).toBeCloseTo(3);
      }),
  );

  it.effect('lowers it as much as they shrank', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(standing(), raising);

      shaped.shape({ legs: -1 });

      expect(distanceFrom(drawnAt(shaped, STANDING_HIP), 0, 1, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, STANDING_FOOT), 0, 0, 0)).toBeLessThan(1e-6);
    }),
  );

  it.effect('says how far it draws each bone out from its parent, nothing changed as made', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(standing(), raising);
      const bone = (name: string) =>
        Option.getOrThrow(Option.fromNullishOr(shaped.getObjectByName(name)));
      const made = shaped.stretchOf(bone('hip'));

      shaped.shape({ legs: 1 });

      expect(made).toBeCloseTo(1);
      expect(shaped.stretchOf(bone('hip'))).toBeCloseTo(1.5);
      expect(shaped.stretchOf(bone('foot'))).toBeCloseTo(1.5);
      expect(shaped.stretchOf(bone('root'))).toBeCloseTo(1);
    }),
  );
});

describe('a dial that grows', () => {
  const knee = Shape.make({ knee: Shape.grow(['knee'], { by: 0.5 }) });

  it.effect('refuses a model that has no bone a dial grows, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Shaping.fit(leg(), Shape.make({ head: Shape.grow(['head'], { by: 1 }) })),
      );

      expect(unfitted.absent).toEqual(['head']);
    }),
  );

  it.effect('grows a bone whole, and everything below it with its skin, from where it stands', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(leg(), knee);

      shaped.shape({ knee: 1 });

      expect(distanceFrom(drawnAt(shaped, HIP), 0, 0, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, KNEE), 0, -1, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, SHIN), 0, -1.75, 0)).toBeLessThan(1e-6);
      expect(distanceFrom(drawnAt(shaped, FOOT), 0, -2.5, 0)).toBeLessThan(1e-6);
    }),
  );

  it.effect('bends a grown model as one made that big bends', () =>
    Effect.gen(function* () {
      const shaped = yield* Shaping.fit(leg(), knee);
      const madeLong = leg(1.5);

      shaped.shape({ knee: 1 });
      for (const model of [shaped, madeLong]) {
        model.getObjectByName('knee')?.rotation.set(0, 0, Math.PI / 2);
      }

      for (const at of [HIP, KNEE, FOOT]) {
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
      const shaped = yield* Shaping.fit(made, knee);

      shaped.shape({ knee: 1 });
      shaped.shape({ knee: 0 });

      expect(
        Option.map(skinnedIn(shaped, 'leg'), (mesh) => [
          ...mesh.geometry.getAttribute('position').array,
        ]),
      ).toEqual(positions);
      expect(shaped.getObjectByName('knee')?.scale.toArray()).toEqual([1, 1, 1]);
    }),
  );
});

describe('Shape.standing', () => {
  /** The bones of `model` as it stands now, by name, as `Shape.Bones` holds a model's bones as made. */
  const bonesOf = (model: Three.Object3D): Shape.Bones => {
    model.updateMatrixWorld(true);
    const bones: Record<string, Shape.Bone> = {};
    model.traverse((child) => {
      if (child instanceof Three.Bone) {
        const at = child.getWorldPosition(new Three.Vector3());
        bones[child.name] = {
          parent:
            child.parent instanceof Three.Bone ? Option.some(child.parent.name) : Option.none(),
          at: { x: at.x, y: at.y, z: at.z },
        };
      }
    });
    return bones;
  };

  it.effect('stands every bone where the model shaped by the same dials rests it', () =>
    Effect.gen(function* () {
      const model = standing();
      const made = bonesOf(model);
      const shape = Shape.make({
        legs: Shape.lengthen(['knee', 'foot'], { by: 0.5, raises: 'hip' }),
        shin: Shape.lengthen(['foot'], { by: 0.25 }),
        knee: Shape.grow(['knee'], { by: 0.5 }),
      });
      const values = { legs: 0.6, shin: -0.8, knee: 0.4 };
      const shaped = yield* Shaping.fit(model, shape);

      shaped.shape(values);
      const rested = bonesOf(shaped);
      const placed = Shape.standing(shape, made, values);

      for (const name of ['root', 'hip', 'knee', 'foot']) {
        const at = placed[name];
        const rest = Option.map(
          Option.fromNullishOr(rested[name]),
          ({ at }) => new Three.Vector3(at.x, at.y, at.z),
        );
        expect(distanceFrom(rest, at?.x ?? NaN, at?.y ?? NaN, at?.z ?? NaN)).toBeLessThan(1e-6);
      }
    }),
  );
});
