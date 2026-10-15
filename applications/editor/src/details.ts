import { Styled } from '@nitida/foldkit';
import type { Inspector } from '@nitida/reflection';
import * as stylex from '@stylexjs/stylex';
import type { Html, HtmlBuilder } from 'foldkit/html';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

/**
 * The Details panel: a form drawn from a schema's inspector properties. It knows nothing about entities; it draws whatever `properties` describe and reports each edit as a candidate value for the update to check against the schema.
 */

/** A typed number, or `NaN` when what is typed is not one yet, which the property's schema then rejects. */
export const parseNumber = (typed: string): number =>
  typed.trim() === '' ? Number.NaN : Number(typed);

/** A colour, `0xRRGGBB`, as a colour input writes it. */
export const toHex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** A colour input's `#rrggbb` as a colour, `0xRRGGBB`. */
export const fromHex = (hex: string): number => Number.parseInt(hex.slice(1), 16);

/** `vector` with its `index`th component made `value`, as one field of a vector is typed into. */
export const withComponent = (
  vector: ReadonlyArray<number>,
  index: number,
  value: number,
): ReadonlyArray<number> => vector.map((component, at) => (at === index ? value : component));

const axes = ['X', 'Y', 'Z'];

/** A property of a form: its label above its field, which fills the panel. */
export const form = stylex.create({
  property: { display: 'grid', gap: 4, marginBottom: 12 },
  label: { color: colours.muted },
  field: {
    boxSizing: 'border-box',
    width: '100%',
    minWidth: 0,
    paddingBlock: 5,
    paddingInline: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.controlHover,
    borderRadius: 4,
    backgroundColor: colours.page,
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  colour: { height: 32, padding: 2 },
  vector: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 },
});

const numberAttributes = <Message>(h: HtmlBuilder<Message>, widget: { readonly step: number }) => [
  h.Type('number'),
  h.Step(String(widget.step)),
];

const viewWidget = <Message>(
  h: HtmlBuilder<Message>,
  id: string,
  widget: Inspector.Widget,
  value: unknown,
  change: (candidate: unknown) => Message,
): Html => {
  switch (widget._tag) {
    case 'Text':
      return h.input([
        h.Id(id),
        ...Styled.attributes(h, form.field),
        h.Type('text'),
        h.Value(String(value)),
        h.OnInput(change),
      ]);
    case 'Number':
      return h.input([
        h.Id(id),
        ...Styled.attributes(h, form.field),
        ...numberAttributes(h, widget),
        ...(widget.min._tag === 'Some' ? [h.Min(String(widget.min.value))] : []),
        ...(widget.max._tag === 'Some' ? [h.Max(String(widget.max.value))] : []),
        h.Value(String(value)),
        h.OnInput((typed) => change(parseNumber(typed))),
      ]);
    case 'Color':
      return h.input([
        h.Id(id),
        ...Styled.attributes(h, form.field, form.colour),
        h.Type('color'),
        h.Value(toHex(Number(value))),
        h.OnInput((hex) => change(fromHex(hex))),
      ]);
    case 'Vector3': {
      const vector = Array.isArray(value) ? value.map(Number) : [0, 0, 0];
      return h.div(
        Styled.attributes(h, form.vector),
        vector.map((component, index) =>
          h.input([
            ...(index === 0 ? [h.Id(id)] : []),
            ...Styled.attributes(h, form.field),
            h.AriaLabel(axes[index] ?? ''),
            ...numberAttributes(h, widget),
            h.Value(String(component)),
            h.OnInput((typed) => change(withComponent(vector, index, parseNumber(typed)))),
          ]),
        ),
      );
    }
    case 'Choice':
      return h.select(
        [h.Id(id), ...Styled.attributes(h, form.field), h.OnChange(change)],
        widget.options.map((option) =>
          h.option([h.Value(option), h.Selected(option === value)], [option]),
        ),
      );
  }
};

/** A form of `properties` for `value`, each edit said as `change` of the property's key and the value typed, not yet checked. */
export const viewDetails = <Message>(
  h: HtmlBuilder<Message>,
  properties: ReadonlyArray<Inspector.Property>,
  value: Readonly<Record<string, unknown>>,
  change: (key: string, candidate: unknown) => Message,
  /** Keeps element ids unique when several forms share a page. */
  idPrefix = 'property',
): Html =>
  h.div(
    [],
    properties.map((property) => {
      const id = `${idPrefix}-${property.key}`;
      return h.div(Styled.attributes(h, form.property), [
        h.label([h.For(id), ...Styled.attributes(h, form.label)], [property.title]),
        viewWidget(h, id, property.widget, value[property.key], (candidate) =>
          change(property.key, candidate),
        ),
      ]);
    }),
  );
