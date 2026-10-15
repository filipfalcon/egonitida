import { type Stage, Styled } from '@nitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Option } from 'effect';
import type { Document, HtmlBuilder } from 'foldkit/html';
import { Message, type Model } from '#src/main.ts';
import { CANVAS_ID, MountCanvas } from '#src/session.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

const styles = stylex.create({
  playground: {
    position: 'relative',
    height: '100%',
    backgroundColor: colours.page,
    color: colours.text,
    fontFamily: 'system-ui, sans-serif',
  },
  viewport: { display: 'block', width: '100%', height: '100%' },
  // While the player plays with a pad, the cursor is of no use, over the canvas or the buttons.
  noCursor: { cursor: 'none' },
  overlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  button: {
    paddingBlock: 8,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: colours.accent,
    color: colours.onAccent,
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    cursor: { default: 'pointer', ':disabled': 'default' },
    opacity: { default: 1, ':disabled': 0.4 },
  },
  text: { margin: 0 },
  error: { color: colours.danger },
  measured: {
    position: 'absolute',
    top: 16,
    right: 16,
    margin: 0,
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: 6,
    backgroundColor: colours.panel,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
});

/** How the stage plays, as the page shows it: frames a second, and the way to the host and back, in milliseconds, finer below ten, or a dash while the host has not answered. */
export const measuredText = ({ framesPerSecond, latencyMillis }: Stage.Measured): string =>
  `${framesPerSecond} fps · ${Option.match(latencyMillis, {
    onNone: () => '–',
    onSome: (millis) => (millis < 10 ? millis.toFixed(1) : Math.round(millis).toString()),
  })} ms`;

/** The playground's page: the canvas, and over it the button that asks for a cube, the one that changes where the player looks from, and the count of cubes; and in its corner, how the stage plays. While the player plays with a pad, it shows no cursor. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const withPad = Option.contains(model.maybeInHand, 'Pad');
  return {
    title: 'Nitida Playground',
    body: h.main(Styled.attributes(h, styles.playground, withPad && styles.noCursor), [
      // The canvas is in the page while the session is joined, and goes with it.
      ...(model.session._tag === 'Joined'
        ? [
            h.canvas(
              [h.Id(CANVAS_ID), ...Styled.attributes(h, styles.viewport), h.OnMount(MountCanvas())],
              [],
            ),
          ]
        : []),
      h.div(Styled.attributes(h, styles.overlay), [
        h.button(
          [
            h.Type('button'),
            ...Styled.attributes(h, styles.button, withPad && styles.noCursor),
            h.Disabled(model.session._tag !== 'Joined'),
            h.OnClick(Message.ClickedSpawnCube()),
          ],
          ['Spawn cube'],
        ),
        h.button(
          [
            h.Type('button'),
            ...Styled.attributes(h, styles.button, withPad && styles.noCursor),
            h.OnClick(
              Message.ChoseViewpoint({
                viewpoint: model.viewpoint === 'Ahead' ? 'Overhead' : 'Ahead',
              }),
            ),
          ],
          [model.viewpoint === 'Ahead' ? 'Look from overhead' : 'Look from ahead'],
        ),
        h.p(Styled.attributes(h, styles.text), [
          `${model.cubeCount} ${model.cubeCount === 1 ? 'cube' : 'cubes'}`,
        ]),
        ...Option.match(model.maybeError, {
          onNone: () => [],
          onSome: (reason) => [h.p(Styled.attributes(h, styles.text, styles.error), [reason])],
        }),
      ]),
      ...Option.match(model.maybeMeasured, {
        onNone: () => [],
        onSome: (measured) => [
          h.p(
            [h.AriaLabel('How the game plays'), ...Styled.attributes(h, styles.measured)],
            [measuredText(measured)],
          ),
        ],
      }),
    ]),
  };
};
