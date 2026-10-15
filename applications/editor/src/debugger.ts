import type { Log } from '@egonitida/devtools';
import { Styled } from '@egonitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Option, Schema } from 'effect';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { Message, type Model, type PlayingState } from '#src/main.ts';
import { ui } from '#src/ui.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

const styles = stylex.create({
  status: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: 0,
  },
  live: { color: colours.play },
  past: { color: colours.past },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  step: {
    width: '100%',
    marginBottom: 2,
    backgroundColor: 'transparent',
    textAlign: 'left',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12,
  },
  shown: { backgroundColor: colours.control },
  tick: { color: colours.muted },
  change: {
    paddingBlock: 2,
    color: colours.past,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12,
  },
  state: {
    margin: 0,
    padding: 8,
    overflowX: 'auto',
    borderRadius: 6,
    backgroundColor: colours.page,
    fontSize: 11,
  },
});

/** What an action's fields say of the entity it was taken on, if anything. */
const Fields = Schema.fromJsonString(Schema.Struct({ entity: Schema.optional(Schema.Int) }));

/** An entity, by the name the outliner gives it, or its id. */
const nameOf = (model: Model, entity: number) =>
  model.outline.find((object) => object.entity === entity)?.name ?? `entity ${entity}`;

/** What happened at a step, as one line: what the players did, or else what changed. */
const summaryOf = (model: Model, step: Log.Step) =>
  step.actions.length === 0
    ? step.parts.map(({ part }) => part).join(', ')
    : step.actions
        .map(({ tag, fields }) =>
          Option.match(
            Option.flatMap(Schema.decodeOption(Fields)(fields), ({ entity }) =>
              Option.fromNullishOr(entity),
            ),
            { onNone: () => tag, onSome: (entity) => `${tag} · ${nameOf(model, entity)}` },
          ),
        )
        .join(', ');

/** What each part of the game changed at a step, a line to each component it set and each entity it made or let go. */
const changesOf = (model: Model, step: Log.Step): ReadonlyArray<string> =>
  step.parts.flatMap(({ part, set, spawned, despawned }) => [
    ...Object.entries(set).map(
      ([component, entities]) =>
        `${part}: ${component} of ${entities.map((entity) => nameOf(model, entity)).join(', ')}`,
    ),
    ...spawned.map((entity) => `${part}: made ${nameOf(model, entity)}`),
    ...despawned.map((entity) => `${part}: let go of ${nameOf(model, entity)}`),
  ]);

/** What the document playing has been through: what happened at each step, what it changed, and the state after any of them. */
export const viewDebugger = (
  model: Model,
  playing: PlayingState,
  h: HtmlBuilder<Message>,
): Html => {
  const shownTick = Option.map(playing.maybePast, ({ tick }) => tick);
  const shown = Option.flatMap(shownTick, (tick) =>
    Option.fromNullishOr(playing.steps.find((step) => step.tick === tick)),
  );
  return h.section(
    [],
    [
      h.h2(Styled.attributes(h, ui.heading), ['Debugger']),
      Option.match(shownTick, {
        onNone: () => h.p(Styled.attributes(h, styles.status, styles.live), ['● Live']),
        onSome: (tick) =>
          h.div(Styled.attributes(h, styles.status, styles.past), [
            h.span([], [`❚❚ Showing tick ${tick}`]),
            h.button(
              [
                h.Type('button'),
                ...Styled.attributes(h, ui.button),
                h.OnClick(Message.ClickedLive()),
              ],
              ['Back to live'],
            ),
          ]),
      }),
      h.h2(Styled.attributes(h, ui.heading), ['Events']),
      playing.steps.length === 0
        ? h.p(Styled.attributes(h, ui.hint), ['Click objects to make them react.'])
        : h.ol(
            Styled.attributes(h, styles.list),
            playing.steps.map((step) => {
              const isShown = Option.contains(shownTick, step.tick);
              return h.li(
                [h.Key(String(step.tick))],
                [
                  h.button(
                    [
                      h.Type('button'),
                      ...Styled.attributes(h, ui.button, styles.step, isShown && styles.shown),
                      h.AriaPressed(String(isShown)),
                      h.OnClick(Message.InspectedStep({ tick: step.tick })),
                    ],
                    [
                      h.span(Styled.attributes(h, styles.tick), [`#${step.tick}`]),
                      ` ${summaryOf(model, step)}`,
                    ],
                  ),
                ],
              );
            }),
          ),
      ...Option.match(shown, {
        onNone: () => [],
        onSome: (step) => [
          h.h2(Styled.attributes(h, ui.heading), ['Changes']),
          changesOf(model, step).length === 0
            ? h.p(Styled.attributes(h, ui.hint), ['This step changed nothing.'])
            : h.ul(
                Styled.attributes(h, styles.list),
                changesOf(model, step).map((change) =>
                  h.li(Styled.attributes(h, styles.change), [change]),
                ),
              ),
        ],
      }),
      ...Option.match(playing.maybePast, {
        onNone: () => [],
        onSome: ({ state }) => [
          h.h2(Styled.attributes(h, ui.heading), ['State']),
          h.pre(Styled.attributes(h, styles.state), [state]),
        ],
      }),
    ],
  );
};
