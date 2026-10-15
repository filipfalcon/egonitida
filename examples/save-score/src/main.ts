import { State } from '@egonitida/core';
import { Session } from '@egonitida/foldkit';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Score from '#src/score.ts';

/**
 * The example's page: the round is a game, hosted in a worker and drawn on a canvas; the page around it is Foldkit's, and holds no more of the round than it says, its hits and time left, then whether its score was saved and the best kept. A click on Play again chooses a new round, as the player's action; the game decides.
 */

// MODEL

/** The round's session as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const PageSession = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type PageSession = typeof PageSession.Type;

/** How the round goes, as the page says it: while it plays, its hits and the whole seconds left; once it is over, as its state holds it. */
export const Told = Schema.Union([
  Schema.TaggedStruct('Playing', { hits: Schema.Int, secondsLeft: Schema.Int }),
  Schema.TaggedStruct('Saving', { hits: Schema.Int }),
  Schema.TaggedStruct('Saved', { hits: Schema.Int, best: Schema.Int }),
  Schema.TaggedStruct('Unsaved', { hits: Schema.Int, reason: Schema.String }),
]);
export type Told = typeof Told.Type;

/** How the round in `state` goes, as the page says it, if the state holds one: the seconds left are whole, so the page is told again only once a second while it plays. */
export const told = (state: State.State): Option.Option<Told> =>
  Option.fromNullishOr(State.entitiesHolding(state, [Score.Round])[0]).pipe(
    Option.flatMap((round) => State.get(state, round, Score.Round)),
    Option.map((mode): Told => {
      switch (mode._tag) {
        case 'Playing':
          return {
            _tag: 'Playing',
            hits: mode.hits,
            secondsLeft: Math.max(0, Math.ceil((mode.endsAt - state.tick) / Score.game.stepRate)),
          };
        default:
          return mode;
      }
    }),
  );

/** The page: the round's session as far as it has it, how it goes, and what last went wrong. */
export const Model = Schema.Struct({
  session: PageSession,
  maybeRound: Schema.Option(Told),
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the page: the round joined and left, what it tells, and what the player does. */
export const Message = defineMessageUnion({
  JoinedGame: {},
  FoundGameJoined: {},
  LeftGame: {},
  FailedJoinGame: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowGame: { reason: Schema.String },
  ToldRound: { maybeRound: Schema.Option(Told) },
  ClickedPlayAgain: {},
  ChoseNewRound: {},
  FailedChooseNewRound: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The round's session, joined while the page is open. */
export const RoundSession = ManagedResource.tag<Session.Joined>()('RoundSession');

/** What the page's Commands and Subscriptions reach: the round's session. */
export type Services = ManagedResource.ServiceOf<typeof RoundSession>;

// COMMANDS

/** Chooses a new round, as the player's action. */
export const PlayAgain = Command.define('PlayAgain', {
  messages: [Message.ChoseNewRound, Message.FailedChooseNewRound],
  execute: RoundSession.get.pipe(
    Effect.flatMap(({ client }) => client.act(Score.ChoseNewRound, {})),
    Effect.as(Message.ChoseNewRound()),
    Effect.catch(({ resource }) =>
      Effect.succeed(
        Message.FailedChooseNewRound({ reason: `The session ${resource} is not joined.` }),
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
    // The canvas goes with the session, so a session joined again waits for its own canvas.
    LeftGame: () => ({
      model: modifyFields(model, { session: () => ({ _tag: 'Joining' }) }),
    }),
    FailedJoinGame: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({
      model:
        model.session._tag === 'Joined'
          ? modifyFields(model, { session: () => ({ _tag: 'Joined', canvas: 'Mounted' }) })
          : model,
    }),
    FailedShowGame: ({ reason }) => ({ model: failed(model, reason) }),
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
  session: { _tag: 'Joining' },
  maybeRound: Option.none(),
  maybeError: Option.none(),
};

/** The page as it opens. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
