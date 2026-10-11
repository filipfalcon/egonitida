import { Tab, type Viewport } from '@lightocean/client';
import { Bridge, Page } from '@lightocean/devtools';
import { Projection, Stage, World } from '@lightocean/foldkit';
import { Effect, Option, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import { Message, type Model, RoundWorld, type Services, Told, told } from '#src/main.ts';
import * as Score from '#src/score.ts';
import * as ScoreView from '#src/score.view.ts';

// Where the round meets the page: joined in a worker while the page is open, shown on the canvas once Foldkit has it in the page, and told for the page to say.

/** The id the devtools know the page's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the world kept for the tab. */
const host = Tab.id('save-score');

/** The id of the canvas the round is shown on. */
export const CANVAS_ID = 'viewport';

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

/** The round's world, joined while the page is open. */
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  world: entry(
    World.Requirements,
    World.managed<Model, Message, Services>({
      resource: RoundWorld,
      game: Score.game,
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

/** Says when the canvas is in the page, so the round can be shown on it. */
export const MountCanvas = Mount.define('MountCanvas', {
  messages: [Message.MountedCanvas],
  execute: () => Effect.succeed(Message.MountedCanvas()),
});

/** A camera looking down over the targets, and the light they are seen by. */
const setUp = ({
  scene,
  camera,
}: {
  readonly scene: Three.Scene;
  readonly camera: Three.Camera;
}) => {
  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 6, 4);
  scene.add(new Three.AmbientLight(0xffffff, 0.5), sun);
  camera.position.set(0, 8, 8);
  camera.lookAt(0, 0, 0);
};

/** The canvas showing the round, and how the round goes. */
export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  stage: entry(
    { isShown: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        isShown: model.world._tag === 'Joined' && model.world.canvas === 'Mounted',
      }),
      dependenciesToStream: ({ isShown }) =>
        isShown
          ? Stage.stream({
              resource: RoundWorld,
              canvasId: CANVAS_ID,
              views: ScoreView.views,
              setup: setUp,
              alongside: capturedAs(host),
              onNotJoined: (): Message => Message.LeftWorld(),
              onFailed: (reason) => Message.FailedShowWorld({ reason }),
            })
          : Stream.empty,
    },
  ),
  round: entry(
    { isWorldJoined: Schema.Boolean },
    {
      modelToDependencies: ({ world }) => ({ isWorldJoined: world._tag === 'Joined' }),
      dependenciesToStream: ({ isWorldJoined }) =>
        isWorldJoined
          ? Projection.stream({
              resource: RoundWorld,
              schema: Schema.Option(Told),
              project: told,
              onProjected: (maybeRound) => Message.ToldRound({ maybeRound }),
              onNotJoined: (): Message => Message.LeftWorld(),
            })
          : Stream.empty,
    },
  ),
}));
