import { Posing, View } from '@lightocean/client';
import { Ball } from '@lightocean/core';
import { Effect } from 'effect';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import * as Three from 'three/webgpu';
import * as Baller from '#src/baller.ts';
import * as Body from '#src/body.ts';

/**
 * The baller drawn as her model, posed every frame as the step poses her, from where her feet are headed, so she is drawn where the simulation decides what touches the ball; and the ball. Her model is loaded by the page and given to the views, so a test gives one of its own.
 */

/** A baller as drawn: her model, and how it is posed. */
class Drawn extends Three.Group {
  readonly posed: Posing.Posed;

  constructor(posed: Posing.Posed) {
    super();
    this.posed = posed;
    this.add(posed.model);
  }
}

/** A ball's look: white, as a ball under lights is. */
const BALL_COLOUR = 0xf2f2f2;

/** Every ball, a sphere as round as a football, where it is. */
export const balls = View.each([Baller.Ball], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh(
            new Three.SphereGeometry(Ball.football.radius, 32, 16),
            new Three.MeshStandardNodeMaterial({ color: BALL_COLOUR, roughness: 0.5 }),
          ),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    const { x, y, z } = held(Baller.Ball).at;
    mesh.position.set(x, y, z);
  },
});

/**
 * The views, every baller drawn as the model `model` gives, a copy of her own, posed by her joints as her feet are headed; and every ball. A model that cannot be loaded, or lacks a bone her joints turn, is a fault in what the game was built with.
 */
export const make = <E>(model: Effect.Effect<Three.Object3D, E>) => {
  const ballers = View.each([Baller.Aim], {
    acquire: () =>
      Effect.gen(function* () {
        const copy = clone(yield* model);
        return new Drawn(yield* Posing.fit(copy, Body.joints));
      }).pipe(Effect.orDie),
    draw: (drawn, held) => {
      drawn.posed.pose(Baller.poseOf(held(Baller.Aim)));
    },
  });
  return { ballers, views: [ballers, balls] };
};
