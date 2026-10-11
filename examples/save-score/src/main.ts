import { World as Worlds } from '@lightocean/core';
import { World } from '@lightocean/foldkit';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Score from '#src/score.ts';

/**
 * The example's page: the round is a world, hosted in a worker and drawn on a canvas; the page around it is Foldkit's, and holds no more of the round than it says, its hits and time left, then whether its score was saved and the best kept. A click on Play again chooses a new round, as the player's action; the world decides.
 */

// MODEL

/** The round as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const WorldState = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type WorldState = typeof WorldState.Type;

/** How the round goes, as the page says it: while it plays, its hits and the whole seconds left; once it is over, as the world holds it. */
export const Told = Schema.Union([
  Schema.TaggedStruct('Playing', { hits: Schema.Int, secondsLeft: Schema.Int }),
  Schema.TaggedStruct('Saving', { hits: Schema.Int }),
  Schema.TaggedStruct('Saved', { hits: Schema.Int, best: Schema.Int }),
  Schema.TaggedStruct('Unsaved', { hits: Schema.Int, reason: Schema.String }),
]);
export type Told = typeof Told.Type;

/** How the round in `world` goes, as the page says it, if the world holds one: the seconds left are whole, so the page is told again only once a second while it plays. */
export const told = (world: Worlds.World): Option.Option<Told> =>
  Option.fromNullishOr(Worlds.holding(world, [Score.Round])[0]).pipe(
    Option.flatMap((round) => Worlds.get(world, round, Score.Round)),
    Option.map((state): Told => {
      switch (state._tag) {
        case 'Playing':
          return {
            _tag: 'Playing',
            hits: state.hits,
            secondsLeft: Math.max(0, Math.ceil((state.endsAt - world.tick) / Score.game.stepRate)),
          };
        default:
          return state;
      }
    }),
  );

/** The page: the round as far as it has it, how it goes, and what last went wrong. */
export const Model = Schema.Struct({
  world: WorldState,
  maybeRound: Schema.Option(Told),
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the page: the round joined and left, what it tells, and what the player does. */
export const Message = defineMessageUnion({
  JoinedWorld: {},
  FoundWorldJoined: {},
  LeftWorld: {},
  FailedJoinWorld: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowWorld: { reason: Schema.String },
  ToldRound: { maybeRound: Schema.Option(Told) },
  ClickedPlayAgain: {},
  ChoseNewRound: {},
  FailedChooseNewRound: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The round's world, joined while the page is open. */
export const RoundWorld = ManagedResource.tag<World.Joined>()('RoundWorld');

/** What the page's Commands and Subscriptions reach: the round's world. */
export type Services = ManagedResource.ServiceOf<typeof RoundWorld>;

// COMMANDS

/** Chooses a new round, as the player's action. */
export const PlayAgain = Command.define('PlayAgain', {
  messages: [Message.ChoseNewRound, Message.FailedChooseNewRound],
  execute: RoundWorld.get.pipe(
    Effect.flatMap(({ client }) => client.act(Score.ChoseNewRound, {})),
    Effect.as(Message.ChoseNewRound()),
    Effect.catch(({ resource }) =>
      Effect.succeed(
        Message.FailedChooseNewRound({ reason: `The world ${resource} is not joined.` }),
      ),
    ),
  ),
});

// UPDATE

const failed = (model: Model, reason: string) =>
  modifyFields(model, { maybeError: () => Option.some(reason) });

/** The page after `message`, and the Commands it sends: a new round chosen. */
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
    ToldRound: ({ maybeRound }) => ({
      model: modifyFields(model, { maybeRound: () => maybeRound }),
    }),
    ClickedPlayAgain: () => ({ model, commands: [PlayAgain()] }),
    ChoseNewRound: () => ({ model }),
    FailedChooseNewRound: ({ reason }) => ({ model: failed(model, reason) }),
  });

// INIT

/** The page as it opens: joining the round, nothing told of it. */
export const initialModel: Model = {
  world: { _tag: 'Joining' },
  maybeRound: Option.none(),
  maybeError: Option.none(),
};

/** The page as it opens. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
