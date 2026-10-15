import { Tab, Viewport } from '@egonitida/client';
import { State } from '@egonitida/core';
import { Bridge, Page } from '@egonitida/devtools';
import { Projection, Session, Stage } from '@egonitida/foldkit';
import { Effect, Option, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import * as Cubes from '#src/cubes.ts';
import * as CubesView from '#src/cubes.view.ts';
import * as Look from '#src/look.ts';
import { CubesSession, Message, type Model, type Services } from '#src/main.ts';

// Where the game meets the page: joined in a worker while the playground is open, shown on the canvas once Foldkit has it in the page, and counted for the page to show.

/** The id the devtools know the playground's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the state kept for the tab. */
const host = Tab.id('playground');

/** The id of the canvas the game is shown on. */
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

/** The cubes' session, joined while the playground is open. */
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  session: entry(
    Session.Requirements,
    Session.managed<Model, Message, Services>({
      resource: CubesSession,
      game: Cubes.game,
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

/** Says when the canvas is in the page, so the game can be shown on it. */
export const MountCanvas = Mount.define('MountCanvas', {
  messages: [Message.MountedCanvas],
  execute: () => Effect.succeed(Message.MountedCanvas()),
});

/** The light the cubes are seen by. */
const setUp = ({ scene }: { readonly scene: Three.Scene }) => {
  const sun = new Three.DirectionalLight(0xffffff, 2.5);
  sun.position.set(5, 8, 6);
  scene.add(new Three.AmbientLight(0xffffff, 0.4), sun);
};

/** The canvas showing the game, from where the player looks and as far as they look around, and the count of cubes its state holds. */
export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  // Shown while the canvas is in the page; where the player looks from is read every frame, and never shows the stage anew.
  stage: Stage.entry({
    resource: CubesSession,
    canvasId: CANVAS_ID,
    views: CubesView.views,
    viewport: Viewport.sharp,
    setup: setUp,
    alongside: capturedAs(host),
    shows: (model: Model) => model.session._tag === 'Joined' && model.session.canvas === 'Mounted',
    input: { schema: CubesView.Viewpoint, of: (model: Model) => model.viewpoint },
    // Looking around changes every frame, which the Model never holds: the stage plays it on from the stick each frame it draws, and the views read it with where the player looks from.
    played: {
      bindings: Look.bindings,
      start: () => Look.start,
      next: (_viewpoint, before, controls, seconds) => Look.look(controls, before, seconds),
      drawing: (viewpoint, look) => ({ viewpoint, look }),
      // The page hides the cursor while the player plays with a pad.
      inHand: (kind) => Message.TookUpDevice({ kind }),
    },
    // How it plays, measured twice a second, for the page to show over the canvas.
    measured: { onMeasured: (measured) => Message.MeasuredStage({ measured }) },
    onNotJoined: (): Message => Message.LeftGame(),
    onFailed: (reason) => Message.FailedShowGame({ reason }),
  }),
  cubes: entry(
    { isJoined: Schema.Boolean },
    {
      modelToDependencies: ({ session }) => ({ isJoined: session._tag === 'Joined' }),
      dependenciesToStream: ({ isJoined }) =>
        isJoined
          ? Projection.stream({
              resource: CubesSession,
              schema: Schema.Int,
              project: (state) => State.entitiesHolding(state, [Cubes.Cube]).length,
              onProjected: (count) => Message.CountedCubes({ count }),
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
              resource: CubesSession,
              onJoined: (): Message => Message.FoundGameJoined(),
            })
          : Stream.empty,
    },
  ),
}));
