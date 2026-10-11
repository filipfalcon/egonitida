import { Effect, Option, Schema } from 'effect';
import type * as Event from '#src/Event.ts';

/**
 * Something a rule decided should be done outside the world, such as saving her progress: a declared value with a name, its arguments, and the events its result may be, failure among them. A rule issues one as a value; it never runs inside a step. The host runs it with the services of its Layers, and its result comes back into the world as one of its events at a later step, which a recording keeps, so a replay or a prediction never runs one again.
 *
 * Its `execute` turns every failure it can foresee into one of its result events. A defect it did not foresee is a bug: the host reports it, and the command has no result.
 */

/** Fields that encode and decode on their own, needing no services: what can be recorded. */
type Fields = Record<string, Schema.Codec<unknown, unknown>>;

export interface Command<
  Name extends string = string,
  Args = unknown,
  Results extends Event.Any = Event.Any,
  Services = unknown,
> {
  readonly _tag: 'Command';
  readonly name: Name;
  /** The events its result may be. */
  readonly results: ReadonlyArray<Results>;
  /** This command with `args`, ready to be issued. */
  of(args: Args): Issued<Name, Services>;
  /** The arguments `issued` was issued with, if it is this command. */
  read(issued: Issued): Option.Option<Args>;
}

export type Any = Command;

/** A command a rule issued: which it is, its arguments as they are recorded, and how to run it. Its arguments stay inside `execute`, made where their type is known. */
export interface Issued<Name extends string = string, Services = unknown> {
  readonly name: Name;
  /** Its arguments, encoded by their schema. */
  readonly encoded: unknown;
  /** Runs it: its result, as one of its events. */
  readonly execute: Effect.Effect<Event.Tagged, never, Services>;
}

/** What `C` gives when issued. */
export type IssuedOf<C extends Any> = ReturnType<C['of']>;

/** The services `C` needs to run. */
export type ServicesOf<C extends Any> =
  IssuedOf<C> extends Issued<string, infer Services> ? Services : never;

export const make = <
  const Name extends string,
  const F extends Fields,
  const Results extends ReadonlyArray<Event.Any>,
  Services = never,
>(
  name: Name,
  spec: {
    readonly args: F;
    readonly results: Results;
    readonly execute: (
      args: Schema.Struct<F>['Type'],
    ) => Effect.Effect<Event.ValueOf<Results[number]>, never, Services>;
  },
) => {
  const args = Schema.Struct(spec.args);
  const command: Command<Name, typeof args.Type, Results[number], Services> = {
    _tag: 'Command',
    name,
    results: spec.results,
    of: (value) => ({
      name,
      encoded: Schema.encodeSync(args)(value),
      execute: Effect.suspend(() => spec.execute(value)),
    }),
    read: (issued) =>
      issued.name === name ? Schema.decodeUnknownOption(args)(issued.encoded) : Option.none(),
  };
  return command;
};
