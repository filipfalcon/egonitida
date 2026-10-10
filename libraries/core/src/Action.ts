import { Option, Schema } from 'effect';
import type * as Event from '#src/Event.ts';
import type { Entity } from '#src/World.ts';

/**
 * Something a player did once, such as choosing to restart a level, pulling the trigger, or picking something up, as opposed to what they hold, which is input. It is named as a fact in the past tense, for what the player did, not what the world should make of it (`PulledTrigger`, not `Fire`): the rules decide that, and may emit what came of it as an event (`Shot`). An action is never lost: it travels reliably, and the host hands it to the world at the start of the next step, in the order it came, as an event the rules handle. The rules may refuse it, since the server is the authority.
 *
 * A client sends an action without saying who it is from; the host adds the `player` that sent it, so no client can act for another.
 */

export interface Action<Tag extends string, Sent, Received> extends Event.Event<Tag, Received> {
  /** What a client sends, encoded for the way, tagged with the action it is. */
  encode(value: Sent): unknown;
  /** What arrived from `player`, as the event the rules receive; `None` if it is not this action. */
  accept(encoded: unknown, player: Entity): Option.Option<Received>;
}

export type Any = Action<string, unknown, Event.Tagged>;

/** Fields that encode and decode on their own, needing no services: what can travel. */
type Fields = Record<string, Schema.Codec<unknown, unknown>>;

export const make = <const Tag extends string, const F extends Fields>(tag: Tag, fields: F) => {
  const sent = Schema.Struct(fields);
  const received = Schema.TaggedStruct(tag, { ...fields, player: Schema.Int });
  const action: Action<Tag, typeof sent.Type, typeof received.Type> = {
    _tag: 'Event',
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
