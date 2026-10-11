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

export const Model = Schema.Struct({
  isWorldJoined: Schema.Boolean,
  isCanvasMounted: Schema.Boolean,
  cubeCount: Schema.Int,
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

export const Message = defineMessageUnion({
  JoinedWorld: {},
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

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    JoinedWorld: () => ({ model: modifyFields(model, { isWorldJoined: () => true }) }),
    // The canvas goes with the world, so a world joined again waits for its own canvas.
    LeftWorld: () => ({
      model: modifyFields(model, { isWorldJoined: () => false, isCanvasMounted: () => false }),
    }),
    FailedJoinWorld: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({ model: modifyFields(model, { isCanvasMounted: () => true }) }),
    FailedShowWorld: ({ reason }) => ({ model: failed(model, reason) }),
    CountedCubes: ({ count }) => ({ model: modifyFields(model, { cubeCount: () => count }) }),
    ClickedSpawnCube: () => ({ model, commands: [AskForCube()] }),
    AskedWorldForCube: () => ({ model }),
    FailedAskWorldForCube: ({ reason }) => ({ model: failed(model, reason) }),
  });

// INIT

export const initialModel: Model = {
  isWorldJoined: false,
  isCanvasMounted: false,
  cubeCount: 0,
  maybeError: Option.none(),
};

export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
