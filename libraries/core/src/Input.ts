import type * as Demand from '#src/Demand.ts';
import type * as Event from '#src/Event.ts';

/**
 * An input is everything that enters a step from outside the state: the players' demands and the actions, in the order they arrived.
 *
 * The same state and the same input give the same next state, so a recording of a game is its first state and the input of every step after it.
 */

/** An action as a step takes it, a player's or a command's result: its value, tagged with the action it is. */
export type Action = Event.Tagged;

export interface Input {
  /** What the players are doing with their controls, each written to the entity it is on before anything else runs. */
  readonly demands: ReadonlyArray<Demand.Demand>;
  /** The actions, in the order they arrived, which the rules handle before the systems run. */
  readonly actions: ReadonlyArray<Action>;
}

/** No input: a step that only moves time on. */
export const none: Input = { demands: [], actions: [] };
