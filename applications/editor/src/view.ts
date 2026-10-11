import { Styled } from '@lightocean/foldkit';
import { Inspector } from '@lightocean/reflection';
import * as stylex from '@stylexjs/stylex';
import { Option, Schema } from 'effect';
import type { Document, Html, HtmlBuilder } from 'foldkit/html';
import { viewBehaviour } from '#src/behaviour.ts';
import { viewDebugger } from '#src/debugger.ts';
import { viewDetails } from '#src/details.ts';
import { Message, type Model, type Selected } from '#src/main.ts';
import * as Objects from '#src/objects.ts';
import { ui } from '#src/ui.ts';
import { CANVAS_ID, MountCanvas } from '#src/world.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

const styles = stylex.create({
  editor: {
    backgroundColor: colours.page,
    color: colours.text,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 14,
    lineHeight: 1.4,
    display: 'grid',
    gridTemplateColumns: '240px 1fr 300px',
    // One row, as tall as the window: a row sized by its content would grow with the canvas, which sizes itself by the row.
    gridTemplateRows: '100%',
    height: '100%',
  },
  panel: { overflowY: 'auto', padding: 12, backgroundColor: colours.panel },
  toolbar: { display: 'flex', gap: 6 },
  objects: { margin: 0, padding: 0, listStyle: 'none' },
  object: { width: '100%', marginBottom: 2, backgroundColor: 'transparent', textAlign: 'left' },
  selected: { backgroundColor: colours.accent, color: colours.onAccent },
  badge: { float: 'right', opacity: 0.7 },
  stage: { position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden' },
  viewport: { display: 'block', width: '100%', height: '100%' },
  error: { position: 'absolute', top: 12, left: 12, margin: 0, color: colours.danger },
  playing: { boxShadow: `inset 0 0 0 3px ${colours.play}` },
  controls: { position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)' },
  play: { backgroundColor: colours.play },
  stop: { backgroundColor: colours.stop },
});

/** Whether the document is being edited, rather than played. */
const isEditing = (model: Model) => model.play._tag === 'Editing';

/** Whether the document is joined. */
const isJoined = (model: Model) => model.document._tag === 'Joined';

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
  h.aside(Styled.attributes(h, styles.panel), [
    h.header(Styled.attributes(h, styles.toolbar), [
      h.button(
        [
          h.Type('button'),
          ...Styled.attributes(h, ui.button),
          h.Disabled(!isJoined(model) || !isEditing(model)),
          h.OnClick(Message.ClickedAddObject({ shape: 'Box' })),
        ],
        ['+ Box'],
      ),
      h.button(
        [
          h.Type('button'),
          ...Styled.attributes(h, ui.button),
          h.Disabled(!isJoined(model) || !isEditing(model)),
          h.OnClick(Message.ClickedAddObject({ shape: 'Sphere' })),
        ],
        ['+ Sphere'],
      ),
      h.button(
        [
          h.Type('button'),
          ...Styled.attributes(h, ui.button),
          h.Disabled(Option.isNone(model.maybeSelected) || !isEditing(model)),
          h.OnClick(Message.ClickedDeleteSelected()),
        ],
        ['Delete'],
      ),
    ]),
    h.h2(Styled.attributes(h, ui.heading), ['Outliner']),
    h.ul(
      Styled.attributes(h, styles.objects),
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
                ...Styled.attributes(h, ui.button, styles.object, isSelected && styles.selected),
                h.AriaPressed(String(isSelected)),
                h.Disabled(!isEditing(model)),
                h.OnClick(Message.ClickedObject({ entity })),
              ],
              [
                `${kind === 'Box' ? '■' : '●'} ${name}`,
                ...(reacts ? [h.span(Styled.attributes(h, styles.badge), ['⚡'])] : []),
              ],
            ),
          ],
        );
      }),
    ),
  ]);

const viewSelected = (model: Model, selected: Selected, h: HtmlBuilder<Message>): Html => {
  const values = valuesOf(selected);
  return h.div(
    [h.Key(String(selected.entity))],
    [
      h.button(
        [
          h.Type('button'),
          ...Styled.attributes(h, ui.button),
          h.OnClick(Message.ClickedDeselect()),
        ],
        ['Deselect'],
      ),
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

/** The panel beside the canvas: the details of what is selected while the document is edited, the debugger while it plays. */
const viewSidePanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    Styled.attributes(h, styles.panel),
    model.play._tag === 'Playing'
      ? [viewDebugger(model, model.play, h)]
      : [
          h.h2(Styled.attributes(h, ui.heading), ['Details']),
          Option.match(model.maybeSelected, {
            onNone: () => h.p(Styled.attributes(h, ui.hint), ['Select an object to edit it.']),
            // Keyed by object, so switching selection replaces the form instead of patching one object's inputs into another's.
            onSome: (selected) => viewSelected(model, selected, h),
          }),
        ],
  );

/** The editor's page: the outliner, the canvas with Play and Stop, and the details of what is selected or the debugger. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'LightOcean Editor',
  body: h.div(Styled.attributes(h, styles.editor), [
    viewOutliner(model, h),
    h.main(Styled.attributes(h, styles.stage, !isEditing(model) && styles.playing), [
      // The canvas is in the page while the document is joined, and goes with it.
      ...(isJoined(model)
        ? [
            h.canvas(
              [
                h.Id(CANVAS_ID),
                ...Styled.attributes(h, styles.viewport),
                h.AriaLabel('Viewport'),
                h.OnMount(MountCanvas()),
              ],
              [],
            ),
          ]
        : []),
      h.div(Styled.attributes(h, styles.controls), [
        isEditing(model)
          ? h.button(
              [
                h.Type('button'),
                ...Styled.attributes(h, ui.button, styles.play),
                h.Disabled(!isJoined(model)),
                h.OnClick(Message.ClickedPlay()),
              ],
              ['▶ Play'],
            )
          : h.button(
              [
                h.Type('button'),
                ...Styled.attributes(h, ui.button, styles.stop),
                h.OnClick(Message.ClickedStop()),
              ],
              ['■ Stop'],
            ),
      ]),
      ...Option.match(model.maybeError, {
        onNone: () => [],
        onSome: (reason) => [h.p(Styled.attributes(h, styles.error), [reason])],
      }),
    ]),
    viewSidePanel(model, h),
  ]),
});
