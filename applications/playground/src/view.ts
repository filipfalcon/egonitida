import { Styled } from '@lightocean/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Option } from 'effect';
import type { Document, HtmlBuilder } from 'foldkit/html';
import { Message, type Model } from '#src/main.ts';
import { CANVAS_ID, MountCanvas } from '#src/world.ts';
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
    color: 'white',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    cursor: { default: 'pointer', ':disabled': 'default' },
    opacity: { default: 1, ':disabled': 0.4 },
  },
  text: { margin: 0 },
  error: { color: colours.danger },
});

/** The playground's page: the canvas, and over it the button that asks for a cube and the count of them. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'LightOcean Playground',
  body: h.main(Styled.attributes(h, styles.playground), [
    // The canvas is in the page while the world is joined, and goes with it.
    ...(model.world._tag === 'Joined'
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
          ...Styled.attributes(h, styles.button),
          h.Disabled(model.world._tag !== 'Joined'),
          h.OnClick(Message.ClickedSpawnCube()),
        ],
        ['Spawn cube'],
      ),
      h.p(Styled.attributes(h, styles.text), [
        `${model.cubeCount} ${model.cubeCount === 1 ? 'cube' : 'cubes'}`,
      ]),
      ...Option.match(model.maybeError, {
        onNone: () => [],
        onSome: (reason) => [h.p(Styled.attributes(h, styles.text, styles.error), [reason])],
      }),
    ]),
  ]),
});
