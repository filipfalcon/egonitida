import { Option, Schema } from 'effect';

/**
 * Editor metadata on a Schema, the counterpart of Unreal's `UPROPERTY` specifiers. A field annotated with `inspector` shows in the Details panel with the widget it names; a field without one stays hidden there, whatever else the schema says about it.
 */

// What a field is annotated with.

export type Annotation =
  | { readonly _tag: 'Text' }
  | {
      readonly _tag: 'Number';
      readonly min: Option.Option<number>;
      readonly max: Option.Option<number>;
      readonly step: number;
    }
  | { readonly _tag: 'Color' }
  | { readonly _tag: 'Vector3'; readonly step: number }
  /** Its options come from the field's `Schema.Literals`. */
  | { readonly _tag: 'Choice' };

declare module 'effect/Schema' {
  namespace Annotations {
    interface Annotations {
      readonly inspector?: Annotation | undefined;
    }
  }
}

export const text = (): Annotation => ({ _tag: 'Text' });

export const number = (
  options: { readonly min?: number; readonly max?: number; readonly step?: number } = {},
): Annotation => ({
  _tag: 'Number',
  min: Option.fromNullishOr(options.min),
  max: Option.fromNullishOr(options.max),
  step: options.step ?? 1,
});

/** A whole number shown as a colour picker, read as `0xRRGGBB`. */
export const color = (): Annotation => ({ _tag: 'Color' });

export const vector3 = (options: { readonly step?: number } = {}): Annotation => ({
  _tag: 'Vector3',
  step: options.step ?? 1,
});

export const choice = (): Annotation => ({ _tag: 'Choice' });

// What the Details panel draws.

export type Widget =
  | Exclude<Annotation, { readonly _tag: 'Choice' }>
  | { readonly _tag: 'Choice'; readonly options: ReadonlyArray<string> };

export interface Property {
  readonly key: string;
  readonly title: string;
  readonly widget: Widget;
}

type AnyStruct = Schema.Struct<Schema.Struct.Fields>;

const optionsOf = (field: object): ReadonlyArray<string> =>
  'literals' in field && Array.isArray(field.literals)
    ? field.literals.filter((literal): literal is string => typeof literal === 'string')
    : [];

const widgetOf = (field: object, annotation: Annotation): Widget =>
  annotation._tag === 'Choice' ? { _tag: 'Choice', options: optionsOf(field) } : annotation;

/** The editable properties of a struct, in the order its fields are declared. */
export const properties = (schema: AnyStruct): ReadonlyArray<Property> =>
  Object.entries(schema.fields).flatMap(([key, field]) => {
    const annotations = Schema.resolveAnnotations(field);
    const annotation = annotations?.inspector;
    return annotation === undefined
      ? []
      : [{ key, title: annotations?.title ?? key, widget: widgetOf(field, annotation) }];
  });

/** `value` with `key` replaced by `candidate`, if the field's schema accepts the candidate. */
export const edit = <S extends AnyStruct>(
  schema: S,
  value: S['Type'],
  key: string,
  candidate: unknown,
): Option.Option<S['Type']> =>
  Option.fromNullishOr(schema.fields[key]).pipe(
    Option.flatMap((field) =>
      Schema.decodeUnknownOption(field as Schema.Codec<unknown>)(candidate),
    ),
    Option.map((decoded) => ({ ...value, [key]: decoded })),
  );
