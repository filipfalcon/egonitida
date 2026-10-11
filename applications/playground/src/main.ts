import { World } from '@lightocean/foldkit';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Cubes from '#src/cubes.ts';

/**
 * The playground: the first proof that a world and Foldkit make one application. The cubes are a world, hosted in a worker and drawn on a canvas; the page around them is Foldkit's, and holds no more of the world than it shows, the count of cubes. A click on Spawn cube asks the world for one, as a player's action; the world decides.
 */

// MODEL

/** The world as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const WorldState = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type WorldState = typeof WorldState.Type;

/** The playground's page: the world as far as it has it, how many cubes it holds, and what last went wrong. */
export const Model = Schema.Struct({
  world: WorldState,
  cubeCount: Schema.Int,
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the page: the world joined and left, what it tells, and what the player does. */
export const Message = defineMessageUnion({
  JoinedWorld: {},
  FoundWorldJoined: {},
  LeftWorld: {},
  FailedJoinWorld: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowWorld: { reason: Schema.String },
  CountedCubes: { count: Schema.Int },
  ClickedSpawnCube: {},
  AskedWorldForCube: {},
  FailedAskWorldForCube: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The cubes' world, joined while the playground is open. */
export const CubesWorld = ManagedResource.tag<World.Joined>()('CubesWorld');

/** What the playground's Commands and Subscriptions reach: the cubes' world. */
export type Services = ManagedResource.ServiceOf<typeof CubesWorld>;

// COMMANDS

/** Asks the world for another cube, as the player's action. */
export const AskForCube = Command.define('AskForCube', {
  messages: [Message.AskedWorldForCube, Message.FailedAskWorldForCube],
  execute: CubesWorld.get.pipe(
    Effect.flatMap(({ client }) => client.act(Cubes.AskedForCube, {})),
    Effect.as(Message.AskedWorldForCube()),
    Effect.catch(({ resource }) =>
      Effect.succeed(
        Message.FailedAskWorldForCube({ reason: `The world ${resource} is not joined.` }),
      ),
    ),
  ),
});

// UPDATE

const failed = (model: Model, reason: string) =>
  modifyFields(model, { maybeError: () => Option.some(reason) });

/** The page after `message`, and the Commands it sends: a cube asked of the world. */
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    // Joined again while the Model already says so, as one restored after a reload does, the canvas in the page stays as it is. What went wrong while it was not joined is past.
    JoinedWorld: () => ({
      model: modifyFields(model, {
        world: (was) => (was._tag === 'Joined' ? was : { _tag: 'Joined', canvas: 'Waiting' }),
        maybeError: () => Option.none(),
      }),
    }),
    // Found joined while waiting for it, the world is joined, as when the stage found it not joined a moment before it was; found joined once the page has it, it changes nothing, and what went wrong since stays told.
    FoundWorldJoined: () => ({
      model:
        model.world._tag === 'Joining'
          ? modifyFields(model, {
              world: () => ({ _tag: 'Joined', canvas: 'Waiting' }),
              maybeError: () => Option.none(),
            })
          : model,
    }),
    // The canvas goes with the world, so a world joined again waits for its own canvas.
    LeftWorld: () => ({
      model: modifyFields(model, { world: () => ({ _tag: 'Joining' }) }),
    }),
    FailedJoinWorld: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({
      model:
        model.world._tag === 'Joined'
          ? modifyFields(model, { world: () => ({ _tag: 'Joined', canvas: 'Mounted' }) })
          : model,
    }),
    FailedShowWorld: ({ reason }) => ({ model: failed(model, reason) }),
    CountedCubes: ({ count }) => ({ model: modifyFields(model, { cubeCount: () => count }) }),
    ClickedSpawnCube: () => ({ model, commands: [AskForCube()] }),
    AskedWorldForCube: () => ({ model }),
    FailedAskWorldForCube: ({ reason }) => ({ model: failed(model, reason) }),
  });

// INIT

/** The page as it opens: joining the world, no cubes counted. */
export const initialModel: Model = {
  world: { _tag: 'Joining' },
  cubeCount: 0,
  maybeError: Option.none(),
};

/** The page as it opens. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
