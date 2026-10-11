import { Inspector } from '@lightocean/reflection';
import { Option, Schema } from 'effect';
import type { Document, Html, HtmlBuilder } from 'foldkit/html';
import { viewBehaviour } from '#src/behaviour.ts';
import { viewDetails } from '#src/details.ts';
import { Message, type Model, type Selected } from '#src/main.ts';
import * as Objects from '#src/objects.ts';
import { CANVAS_ID, MountCanvas } from '#src/world.ts';

/** An object's name, as the Details panel edits it: its label's text. */
const NameFields = Schema.Struct({
  text: Schema.String.annotate({ title: 'Name', inspector: Inspector.text() }),
});

/** Each component the Details panel edits, with the properties its schema shows, in order. */
const SECTIONS = [
  { component: 'Label', properties: Inspector.properties(NameFields) },
  { component: 'Shape', properties: Inspector.properties(Objects.ShapeFields) },
  { component: 'Transform', properties: Inspector.properties(Objects.TransformFields) },
  { component: 'Colour', properties: Inspector.properties(Objects.ColourFields) },
  { component: 'Spin', properties: Inspector.properties(Objects.SpinFields) },
];

/** The value of each component of `selected` the Details panel edits. */
const valuesOf = (
  selected: Selected,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> => ({
  Label: { text: selected.name },
  Shape: selected.shape,
  Transform: selected.transform,
  Colour: selected.colour,
  Spin: selected.spin,
});

const viewOutliner = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    [h.Class('panel outliner')],
    [
      h.header(
        [h.Class('toolbar')],
        [
          h.button(
            [
              h.Type('button'),
              h.Disabled(!model.isDocumentJoined),
              h.OnClick(Message.ClickedAddObject({ shape: 'Box' })),
            ],
            ['+ Box'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Disabled(!model.isDocumentJoined),
              h.OnClick(Message.ClickedAddObject({ shape: 'Sphere' })),
            ],
            ['+ Sphere'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Disabled(Option.isNone(model.maybeSelected)),
              h.OnClick(Message.ClickedDeleteSelected()),
            ],
            ['Delete'],
          ),
        ],
      ),
      h.h2([], ['Outliner']),
      h.ul(
        [h.Class('entities')],
        model.outline.map(({ entity, name, kind, reacts }) => {
          const isSelected = Option.exists(
            model.maybeSelected,
            (selected) => selected.entity === entity,
          );
          return h.li(
            [h.Key(String(entity))],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class(isSelected ? 'entity selected' : 'entity'),
                  h.AriaPressed(String(isSelected)),
                  h.OnClick(Message.ClickedObject({ entity })),
                ],
                [
                  `${kind === 'Box' ? '■' : '●'} ${name}`,
                  ...(reacts ? [h.span([h.Class('badge')], ['⚡'])] : []),
                ],
              ),
            ],
          );
        }),
      ),
    ],
  );

const viewSelected = (model: Model, selected: Selected, h: HtmlBuilder<Message>): Html => {
  const values = valuesOf(selected);
  return h.div(
    [h.Key(String(selected.entity))],
    [
      h.button([h.Type('button'), h.OnClick(Message.ClickedDeselect())], ['Deselect']),
      ...SECTIONS.map(({ component, properties }) =>
        viewDetails(
          h,
          properties,
          values[component] ?? {},
          (field, value) => Message.ChangedProperty({ component, field, value }),
          `${component}-${selected.entity}`,
        ),
      ),
      viewBehaviour(h, selected, model.outline),
    ],
  );
};

const viewDetailsPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    [h.Class('panel')],
    [
      h.h2([], ['Details']),
      Option.match(model.maybeSelected, {
        onNone: () => h.p([h.Class('hint')], ['Select an object to edit it.']),
        // Keyed by object, so switching selection replaces the form instead of patching one object's inputs into another's.
        onSome: (selected) => viewSelected(model, selected, h),
      }),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'LightOcean Editor',
  body: h.div(
    [h.Class('editor')],
    [
      viewOutliner(model, h),
      h.main(
        [h.Class('stage')],
        [
          // The canvas is in the page while the document is joined, and goes with it.
          ...(model.isDocumentJoined
            ? [
                h.canvas(
                  [
                    h.Id(CANVAS_ID),
                    h.Class('viewport'),
                    h.AriaLabel('Viewport'),
                    h.OnMount(MountCanvas()),
                  ],
                  [],
                ),
              ]
            : []),
          ...Option.match(model.maybeError, {
            onNone: () => [],
            onSome: (reason) => [h.p([h.Class('error')], [reason])],
          }),
        ],
      ),
      viewDetailsPanel(model, h),
    ],
  ),
});
