import { Schema } from 'effect';
import type * as Rule from '#src/Rule.ts';

/**
 * An event is something that arose within a step, emitted by a system or a rule. An event that something emits may go unhandled; an event that nothing emits and nothing handles is unused.
 *
 * It is named as a fact in the past tense, such as a bite or a death (`Bitten`, `Died`), and is a tagged Schema struct, so it can be recorded, replayed, and sent.
 */

export interface Event<Tag extends string, Value> extends Rule.Cause<Tag, Value> {
  readonly _tag: 'Event';
}

/** What every action and event value has in common: the tag of what it is. */
export interface Tagged {
  readonly _tag: string;
}

export type Any = Event<string, Tagged>;

/** Fields that encode and decode on their own, needing no services: what can be recorded. */
type Fields = Record<string, Schema.Codec<unknown, unknown>>;

export const make = <const Tag extends string, const F extends Fields>(tag: Tag, fields: F) => {
  const schema = Schema.TaggedStruct(tag, fields);
  const event: Event<Tag, typeof schema.Type> = {
    _tag: 'Event',
    tag,
    schema,
    is: Schema.is(schema),
  };
  return event;
};
