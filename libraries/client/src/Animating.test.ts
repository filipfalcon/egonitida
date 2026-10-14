import { describe, expect, it } from '@effect/vitest';
import { Component, State } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import * as Three from 'three/webgpu';
import * as Animating from '#src/Animating.ts';
import * as Scene from '#src/Scene.ts';
import * as View from '#src/View.ts';

/** A leg as a model is delivered: a hip, a knee a metre below it, and a foot a metre below that, standing straight. */
const leg = () => {
  const hip = new Three.Bone();
  hip.name = 'hip';
  const knee = new Three.Bone();
  knee.name = 'knee';
  knee.position.set(0, -1, 0);
  const foot = new Three.Bone();
  foot.name = 'foot';
  foot.position.set(0, -1, 0);
  hip.add(knee);
  knee.add(foot);
  const model = new Three.Group();
  model.add(hip);
  return model;
};

/** A turn about the forward axis by `angle`, as a quaternion's four numbers. */
const turned = (angle: number) =>
  new Three.Quaternion().setFromAxisAngle(new Three.Vector3(0, 0, 1), angle).toArray();

/** A clip named `name`, a second long, turning each of `bones` from straight to a quarter turn about the forward axis. */
const bending = (name: string, bones: ReadonlyArray<string>) =>
  new Three.AnimationClip(
    name,
    1,
    bones.map(
      (bone) =>
        new Three.QuaternionKeyframeTrack(
          `${bone}.quaternion`,
          [0, 1],
          [...turned(0), ...turned(Math.PI / 2)],
        ),
    ),
  );

/** A clip named `name`, a second long, raising the hip from where it stands to a metre up. */
const rising = (name: string) =>
  new Three.AnimationClip(name, 1, [
    new Three.VectorKeyframeTrack('hip.position', [0, 1], [0, 0, 0, 0, 1, 0]),
  ]);

/** How far `model`'s bone `name` is turned about the forward axis. */
const angleOf = (model: Three.Object3D, name: string) => {
  const bone = model.getObjectByName(name);
  return bone === undefined ? Number.NaN : 2 * Math.atan2(bone.quaternion.z, bone.quaternion.w);
};

/** Where `model`'s bone `name` stands, from its parent. */
const heightOf = (model: Three.Object3D, name: string) =>
  model.getObjectByName(name)?.position.y ?? Number.NaN;

const clips = [bending('Bend', ['knee']), bending('Curl', ['knee', 'foot']), rising('Rise')];

describe('Animating.fit', () => {
  it.effect('refuses a model that lacks a clip or a bone it is animated by, naming each', () =>
    Effect.gen(function* () {
      const unfitted = yield* Effect.flip(
        Animating.fit(
          leg(),
          [...clips, bending('Wave', ['hand'])],
          Animating.make({
            bend: Animating.cycle('Bend'),
            kick: Animating.once('Kick'),
            wave: Animating.cycle('Wave'),
            curl: Animating.cycle('Curl', { from: ['toe'] }),
          }),
        ),
      );

      expect(unfitted._tag).toEqual('Unfitted');
      expect(unfitted.absent).toEqual(['Kick', 'hand', 'toe']);
    }),
  );
});

describe('Animated.pose', () => {
  it.effect('poses a cycle as far through it as its share, round from its end to its start', () =>
    Effect.gen(function* () {
      const posed = yield* Animating.fit(
        leg(),
        clips,
        Animating.make({ bend: Animating.cycle('Bend') }),
      );

      posed.pose({ bend: { at: 0.5, weight: 1 } });
      const halfway = angleOf(posed.model, 'knee');
      posed.pose({ bend: { at: 1.25, weight: 1 } });

      expect(halfway).toBeCloseTo(Math.PI / 4);
      expect(angleOf(posed.model, 'knee')).toBeCloseTo(Math.PI / 8);
    }),
  );

  it.effect(
    'poses what happens once as many seconds into it as given, held at its start before it and its end after',
    () =>
      Effect.gen(function* () {
        const posed = yield* Animating.fit(
          leg(),
          clips,
          Animating.make({ bend: Animating.once('Bend') }),
        );

        posed.pose({ bend: { at: 0.25, weight: 1 } });
        const begun = angleOf(posed.model, 'knee');
        posed.pose({ bend: { at: 3, weight: 1 } });
        const ended = angleOf(posed.model, 'knee');
        posed.pose({ bend: { at: -1, weight: 1 } });

        expect(begun).toBeCloseTo(Math.PI / 8);
        expect(ended).toBeCloseTo(Math.PI / 2);
        expect(angleOf(posed.model, 'knee')).toBeCloseTo(0);
      }),
  );

  it.effect('blends clips by their weights', () =>
    Effect.gen(function* () {
      const posed = yield* Animating.fit(
        leg(),
        clips,
        Animating.make({ bend: Animating.once('Bend'), still: Animating.once('Curl') }),
      );

      // The one fully bent, the other straight: half of each is bent halfway.
      posed.pose({ bend: { at: 1, weight: 0.5 }, still: { at: 0, weight: 0.5 } });

      expect(angleOf(posed.model, 'knee')).toBeCloseTo(Math.PI / 4);
    }),
  );

  it.effect('poses the model as the values say, whatever it was posed before', () =>
    Effect.gen(function* () {
      const animating = Animating.make({
        bend: Animating.cycle('Bend'),
        rise: Animating.once('Rise'),
      });
      const once = yield* Animating.fit(leg(), clips, animating);
      const often = yield* Animating.fit(leg(), clips, animating);
      const values = { bend: { at: 0.3, weight: 0.7 }, rise: { at: 0.6, weight: 0.4 } };

      once.pose(values);
      often.pose({ bend: { at: 0.9, weight: 1 }, rise: { at: 1, weight: 1 } });
      often.pose({ bend: { at: 0.1, weight: 0 }, rise: { at: 0, weight: 0.2 } });
      often.pose(values);

      expect(angleOf(often.model, 'knee')).toBeCloseTo(angleOf(once.model, 'knee'));
      expect(heightOf(often.model, 'hip')).toBeCloseTo(heightOf(once.model, 'hip'));
    }),
  );

  it.effect('leaves the model standing as it was made where no clip weighs anything', () =>
    Effect.gen(function* () {
      const posed = yield* Animating.fit(
        leg(),
        clips,
        Animating.make({ bend: Animating.cycle('Bend'), rise: Animating.once('Rise') }),
      );

      posed.pose({ bend: { at: 0.5, weight: 1 }, rise: { at: 1, weight: 1 } });
      posed.pose({ bend: { at: 0.5, weight: 0 }, rise: { at: 1, weight: 0 } });

      expect(angleOf(posed.model, 'knee')).toBeCloseTo(0);
      expect(heightOf(posed.model, 'hip')).toBeCloseTo(0);
      expect(heightOf(posed.model, 'knee')).toBeCloseTo(-1);
    }),
  );

  it.effect('moves only the bones a clip is given, from the first of them down', () =>
    Effect.gen(function* () {
      const posed = yield* Animating.fit(
        leg(),
        clips,
        Animating.make({ ankle: Animating.once('Curl', { from: ['foot'] }) }),
      );

      posed.pose({ ankle: { at: 1, weight: 1 } });

      expect(angleOf(posed.model, 'knee')).toBeCloseTo(0);
      expect(angleOf(posed.model, 'foot')).toBeCloseTo(Math.PI / 2);
    }),
  );

  it.effect('leaves out of a clip the bones given to leave out, and those below them', () =>
    Effect.gen(function* () {
      const posed = yield* Animating.fit(
        leg(),
        clips,
        Animating.make({ knee: Animating.once('Curl', { from: ['hip'], without: ['foot'] }) }),
      );

      posed.pose({ knee: { at: 1, weight: 1 } });

      expect(angleOf(posed.model, 'knee')).toBeCloseTo(Math.PI / 2);
      expect(angleOf(posed.model, 'foot')).toBeCloseTo(0);
    }),
  );

  it.effect(
    'adds an additive clip on top of what the others pose, by how far it moved from its start',
    () =>
      Effect.gen(function* () {
        const posed = yield* Animating.fit(
          leg(),
          clips,
          Animating.make({
            bend: Animating.once('Bend'),
            more: Animating.once('Curl', { additive: true }),
          }),
        );

        posed.pose({ bend: { at: 0.5, weight: 1 }, more: { at: 0.5, weight: 1 } });

        expect(angleOf(posed.model, 'knee')).toBeCloseTo(Math.PI / 2);
        expect(angleOf(posed.model, 'foot')).toBeCloseTo(Math.PI / 4);
      }),
  );

  it.effect('animates each copy of one model on its own, from the clips they share', () =>
    Effect.gen(function* () {
      const animating = Animating.make({ bend: Animating.once('Bend') });
      const one = yield* Animating.fit(leg(), clips, animating);
      const other = yield* Animating.fit(leg(), clips, animating);

      one.pose({ bend: { at: 1, weight: 1 } });
      other.pose({ bend: { at: 0, weight: 1 } });

      expect(angleOf(one.model, 'knee')).toBeCloseTo(Math.PI / 2);
      expect(angleOf(other.model, 'knee')).toBeCloseTo(0);
    }),
  );
});

/** How far through her stride a figure is, as a game's simulation keeps it. */
const Stride = Component.make('Stride', Schema.Struct({ through: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});

const strides = View.each([Stride], {
  acquire: () =>
    Effect.orDie(Animating.fit(leg(), clips, Animating.make({ bend: Animating.cycle('Bend') }))),
  draw: (posed, held) => {
    posed.pose({ bend: { at: held(Stride).through, weight: 1 } });
  },
});

it.effect('draws a figure posed as far through her stride as the state holds', () =>
  Effect.gen(function* () {
    const [state, her] = State.spawn(State.empty({ seed: 1 }), [Stride.of({ through: 0.5 })]);
    const scene = yield* Scene.make([strides]);

    yield* scene.show(state);

    expect(
      Option.map(scene.find(strides, her), (posed) => angleOf(posed.model, 'knee')).pipe(
        Option.getOrElse(() => Number.NaN),
      ),
    ).toBeCloseTo(Math.PI / 4);
  }),
);
