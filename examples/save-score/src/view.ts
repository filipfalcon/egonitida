import { Styled } from '@egonitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Option } from 'effect';
import type { Document, HtmlBuilder } from 'foldkit/html';
import { Message, type Model, type Told } from '#src/main.ts';
import { CANVAS_ID, MountCanvas } from '#src/session.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

const styles = stylex.create({
  page: {
    position: 'relative',
    height: '100%',
    backgroundColor: colours.ground,
    color: colours.text,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 14,
  },
  viewport: { display: 'block', width: '100%', height: '100%' },
  hud: { position: 'absolute', top: 16, left: 16, display: 'flex', gap: 12, alignItems: 'center' },
  text: { margin: 0 },
  error: { color: colours.danger },
  button: {
    paddingBlock: 6,
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: colours.accent,
    color: colours.onAccent,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
});

/** How the round goes, in words. */
const sayOf = (round: Told) => {
  switch (round._tag) {
    case 'Playing':
      return `${round.hits} hits · ${round.secondsLeft} s left`;
    case 'Saving':
      return `${round.hits} hits · saving the score…`;
    case 'Saved':
      return `${round.hits} hits · best ${round.best}`;
    case 'Unsaved':
      return `${round.hits} hits · not saved: ${round.reason}`;
  }
};

/** Whether the round is over, its score saved or not, so a new one may be chosen. */
const isOver = (round: Told) => round._tag === 'Saved' || round._tag === 'Unsaved';

/** The page: the canvas, and over it how the round goes, with Play again once it is over. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Save a score',
  body: h.main(Styled.attributes(h, styles.page), [
    // The canvas is in the page while the round is joined, and goes with it.
    ...(model.session._tag === 'Joined'
      ? [
          h.canvas(
            [h.Id(CANVAS_ID), ...Styled.attributes(h, styles.viewport), h.OnMount(MountCanvas())],
            [],
          ),
        ]
      : []),
    h.div(Styled.attributes(h, styles.hud), [
      ...Option.match(model.maybeRound, {
        onNone: () => [],
        onSome: (round) => [
          h.p(Styled.attributes(h, styles.text), [sayOf(round)]),
          ...(isOver(round)
            ? [
                h.button(
                  [
                    h.Type('button'),
                    ...Styled.attributes(h, styles.button),
                    h.OnClick(Message.ClickedPlayAgain()),
                  ],
                  ['Play again'],
                ),
              ]
            : []),
        ],
      }),
      ...Option.match(model.maybeError, {
        onNone: () => [],
        onSome: (reason) => [h.p(Styled.attributes(h, styles.text, styles.error), [reason])],
      }),
    ]),
  ]),
});
