import { Schema } from 'effect';

/**
 * Something that happened in a step, such as a bite or a death, named as a fact in the past tense (`Bitten`, `Died`). Systems and rules emit events; rules handle them. An event is a tagged Schema struct, so it can be recorded, replayed, and sent.
 */

export interface Event<Tag extends string, Value> {
  readonly _tag: 'Event';
  readonly tag: Tag;
  /** Encodes and decodes it with no services, so it can be recorded, replayed, and sent. */
  readonly schema: Schema.Codec<Value, unknown>;
  /** Carries the value's type; never set. */
  readonly '~value'?: Value;
  /** Whether `event` is one of this kind, checked by its schema. */
  is(event: Tagged): event is Tagged & Value;
}

/** What every event value has in common: the tag of the event it belongs to. */
export interface Tagged {
  readonly _tag: string;
}

export type Any = Event<string, Tagged>;

export type ValueOf<E> = E extends Event<string, infer Value> ? Value : never;

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
