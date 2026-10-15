import {
  Action,
  Command,
  Component,
  Domain,
  Event,
  Game,
  Pointing,
  Rule,
  System,
  State,
} from '@nitida/core';
import { Effect, Option, Schema } from 'effect';
import { Scores } from '#src/scores.ts';

/**
 * The fifth example: a round against the clock, whose score is saved when it ends. It adds one idea to those before: a rule that needs something done outside the game, saving the score, issues a command, and what came of it, the best score kept or why none was, comes back as an action, which a rule must handle. Its view is in `score.view.ts`; where scores are kept is `scores.ts`'s.
 */

/** How long a round lasts, in seconds. */
export const ROUND_SECONDS = 20;

/** How many steps the game takes a second. */
const STEP_RATE = 30;

/** How far from the middle a target may stand. */
const SPREAD = 4;

// COMPONENTS

/** A target, standing at `x`, `z`, for a click to hit. */
export const Target = Component.make(
  'Target',
  Schema.Struct({ x: Schema.Finite, z: Schema.Finite }),
  {
    owner: 'rules',
    network: 'server',
  },
);

/** The round: being played until a tick, its hits counted; its score being saved; or over, with the best kept, or why the score was not saved. */
export const Round = Component.make(
  'Round',
  Schema.Union([
    Schema.TaggedStruct('Playing', { endsAt: Schema.Int, hits: Schema.Int }),
    Schema.TaggedStruct('Saving', { hits: Schema.Int }),
    Schema.TaggedStruct('Saved', { hits: Schema.Int, best: Schema.Int }),
    Schema.TaggedStruct('Unsaved', { hits: Schema.Int, reason: Schema.String }),
  ]),
  { owner: 'rules', network: 'server' },
);

// ACTIONS

/** The player chose to play another round. */
export const ChoseNewRound = Action.make('ChoseNewRound', {});

// EVENTS

/** The round's time is up, with so many hits. */
export const RoundEnded = Event.make('RoundEnded', { hits: Schema.Int });

// COMMANDS

/** The score was saved, and `best` is the best kept so far. */
export const ScoreSaved = Command.result('ScoreSaved', { best: Schema.Int });

/** The score was not saved, for `reason`. */
export const ScoreNotSaved = Command.result('ScoreNotSaved', { reason: Schema.String });

/** Saves a score where scores are kept, coming to the best kept so far, or to why it could not be saved. */
export const SaveScore = Command.make('SaveScore', {
  args: { score: Schema.Int },
  results: [ScoreSaved, ScoreNotSaved],
  execute: ({ score }) =>
    Effect.gen(function* () {
      const scores = yield* Scores;
      return yield* scores.save(score).pipe(
        Effect.map((best): Rule.ValueOf<typeof ScoreSaved> => ({ _tag: 'ScoreSaved', best })),
        Effect.catchTag('Unsaved', ({ reason }) =>
          Effect.succeed<Rule.ValueOf<typeof ScoreNotSaved>>({ _tag: 'ScoreNotSaved', reason }),
        ),
      );
    }),
});

// RULES

/** A click on a target while the round plays is a hit, and the target moves somewhere else. */
const hit = Rule.on(Pointing.Clicked, {
  reads: [],
  writes: [Round, Target],
  emits: [],
  run: (context, { entity }) => {
    if (Option.isNone(context.get(entity, Target))) {
      return;
    }
    for (const [round, mode] of context.query(Round)) {
      if (mode._tag === 'Playing') {
        context.set(round, Round, { ...mode, hits: mode.hits + 1 });
        context.set(entity, Target, {
          x: (context.random() * 2 - 1) * SPREAD,
          z: (context.random() * 2 - 1) * SPREAD,
        });
      }
    }
  },
});

/** A round over has its score saved. */
const endRound = Rule.on(RoundEnded, {
  reads: [],
  writes: [Round],
  emits: [],
  commands: [SaveScore],
  run: (context, { hits }) => {
    for (const [round] of context.query(Round)) {
      context.set(round, Round, { _tag: 'Saving', hits });
    }
    context.command(SaveScore.of({ score: hits }));
  },
});

/** A score saved ends the round with the best kept so far. */
const saved = Rule.on(ScoreSaved, {
  reads: [],
  writes: [Round],
  emits: [],
  run: (context, { best }) => {
    for (const [round, mode] of context.query(Round)) {
      if (mode._tag === 'Saving') {
        context.set(round, Round, { _tag: 'Saved', hits: mode.hits, best });
      }
    }
  },
});

/** A score not saved ends the round with why. */
const notSaved = Rule.on(ScoreNotSaved, {
  reads: [],
  writes: [Round],
  emits: [],
  run: (context, { reason }) => {
    for (const [round, mode] of context.query(Round)) {
      if (mode._tag === 'Saving') {
        context.set(round, Round, { _tag: 'Unsaved', hits: mode.hits, reason });
      }
    }
  },
});

/** A round with no hits yet, playing for its time from `tick`, at steps `secondsPerStep` apart. */
const playingFrom = (tick: number, secondsPerStep: number): typeof Round.schema.Type => ({
  _tag: 'Playing',
  endsAt: tick + Math.round(ROUND_SECONDS / secondsPerStep),
  hits: 0,
});

/** A new round, once the last is over, plays for its time from now. */
const newRound = Rule.on(ChoseNewRound, {
  reads: [],
  writes: [Round],
  emits: [],
  run: (context) => {
    for (const [round, mode] of context.query(Round)) {
      if (mode._tag === 'Saved' || mode._tag === 'Unsaved') {
        context.set(round, Round, playingFrom(context.time.tick, context.time.secondsPerStep));
      }
    }
  },
});

// SYSTEMS

/** A round plays until its time is up. */
const clock = System.make({
  name: 'clock',
  reads: [Round],
  writes: [],
  emits: [RoundEnded],
  run: (context) => {
    for (const [, mode] of context.query(Round)) {
      if (mode._tag === 'Playing' && context.time.tick >= mode.endsAt) {
        context.emit({ _tag: 'RoundEnded', hits: mode.hits });
      }
    }
  },
});

// DOMAIN

/** The round: its targets, its clock, and its score saved. */
export const domain = Domain.make({
  name: 'Score',
  requires: [Pointing.domain],
  components: [Target, Round],
  actions: [ChoseNewRound],
  events: [RoundEnded],
  commands: [SaveScore],
  systems: [clock],
  rules: [hit, endRound, saved, notSaved, newRound],
});

/** The example's game: pointing at things, and the round. */
export const game = Game.make({ stepRate: STEP_RATE, domains: [Pointing.domain, domain] });

const [withRound, round] = State.spawn(State.empty({ seed: 1 }), [
  Round.of(playingFrom(0, 1 / STEP_RATE)),
]);
const [withFirst, firstTarget] = State.spawn(withRound, [
  Target.of({ x: -2, z: 0 }),
  Pointing.Label.of({ text: 'Target' }),
]);
const [withSecond] = State.spawn(withFirst, [
  Target.of({ x: 2, z: -1 }),
  Pointing.Label.of({ text: 'Target' }),
]);
/** Whoever plays: an entity that holds nothing, whom a click is from. */
const [withPlayer, player] = State.spawn(withSecond, []);

/** A round about to start, two targets, and a player. */
export const state = withPlayer;
/** The round's entity, the first target's, and the player's, for stories and scenes to name. */
export { round, firstTarget, player };
