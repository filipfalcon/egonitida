import { Tab, Viewport } from '@nitida/client';
import { Bridge, Page } from '@nitida/devtools';
import { Session, Stage } from '@nitida/foldkit';
import { Effect, Option, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import { Message, type Model, OceanSession, type Services } from '#src/main.ts';
import * as Press from '#src/press.ts';
import * as Glance from '#src/glance.ts';
import * as GlanceStage from '#src/glanceStage.ts';
import * as StatePress from '#src/statePress.ts';
import * as Ocean from '#src/ocean.ts';
import * as OceanView from '#src/ocean.view.ts';

// Where the games meet the page: the ocean, joined in a worker while the home page is open and shown on the canvas once Foldkit has it in the page; and the games of the page of key terms, the first game its stage of First Things First draws and the one its press steps, each joined in a worker of its own while that page is open.

/** The id the devtools know the ocean's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the state kept for the tab. */
const host = Tab.id('website');

/** The id the devtools know the press's host by, kept by the tab across reloads. */
const pressHost = Tab.id('press');

/** The id the devtools know the host of the first game by, kept by the tab across reloads. */
const glanceHost = Tab.id('glance');

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

/** The ocean's session, joined while the home page is open, and the first game's and the press's, joined while the page of key terms is. */
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  ocean: entry(
    Session.Requirements,
    Session.managed<Model, Message, Services>({
      resource: OceanSession,
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
  glance: entry(
    Session.Requirements,
    Session.managed<Model, Message, Services>({
      resource: GlanceStage.GlanceSession,
      game: Glance.game,
      worker: () =>
        new Worker(new URL('./glance.worker.ts', import.meta.url), {
          type: 'module',
          name: glanceHost,
        }),
      joins: (model) => model.route._tag === 'KeyTerms',
      onJoined: () => Message.GotGlanceMessage({ message: GlanceStage.Message.JoinedGame() }),
      onLeft: () => Message.GotGlanceMessage({ message: GlanceStage.Message.LeftGame() }),
      onFailed: (reason) =>
        Message.GotGlanceMessage({ message: GlanceStage.Message.FailedJoinGame({ reason }) }),
    }),
  ),
  press: entry(
    Session.Requirements,
    Session.managed<Model, Message, Services>({
      resource: StatePress.PressSession,
      game: Press.game,
      worker: () =>
        new Worker(new URL('./press.worker.ts', import.meta.url), {
          type: 'module',
          name: pressHost,
        }),
      joins: (model) => model.route._tag === 'KeyTerms',
      onJoined: () => Message.GotStatePressMessage({ message: StatePress.Message.JoinedGame() }),
      onLeft: () => Message.GotStatePressMessage({ message: StatePress.Message.LeftGame() }),
      onFailed: (reason) =>
        Message.GotStatePressMessage({ message: StatePress.Message.FailedJoinGame({ reason }) }),
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
              resource: OceanSession,
              canvasId: CANVAS_ID,
              views: OceanView.views,
              viewport: Viewport.sharp,
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
          ? Session.whenJoined({
              resource: OceanSession,
              onJoined: (): Message => Message.FoundOceanJoined(),
            })
          : Stream.empty,
    },
  ),
}));
