import { Option, Schema, SchemaAST } from 'effect';

/**
 * Where a value lies between two others, for drawing between two steps. It is read off the value's schema, the way the editor's Details panel is: numbers move in a straight line, structs and tuples move field by field, a number annotated `interpolate: 'angle'` turns the short way round, and anything annotated `interpolate: 'step'` stays at the earlier value until the later one is reached.
 *
 * The value moves in its canonical JSON form, and the result is decoded by the same schema, so its type is proven rather than claimed. Two modes of a tagged union, or an option and its absence, never blend: the earlier holds until the later is reached. A value that cannot lie between two others, such as a whole number, a boolean, or a choice, fails to decode in between and stays at the earlier value until the later one is reached.
 */

declare module 'effect/Schema' {
  namespace Annotations {
    interface Annotations {
      /**
       * How a value moves from one to the next: an angle turns the short way round; a step stays at the earlier value until the later one is reached, for a number that is really a choice, such as a stage.
       */
      readonly interpolate?: 'angle' | 'step' | undefined;
    }
  }
}

/** The signed turn from one angle to another, the short way round. */
const turnBetween = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

const howOf = (ast: SchemaAST.AST | undefined) =>
  ast === undefined ? undefined : SchemaAST.resolve(ast)?.interpolate;

/** `a` moved toward `b` by `t`, in encoded form, following the schema's nodes where it has them. */
const move = (ast: SchemaAST.AST | undefined, a: unknown, b: unknown, t: number): unknown => {
  const how = howOf(ast);
  if (how === 'step') {
    return a;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return how === 'angle' ? a + turnBetween(a, b) * t : a + (b - a) * t;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    const earlier: ReadonlyArray<unknown> = a;
    const later: ReadonlyArray<unknown> = b;
    const elements = ast !== undefined && SchemaAST.isArrays(ast) ? ast.elements : [];
    return earlier.map((value, index) => move(elements[index], value, later[index], t));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    // Two modes of a union stay apart: the earlier one holds until the later one is reached, whatever fields they share.
    if ('_tag' in a && '_tag' in b && a._tag !== b._tag) {
      return a;
    }
    const fields = new Map<PropertyKey, SchemaAST.AST>(
      ast !== undefined && SchemaAST.isObjects(ast)
        ? ast.propertySignatures.map((field) => [field.name, field.type])
        : [],
    );
    const earlier: ReadonlyArray<readonly [string, unknown]> = Object.entries(a);
    const later = new Map<string, unknown>(Object.entries(b));
    return Object.fromEntries(
      earlier.map(([key, value]) => [
        key,
        later.has(key) ? move(fields.get(key), value, later.get(key), t) : value,
      ]),
    );
  }
  return a;
};

/** The value a fraction `t` of the way from `a` to `b`: `a` at 0, `b` at 1. */
export const between = <Value>(
  schema: Schema.Codec<Value, unknown>,
  a: Value,
  b: Value,
  t: number,
): Value => {
  if (t >= 1) {
    return b;
  }
  // Kept whole as a step, it is not worked through at all: what is drawn
  // between holds the earlier value as it is.
  if (t <= 0 || howOf(schema.ast) === 'step') {
    return a;
  }
  const json = Schema.toCodecJson(schema);
  const encode = Schema.encodeSync(json);
  return Option.getOrElse(
    Schema.decodeUnknownOption(json)(move(schema.ast, encode(a), encode(b), t)),
    () => a,
  );
};
