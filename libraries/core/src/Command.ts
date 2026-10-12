import { Effect, Option, Schema } from 'effect';
import type * as Input from '#src/Input.ts';
import type * as Rule from '#src/Rule.ts';

/**
 * Something a rule decided should be done outside the game, such as saving her progress: a declared value with a name, its arguments, and the results it may come to, failure among them. A rule issues one as a value; it never runs inside a step. The host runs it with the services of its Layers, and its result comes back into the game as one of its actions at a later step, which a recording keeps, so a replay or a prediction never runs one again.
 *
 * Its `execute` turns every failure it can foresee into one of its results. A defect it did not foresee is a bug: the host reports it, and the command has no result.
 */

/** Fields that encode and decode on their own, needing no services: what can be recorded. */
type Fields = Record<string, Schema.Codec<unknown, unknown>>;

/** What a command may come to, such as a score saved or why it was not: an action, since it comes from outside the state, which carries no player and which no client can send. Every result must be handled by a rule. */
export interface Result<Tag extends string, Value> extends Rule.Cause<Tag, Value> {
  readonly _tag: 'Result';
}

export type AnyResult = Result<string, Input.Action>;

/** A result a command may come to, named as a fact in the past tense (`ScoreSaved`, `ScoreNotSaved`). */
export const result = <const Tag extends string, const F extends Fields>(tag: Tag, fields: F) => {
  const schema = Schema.TaggedStruct(tag, fields);
  const declared: Result<Tag, typeof schema.Type> = {
    _tag: 'Result',
    tag,
    schema,
    is: Schema.is(schema),
  };
  return declared;
};

export interface Command<
  Name extends string = string,
  Args = unknown,
  Results extends AnyResult = AnyResult,
  Services = unknown,
> {
  readonly _tag: 'Command';
  readonly name: Name;
  /** The results it may come to. */
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
  /** Runs it: its result. */
  readonly execute: Effect.Effect<Input.Action, never, Services>;
}

/** What `C` gives when issued. */
export type IssuedOf<C extends Any> = ReturnType<C['of']>;

export const make = <
  const Name extends string,
  const F extends Fields,
  const Results extends ReadonlyArray<AnyResult>,
  Services = never,
>(
  name: Name,
  spec: {
    readonly args: F;
    readonly results: Results;
    readonly execute: (
      args: Schema.Struct<F>['Type'],
    ) => Effect.Effect<Rule.ValueOf<Results[number]>, never, Services>;
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
