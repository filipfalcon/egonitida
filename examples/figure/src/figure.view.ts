import { Shaping, View } from '@lightocean/client';
import { Shape } from '@lightocean/core';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Figure from '#src/figure.ts';
import * as Model from '#src/model.ts';

/** How much longer her shins and thighs grow at a whole of her legs' dial, of how long they were made. */
export const LEGS_BY = 0.15;

/** What each of the figure's dials turns in her model: her chest's morph target, her hips' two, and the bones of her legs. */
export const shape = Shape.make({
  chest: Shape.morph('chest-fuller'),
  hips: Shape.morph({ less: 'hips-narrower', more: 'hips-wider' }),
  legs: Shape.lengthen(['knee', 'hips'], { by: LEGS_BY }),
});

/** Lets go of everything `object` holds that the renderer keeps. */
const dispose = (object: Three.Object3D) =>
  object.traverse((child) => {
    if (child instanceof Three.Mesh) {
      child.geometry.dispose();
      child.material.dispose();
    }
  });

/** Every figure, as her model shaped by her dials. */
export const figures = View.each([Figure.Shape], {
  acquire: () =>
    Effect.acquireRelease(Effect.orDie(Shaping.fit(Model.figure(), shape)), (shaped) =>
      Effect.sync(() => dispose(shaped)),
    ),
  draw: (shaped, held) => {
    shaped.shape(held(Figure.Shape));
  },
});

export const views = [figures];
