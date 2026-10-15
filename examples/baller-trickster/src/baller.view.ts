import { Hairing, Posing, Ragdolling, View } from '@egonitida/client';
import { Ball, Chain, Strands } from '@egonitida/core';
import { Effect } from 'effect';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import * as Three from 'three/webgpu';
import * as Baller from '#src/baller.ts';
import * as Body from '#src/body.ts';
import * as Camera from '#src/camera.ts';

/**
 * The baller drawn as her model, posed every frame as her client last posed her, after the step, from where her feet are headed, so she is drawn where the simulation decides what touches the ball; her eyes, and her head after them, on the ball, which only the drawing needs; her ponytail swinging as her client steps it, and her hair drawn as strands after the guides it swings; the ball; and the camera, about her where the player turns it. Her model is loaded by the page and given to the views, so a test gives one of its own.
 */

/** How her ponytail's bones are aimed at the points it swings as: each at the next. */
const hair = Ragdolling.make({
  ponytail_01: { toward: 'ponytail_02' },
  ponytail_02: { toward: 'ponytail_03' },
  ponytail_03: { toward: 'ponytail_04' },
  ponytail_04: { toward: 'ponytail_05' },
});

/** Her hair as cards, as her model has it, which her strands are drawn instead of: over her scalp, and down her ponytail. */
const CARDS = ['HairCards', 'ponytail'];

/** A baller as drawn: her model, how it is posed, how her ponytail is, and her hair as strands. */
class Drawn extends Three.Group {
  readonly posed: Posing.Posed;
  readonly hair: Ragdolling.Ragdolled;
  readonly strands: Hairing.Haired;

  constructor(posed: Posing.Posed, hairs: Ragdolling.Ragdolled, strands: Hairing.Haired) {
    super();
    this.posed = posed;
    this.hair = hairs;
    this.strands = strands;
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

/** Where the camera looks: about her middle, a little ahead, where her feet work the ball; and how far it stands from there. */
export const LOOKS_AT = { x: 0, y: 0.75, z: 0.3 };
export const DISTANCE = 2.6;

/** The camera, about the player's baller where the player turned it, following her as she walks: behind her as it starts, around to her left as it turns that way, and up as it rises, always looking at where her feet work the ball, through a lens as wide as a camera's to begin with; or, as a photograph is taken, floating where the player floats it, looking as they turn it, through the lens they zoom. */
export const camera = View.rig(
  [Baller.Spot],
  (looking, held, _frame, _drawn, viewpoint: Camera.Viewpoint) => {
    const lens = viewpoint._tag === 'Floating' ? viewpoint.floating.lens : Camera.LENS;
    if (looking instanceof Three.PerspectiveCamera && looking.fov !== lens) {
      looking.fov = lens;
      looking.updateProjectionMatrix();
    }
    if (viewpoint._tag === 'Floating') {
      const { at } = viewpoint.floating;
      const way = Camera.lookingOf(viewpoint.floating);
      looking.position.set(at.x, at.y, at.z);
      looking.lookAt(at.x + way.x, at.y + way.y, at.z + way.z);
      return;
    }
    const { orbit } = viewpoint;
    const spot = held(Baller.Spot);
    const at = { x: LOOKS_AT.x + spot.x, y: LOOKS_AT.y, z: LOOKS_AT.z + spot.z };
    const level = Math.cos(orbit.up) * DISTANCE;
    looking.position.set(
      at.x + Math.sin(orbit.around) * level,
      at.y + Math.sin(orbit.up) * DISTANCE,
      at.z - Math.cos(orbit.around) * level,
    );
    looking.lookAt(at.x, at.y, at.z);
  },
);

/**
 * The views: every baller drawn as the model `model` gives, a copy of her own, posed by her joints as her client last posed her, her ponytail swinging, her hair drawn as strands, every one of them unless `strands` says every how many to draw; every ball; and the camera. A model that cannot be loaded, or lacks a bone her joints turn, is a fault in what the game was built with.
 */
export const make = <E>(model: Effect.Effect<Three.Object3D, E>, strands = 1) => {
  const ballers = View.each([Baller.Posture, Baller.Hair], {
    acquire: () =>
      Effect.gen(function* () {
        const copy = clone(yield* model);
        return new Drawn(
          yield* Posing.fit(copy, Body.joints),
          yield* Ragdolling.fit(copy, hair),
          yield* Hairing.fit(copy, Body.hair, { cards: CARDS, every: strands }),
        );
      }).pipe(Effect.orDie),
    draw: (drawn, held) => {
      // Her body as her client posed it, her eyes on the ball, as her hair swings from it.
      const looked = held(Baller.Posture);
      drawn.posed.pose(looked);
      const swung = held(Baller.Hair);
      drawn.hair.pose(Chain.points(Baller.ponytail, swung.body), 1);
      drawn.strands.draw(
        swung.guides.now,
        Strands.turnsOf(Body.hair.guides, Body.bones, Baller.hairPlacing(looked, swung.body)),
      );
    },
  });
  return { ballers, views: [ballers, balls, camera] };
};
