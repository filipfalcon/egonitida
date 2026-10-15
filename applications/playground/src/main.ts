import { Controls } from '@nitida/client';
import { Session, Stage } from '@nitida/foldkit';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Cubes from '#src/cubes.ts';
import { Viewpoint } from '#src/cubes.view.ts';

/**
 * The playground: the first proof that a game and Foldkit make one application. The cubes are a game, hosted in a worker and drawn on a canvas; the page around them is Foldkit's, and holds no more of the game's state than it shows, the count of cubes. A click on Spawn cube asks the game for one, as a player's action; the game decides.
 */

// MODEL

/** The session as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const PageSession = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type PageSession = typeof PageSession.Type;

/** The playground's page: the session as far as it has it, how many cubes the game holds, where the player looks at them from, how the stage plays as it last measured it, the kind of device the player last took up, if any, and what last went wrong. */
export const Model = Schema.Struct({
  session: PageSession,
  cubeCount: Schema.Int,
  viewpoint: Viewpoint,
  maybeMeasured: Schema.Option(Stage.Measured),
  maybeInHand: Schema.Option(Controls.Kind),
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the page: the game joined and left, what it tells, and what the player does. */
export const Message = defineMessageUnion({
  JoinedGame: {},
  FoundGameJoined: {},
  LeftGame: {},
  FailedJoinGame: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowGame: { reason: Schema.String },
  MeasuredStage: { measured: Stage.Measured },
  TookUpDevice: { kind: Controls.Kind },
  CountedCubes: { count: Schema.Int },
  ClickedSpawnCube: {},
  ChoseViewpoint: { viewpoint: Viewpoint },
  AskedGameForCube: {},
  FailedAskGameForCube: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The cubes' session, joined while the playground is open. */
export const CubesSession = ManagedResource.tag<Session.Joined>()('CubesSession');

/** What the playground's Commands and Subscriptions reach: the cubes' session. */
export type Services = ManagedResource.ServiceOf<typeof CubesSession>;

// COMMANDS

/** Asks the game for another cube, as the player's action. */
export const AskForCube = Command.define('AskForCube', {
  messages: [Message.AskedGameForCube, Message.FailedAskGameForCube],
  execute: CubesSession.get.pipe(
    Effect.flatMap(({ client }) => client.act(Cubes.AskedForCube, {})),
    Effect.as(Message.AskedGameForCube()),
    Effect.catch(({ resource }) =>
      Effect.succeed(
        Message.FailedAskGameForCube({ reason: `The session ${resource} is not joined.` }),
      ),
    ),
  ),
});

// UPDATE

const failed = (model: Model, reason: string) =>
  modifyFields(model, { maybeError: () => Option.some(reason) });

/** The page after `message`, and the Commands it sends: a cube asked of the game. */
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    // Joined again while the Model already says so, as one restored after a reload does, the canvas in the page stays as it is. What went wrong while it was not joined is past.
    JoinedGame: () => ({
      model: modifyFields(model, {
        session: (was) => (was._tag === 'Joined' ? was : { _tag: 'Joined', canvas: 'Waiting' }),
        maybeError: () => Option.none(),
      }),
    }),
    // Found joined while waiting for it, the session is joined, as when the stage found it not joined a moment before it was; found joined once the page has it, it changes nothing, and what went wrong since stays told.
    FoundGameJoined: () => ({
      model:
        model.session._tag === 'Joining'
          ? modifyFields(model, {
              session: () => ({ _tag: 'Joined', canvas: 'Waiting' }),
              maybeError: () => Option.none(),
            })
          : model,
    }),
    // The canvas goes with the session, so a session joined again waits for its own canvas; how the stage played goes with it.
    LeftGame: () => ({
      model: modifyFields(model, {
        session: () => ({ _tag: 'Joining' }),
        maybeMeasured: () => Option.none(),
      }),
    }),
    FailedJoinGame: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({
      model:
        model.session._tag === 'Joined'
          ? modifyFields(model, { session: () => ({ _tag: 'Joined', canvas: 'Mounted' }) })
          : model,
    }),
    FailedShowGame: ({ reason }) => ({ model: failed(model, reason) }),
    // How the stage plays is the page's to show, and asks nothing of the game.
    MeasuredStage: ({ measured }) => ({
      model: modifyFields(model, { maybeMeasured: () => Option.some(measured) }),
    }),
    // The device in the player's hands is the page's to know, such as to hide the cursor while they play with a pad.
    TookUpDevice: ({ kind }) => ({
      model: modifyFields(model, { maybeInHand: () => Option.some(kind) }),
    }),
    CountedCubes: ({ count }) => ({ model: modifyFields(model, { cubeCount: () => count }) }),
    ClickedSpawnCube: () => ({ model, commands: [AskForCube()] }),
    // Where the player looks from is the page's, not the game's: the stage reads it every frame.
    ChoseViewpoint: ({ viewpoint }) => ({
      model: modifyFields(model, { viewpoint: () => viewpoint }),
    }),
    AskedGameForCube: () => ({ model }),
    FailedAskGameForCube: ({ reason }) => ({ model: failed(model, reason) }),
  });

// INIT

/** The page as it opens: joining the game, no cubes counted, looking at the grid from ahead, nothing measured yet, no device taken up. */
export const initialModel: Model = {
  session: { _tag: 'Joining' },
  cubeCount: 0,
  viewpoint: 'Ahead',
  maybeMeasured: Option.none(),
  maybeInHand: Option.none(),
  maybeError: Option.none(),
};

/** The page as it opens. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
