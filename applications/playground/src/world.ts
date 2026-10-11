import { Tab } from '@lightocean/client';
import { World as Worlds } from '@lightocean/core';
import { Projection, Stage, World } from '@lightocean/foldkit';
import { Effect, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import * as Cubes from '#src/cubes.ts';
import * as CubesView from '#src/cubes.view.ts';
import { CubesWorld, Message, type Model, type Services } from '#src/main.ts';

// Where the world meets the page: joined in a worker while the playground is open, shown on the canvas once Foldkit has it in the page, and counted for the page to show.

/** The id the devtools know the playground's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the world kept for the tab. */
const host = Tab.id('playground');

/** The id of the canvas the world is shown on. */
export const CANVAS_ID = 'viewport';

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  world: entry(
    World.Requirements,
    World.managed<Model, Message, Services>({
      resource: CubesWorld,
      game: Cubes.game,
      worker: () =>
        new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
          name: host,
        }),
      joins: () => true,
      onJoined: () => Message.JoinedWorld(),
      onLeft: () => Message.LeftWorld(),
      onFailed: (reason) => Message.FailedJoinWorld({ reason }),
    }),
  ),
}));

/** Says when the canvas is in the page, so the world can be shown on it. */
export const MountCanvas = Mount.define('MountCanvas', {
  messages: [Message.MountedCanvas],
  execute: () => Effect.succeed(Message.MountedCanvas()),
});

/** A camera looking down over the grid, and the light the cubes are seen by. */
const setUp = ({
  scene,
  camera,
}: {
  readonly scene: Three.Scene;
  readonly camera: Three.Camera;
}) => {
  const sun = new Three.DirectionalLight(0xffffff, 2.5);
  sun.position.set(5, 8, 6);
  scene.add(new Three.AmbientLight(0xffffff, 0.4), sun);
  camera.position.set(0, 3, 10);
  camera.rotation.set(-0.25, 0, 0);
};

export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  stage: entry(
    { isShown: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        isShown: model.isWorldJoined && model.isCanvasMounted,
      }),
      dependenciesToStream: ({ isShown }) =>
        isShown
          ? Stage.stream({
              resource: CubesWorld,
              canvasId: CANVAS_ID,
              views: CubesView.views,
              setup: setUp,
              onFailed: (reason) => Message.FailedShowWorld({ reason }),
            })
          : Stream.empty,
    },
  ),
  cubes: entry(
    { isWorldJoined: Schema.Boolean },
    {
      modelToDependencies: ({ isWorldJoined }) => ({ isWorldJoined }),
      dependenciesToStream: ({ isWorldJoined }) =>
        isWorldJoined
          ? Projection.stream({
              resource: CubesWorld,
              schema: Schema.Int,
              project: (world) => Worlds.holding(world, [Cubes.Cube]).length,
              onProjected: (count) => Message.CountedCubes({ count }),
            })
          : Stream.empty,
    },
  ),
}));
