import { Tab, Viewport } from '@egonitida/client';
import { Bridge, Page } from '@egonitida/devtools';
import { Projection, Session, Stage } from '@egonitida/foldkit';
import { Effect, Option, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import { Message, type Model, RoundSession, type Services, Told, told } from '#src/main.ts';
import * as Score from '#src/score.ts';
import * as ScoreView from '#src/score.view.ts';

// Where the round meets the page: joined in a worker while the page is open, shown on the canvas once Foldkit has it in the page, and told for the page to say.

/** The id the devtools know the page's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the state kept for the tab. */
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

/** The round's session, joined while the page is open. */
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  session: entry(
    Session.Requirements,
    Session.managed<Model, Message, Services>({
      resource: RoundSession,
      game: Score.game,
      worker: () =>
        new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
          name: host,
        }),
      joins: () => true,
      onJoined: () => Message.JoinedGame(),
      onLeft: () => Message.LeftGame(),
      onFailed: (reason) => Message.FailedJoinGame({ reason }),
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
        isShown: model.session._tag === 'Joined' && model.session.canvas === 'Mounted',
      }),
      dependenciesToStream: ({ isShown }) =>
        isShown
          ? Stage.stream({
              resource: RoundSession,
              canvasId: CANVAS_ID,
              views: ScoreView.views,
              viewport: Viewport.sharp,
              setup: setUp,
              alongside: capturedAs(host),
              onNotJoined: (): Message => Message.LeftGame(),
              onFailed: (reason) => Message.FailedShowGame({ reason }),
            })
          : Stream.empty,
    },
  ),
  round: entry(
    { isJoined: Schema.Boolean },
    {
      modelToDependencies: ({ session }) => ({ isJoined: session._tag === 'Joined' }),
      dependenciesToStream: ({ isJoined }) =>
        isJoined
          ? Projection.stream({
              resource: RoundSession,
              schema: Schema.Option(Told),
              project: told,
              onProjected: (maybeRound) => Message.ToldRound({ maybeRound }),
              onNotJoined: (): Message => Message.LeftGame(),
            })
          : Stream.empty,
    },
  ),
  // While the Model says the session is not joined, it may already be: joined a moment before the stage found it was not.
  joining: entry(
    { isJoining: Schema.Boolean },
    {
      modelToDependencies: ({ session }) => ({ isJoining: session._tag === 'Joining' }),
      dependenciesToStream: ({ isJoining }) =>
        isJoining
          ? Session.whenJoined({
              resource: RoundSession,
              onJoined: (): Message => Message.FoundGameJoined(),
            })
          : Stream.empty,
    },
  ),
}));
