import { Option } from 'effect';
import type { Document, Html, HtmlBuilder } from 'foldkit/html';
import { viewBehaviour } from '#src/behaviour.ts';
import { viewDebugger } from '#src/debugger.ts';
import { viewDetails } from '#src/details.ts';
import { type Entity, entityProperties } from '#src/document.ts';
import { Message, type Model, displayedWorld } from '#src/main.ts';
import { MountViewport, VIEWPORT_ID } from '#src/viewport.ts';

const viewOutliner = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isPlaying = Option.isSome(model.maybeSession);
  return h.aside(
    [h.Class('panel outliner')],
    [
      h.header(
        [h.Class('toolbar')],
        [
          h.button(
            [
              h.Type('button'),
              h.Disabled(isPlaying),
              h.OnClick(Message.ClickedAddEntity({ shape: 'Box' })),
            ],
            ['+ Box'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Disabled(isPlaying),
              h.OnClick(Message.ClickedAddEntity({ shape: 'Sphere' })),
            ],
            ['+ Sphere'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Disabled(isPlaying || Option.isNone(model.maybeSelectedId)),
              h.OnClick(Message.ClickedDeleteSelected()),
            ],
            ['Delete'],
          ),
        ],
      ),
      h.h2([], ['Outliner']),
      h.ul(
        [h.Class('entities')],
        model.document.entities.map((entity) => {
          const isSelected = Option.exists(model.maybeSelectedId, (id) => id === entity.id);
          return h.li(
            [h.Key(entity.id)],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class(isSelected ? 'entity selected' : 'entity'),
                  h.Disabled(isPlaying),
                  h.AriaPressed(String(isSelected)),
                  h.OnClick(Message.SelectedEntity({ id: entity.id })),
                ],
                [
                  `${entity.shape === 'Box' ? '■' : '●'} ${entity.name}`,
                  ...(entity.rules.length > 0 ? [h.span([h.Class('badge')], ['⚡'])] : []),
                ],
              ),
            ],
          );
        }),
      ),
    ],
  );
};

const viewSelected = (model: Model, entity: Entity, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Key(entity.id)],
    [
      viewDetails(h, entityProperties, entity, (key, value) =>
        Message.ChangedProperty({ id: entity.id, key, value }),
      ),
      viewBehaviour(h, entity, model.document.entities),
    ],
  );

const viewDetailsPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    [h.Class('panel')],
    [
      h.h2([], ['Details']),
      Option.match(
        Option.flatMap(model.maybeSelectedId, (id) =>
          Option.fromNullishOr(model.document.entities.find((entity) => entity.id === id)),
        ),
        {
          onNone: () => h.p([h.Class('hint')], ['Select an object to edit it.']),
          // Keyed by entity, so switching selection replaces the form instead of patching one entity's inputs into another's.
          onSome: (entity) => viewSelected(model, entity, h),
        },
      ),
    ],
  );

const viewSidePanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(
    Option.zipWith(model.maybeSession, displayedWorld(model), (session, world) => ({
      session,
      world,
    })),
    {
      onNone: () => viewDetailsPanel(model, h),
      onSome: ({ session, world }) =>
        h.aside([h.Class('panel')], [viewDebugger(h, session, world)]),
    },
  );

const viewPlayControls = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('play-controls')],
    [
      Option.isSome(model.maybeSession)
        ? h.button(
            [h.Type('button'), h.Class('stop'), h.OnClick(Message.ClickedStop())],
            ['■ Stop'],
          )
        : h.button(
            [h.Type('button'), h.Class('play'), h.OnClick(Message.ClickedPlay())],
            ['▶ Play'],
          ),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'LightOcean Editor',
  body: h.div(
    [h.Class(Option.isSome(model.maybeSession) ? 'editor playing' : 'editor')],
    [
      viewOutliner(model, h),
      h.main(
        [h.Class('stage')],
        [
          h.canvas(
            [
              h.Id(VIEWPORT_ID),
              h.Class('viewport'),
              h.AriaLabel('Viewport'),
              h.OnMount(MountViewport({ viewportId: VIEWPORT_ID })),
            ],
            [],
          ),
          viewPlayControls(model, h),
          ...Option.match(model.maybeViewportError, {
            onNone: () => [],
            onSome: (reason) => [h.p([h.Class('error')], [reason])],
          }),
        ],
      ),
      viewSidePanel(model, h),
    ],
  ),
});
