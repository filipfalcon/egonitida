import { Schema } from 'effect';

/**
 * Something that happened in a step, such as a bite or a death. Systems and rules emit events; rules handle them. An event is a tagged Schema struct, so it can be recorded, replayed, and sent.
 */

export interface Event<Tag extends string, Value> {
  readonly _tag: 'Event';
  readonly tag: Tag;
  readonly schema: Schema.Top;
  /** Carries the value's type; never set. */
  readonly '~value'?: Value;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type Any = Event<string, any>;

export type ValueOf<E> = E extends Event<string, infer Value> ? Value : never;

/** What every event value has in common: the tag of the event it belongs to. */
export interface Tagged {
  readonly _tag: string;
}

export const make = <const Tag extends string, const Fields extends Schema.Struct.Fields>(
  tag: Tag,
  fields: Fields,
) => {
  const schema = Schema.TaggedStruct(tag, fields);
  return { _tag: 'Event', tag, schema } as Event<Tag, typeof schema.Type>;
};
