import { Option, Schema } from 'effect';
import type * as Input from '#src/Input.ts';
import type * as Rule from '#src/Rule.ts';
import type { Entity } from '#src/State.ts';

/**
 * An action is something that happened once outside the state: what a player did, or the result of a command. A player's action is sent reliably, and the host adds the player who sent it, so a client cannot act for another player; what a player is doing with their controls meanwhile is a demand. A command's result comes back from outside the game, carries no player, and cannot be sent by a client. Rules handle actions in the order they arrived, and every action must be handled by a rule.
 *
 * This module declares a player's action; a command's result is declared with its command (`Command.result`). Which of the two an action is, its declaration says, so the host takes from a client only a player's actions. A player's action is named as a fact in the past tense, for what the player did, not what the game should make of it (`PulledTrigger`, not `Fire`): the rules decide that, and may emit what came of it as an event (`Shot`). The rules may refuse it, since the server is the authority.
 */

export interface Action<Tag extends string, Sent, Received> extends Rule.Cause<Tag, Received> {
  readonly _tag: 'Action';
  /** What a client sends, encoded for the way, tagged with the action it is. */
  encode(value: Sent): unknown;
  /** What arrived from `player`, as the action the rules receive; `None` if it is not this action. */
  accept(encoded: unknown, player: Entity): Option.Option<Received>;
}

export type Any = Action<string, unknown, Input.Action>;

/** Fields that encode and decode on their own, needing no services: what can travel. */
type Fields = Record<string, Schema.Codec<unknown, unknown>>;

export const make = <const Tag extends string, const F extends Fields>(tag: Tag, fields: F) => {
  const sent = Schema.Struct(fields);
  const received = Schema.TaggedStruct(tag, { ...fields, player: Schema.Int });
  const action: Action<Tag, typeof sent.Type, typeof received.Type> = {
    _tag: 'Action',
    tag,
    schema: received,
    is: Schema.is(received),
    encode: (value) => ({ ...Schema.encodeSync(sent)(value), _tag: tag }),
    // The tag decides whether it is this action; the player is whoever sent it, whatever the client claimed.
    accept: (encoded, player) =>
      typeof encoded === 'object' && encoded !== null
        ? Schema.decodeUnknownOption(received)({ ...encoded, player })
        : Option.none(),
  };
  return action;
};
