import { Tab, type Viewport } from '@lightocean/client';
import { Bridge, Page } from '@lightocean/devtools';
import { Stage, World } from '@lightocean/foldkit';
import { Effect, Option, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import { Message, type Model, OceanWorld, type Services } from '#src/main.ts';
import * as Ocean from '#src/ocean.ts';
import * as OceanView from '#src/ocean.view.ts';

// Where the ocean meets the page: joined in a worker while the page is open, and shown on the canvas once Foldkit has it in the page.

/** The id the devtools know the ocean's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the world kept for the tab. */
const host = Tab.id('website');

/** The id of the canvas the ocean is shown on. */
export const CANVAS_ID = 'ocean';

/** In development, the canvas `viewport` draws on, captured for an agent asking through the development server as the page drawing `host`, so it sees what a person would. */
const capturedAs = (host: string) => (viewport: Viewport.Viewport) =>
  import.meta.env.DEV
    ? Option.match(Bridge.vite, {
        onNone: () => Effect.void,
        onSome: (channel) =>
          Page.serve(channel, {
            host,
            capture: (width) =>
              viewport.capture(width).pipe(Effect.mapError(({ reason }) => reason)),
          }),
      })
    : Effect.void;

/** The ocean's world, joined while the home page is open. */
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  ocean: entry(
    World.Requirements,
    World.managed<Model, Message, Services>({
      resource: OceanWorld,
      game: Ocean.game,
      worker: () =>
        new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
          name: host,
        }),
      // The ocean is on the home page alone, so it is joined only there, and a page of the documentation draws nothing in the background.
      joins: (model) => model.route._tag === 'Home',
      onJoined: () => Message.JoinedOcean(),
      onLeft: () => Message.LeftOcean(),
      onFailed: (reason) => Message.FailedJoinOcean({ reason }),
    }),
  ),
}));

/** Says when the canvas is in the page, so the ocean can be shown on it. */
export const MountCanvas = Mount.define('MountCanvas', {
  messages: [Message.MountedCanvas],
  execute: () => Effect.succeed(Message.MountedCanvas()),
});

/** A camera looking down across the ocean from one corner, and a dim light from above, so the lights' own glow is what shows. */
const setUp = ({
  scene,
  camera,
}: {
  readonly scene: Three.Scene;
  readonly camera: Three.Camera;
}) => {
  const moon = new Three.DirectionalLight(0xbcd7ff, 0.5);
  moon.position.set(-4, 10, 2);
  scene.add(new Three.AmbientLight(0x6a8cff, 0.1), moon);
  camera.position.set(5, 7, 13);
  // Aimed left of the middle, so the ocean lies to the right of the words over it.
  camera.lookAt(-4, -0.5, 0);
};

/** The canvas showing the ocean, while it is joined and the canvas is in the page. */
export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  stage: entry(
    { isShown: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        isShown: model.ocean._tag === 'Joined' && model.ocean.canvas === 'Mounted',
      }),
      dependenciesToStream: ({ isShown }) =>
        isShown
          ? Stage.stream({
              resource: OceanWorld,
              canvasId: CANVAS_ID,
              views: OceanView.views,
              setup: setUp,
              alongside: capturedAs(host),
              onNotJoined: (): Message => Message.LeftOcean(),
              onFailed: (reason) => Message.FailedShowOcean({ reason }),
            })
          : Stream.empty,
    },
  ),
  // While the Model says the ocean is not joined, it may already be: joined a moment before the stage found it was not.
  joining: entry(
    { isJoining: Schema.Boolean },
    {
      modelToDependencies: ({ ocean }) => ({ isJoining: ocean._tag === 'Joining' }),
      dependenciesToStream: ({ isJoining }) =>
        isJoining
          ? World.whenJoined({
              resource: OceanWorld,
              onJoined: (): Message => Message.FoundOceanJoined(),
            })
          : Stream.empty,
    },
  ),
}));
