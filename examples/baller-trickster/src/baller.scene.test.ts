import { describe, expect, it } from '@effect/vitest';
import { Scene } from '@egonitida/client';
import { Game, Pose, State, Story } from '@egonitida/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Baller from '#src/baller.ts';
import * as BallerView from '#src/baller.view.ts';
import * as Camera from '#src/camera.ts';
import * as Body from '#src/body.ts';

/** A stand-in for her model: a bone for each of her bones, standing and turned as she was made, with no skin. */
const standIn = () => {
  const model = new Three.Group();
  const made = new Map<string, Three.Bone>();
  const worlds = new Map<string, Three.Matrix4>();
  const place = (name: string): Three.Bone => {
    const known = made.get(name);
    const bone = Body.bones[name];
    if (known !== undefined || bone === undefined) {
      return known ?? new Three.Bone();
    }
    const created = new Three.Bone();
    created.name = name;
    const world = new Three.Matrix4().compose(
      new Three.Vector3(bone.at.x, bone.at.y, bone.at.z),
      new Three.Quaternion(bone.turn.x, bone.turn.y, bone.turn.z, bone.turn.w),
      new Three.Vector3(1, 1, 1),
    );
    worlds.set(name, world);
    const parent = Option.getOrUndefined(bone.parent);
    const above = parent === undefined ? model : place(parent);
    const local =
      parent === undefined
        ? world.clone()
        : (worlds.get(parent) ?? new Three.Matrix4()).clone().invert().multiply(world);
    local.decompose(created.position, created.quaternion, created.scale);
    above.add(created);
    made.set(name, created);
    return created;
  };
  for (const name of Object.keys(Body.bones)) {
    place(name);
  }
  return model;
};

const views = BallerView.make(Effect.sync(standIn));

/** Where the bone `name` of `drawn` stands, in the scene. */
const drawnAt = (drawn: Three.Object3D, name: string) => {
  drawn.updateMatrixWorld(true);
  return Option.map(Option.fromNullishOr(drawn.getObjectByName(name)), (bone) =>
    bone.getWorldPosition(new Three.Vector3()),
  );
};

describe('the baller drawn', () => {
  it.effect('draws her foot where her pose places it, her stick sending it ahead and up', () =>
    Effect.gen(function* () {
      const [joined, baller] = Baller.join(Baller.state);
      const kicked = Story.story(
        Baller.game,
        Story.given(joined, { baller }),
        Story.demand('baller', Baller.Feet, {
          left: { x: 0, y: 1, lift: 0.5 },
          right: Baller.idle.right,
        }),
        Story.seconds(0.5),
      );
      const scene = yield* Scene.make(views.views, Option.some(baller), () => Camera.start);

      // Her ponytail as her client steps it, after the step.
      yield* scene.show(Game.stepLocal(Baller.game, kicked.state, { tick: kicked.state.tick }));

      const aim = Option.getOrThrow(State.get(kicked.state, baller, Baller.Aim));
      // Her feet are not what she looks with, so the look moves them not.
      const placed = Pose.place(Body.bones, Body.joints, Baller.poseOf(aim))['foot_l'];
      const foot = Option.flatMap(scene.find(views.ballers, baller), (drawn) =>
        drawnAt(drawn, 'foot_l'),
      );
      expect(
        Option.map(foot, (at) =>
          placed === undefined
            ? Infinity
            : at.distanceTo(new Three.Vector3(placed.at.x, placed.at.y, placed.at.z)),
        ),
      ).toEqual(Option.some(expect.closeTo(0, 5)));
    }),
  );

  it.effect('draws the ball where it is', () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(views.views, Option.none(), () => Camera.start);

      yield* scene.show(Baller.state);

      const ball = scene.find(BallerView.balls, Baller.ball);
      expect(Option.map(ball, ({ position }) => position.z)).toEqual(
        Option.some(expect.closeTo(Baller.BALL_START.z, 9)),
      );
    }),
  );

  it.effect(
    'looks at her from behind as it starts, and from her left as the player turns it there',
    () =>
      Effect.gen(function* () {
        const [joined, baller] = Baller.join(Baller.state);
        const orbit = { current: Camera.start };
        const scene = yield* Scene.make(views.views, Option.some(baller), () => orbit.current);

        yield* scene.show(joined);
        const behind = scene.camera.position.clone();
        orbit.current = { ...Camera.start, around: Math.PI / 2 };
        yield* scene.show(joined);
        const left = scene.camera.position.clone();

        expect(behind.z).toBeLessThan(BallerView.LOOKS_AT.z - 1);
        expect(left.x).toBeGreaterThan(BallerView.LOOKS_AT.x + 1);
        // Looking at where her feet work the ball, whichever side it stands.
        const ahead = new Three.Vector3();
        scene.camera.getWorldDirection(ahead);
        expect(ahead.x).toBeLessThan(0);
      }),
  );
});
