import type { Inspector } from '@lightocean/reflection';
import type { Html, HtmlBuilder } from 'foldkit/html';

/**
 * The Details panel: a form drawn from a schema's inspector properties. It knows nothing about entities; it draws whatever `properties` describe and reports each edit as a candidate value for the update to check against the schema.
 */

/** A typed number, or `NaN` when what is typed is not one yet, which the property's schema then rejects. */
export const parseNumber = (typed: string): number =>
  typed.trim() === '' ? Number.NaN : Number(typed);

export const toHex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export const fromHex = (hex: string): number => Number.parseInt(hex.slice(1), 16);

export const withComponent = (
  vector: ReadonlyArray<number>,
  index: number,
  value: number,
): ReadonlyArray<number> => vector.map((component, at) => (at === index ? value : component));

const axes = ['X', 'Y', 'Z'];

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
      return h.input([h.Id(id), h.Type('text'), h.Value(String(value)), h.OnInput(change)]);
    case 'Number':
      return h.input([
        h.Id(id),
        ...numberAttributes(h, widget),
        ...(widget.min._tag === 'Some' ? [h.Min(String(widget.min.value))] : []),
        ...(widget.max._tag === 'Some' ? [h.Max(String(widget.max.value))] : []),
        h.Value(String(value)),
        h.OnInput((typed) => change(parseNumber(typed))),
      ]);
    case 'Color':
      return h.input([
        h.Id(id),
        h.Type('color'),
        h.Value(toHex(Number(value))),
        h.OnInput((hex) => change(fromHex(hex))),
      ]);
    case 'Vector3': {
      const vector = Array.isArray(value) ? value.map(Number) : [0, 0, 0];
      return h.div(
        [h.Class('vector')],
        vector.map((component, index) =>
          h.input([
            ...(index === 0 ? [h.Id(id)] : []),
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
        [h.Id(id), h.OnChange(change)],
        widget.options.map((option) =>
          h.option([h.Value(option), h.Selected(option === value)], [option]),
        ),
      );
  }
};

export const viewDetails = <Message>(
  h: HtmlBuilder<Message>,
  properties: ReadonlyArray<Inspector.Property>,
  value: Readonly<Record<string, unknown>>,
  change: (key: string, candidate: unknown) => Message,
  /** Keeps element ids unique when several forms share a page. */
  idPrefix = 'property',
): Html =>
  h.div(
    [h.Class('details')],
    properties.map((property) => {
      const id = `${idPrefix}-${property.key}`;
      return h.div(
        [h.Class('property')],
        [
          h.label([h.For(id)], [property.title]),
          viewWidget(h, id, property.widget, value[property.key], (candidate) =>
            change(property.key, candidate),
          ),
        ],
      );
    }),
  );
