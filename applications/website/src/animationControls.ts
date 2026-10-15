import { Styled } from '@egonitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import type { Html, HtmlBuilder } from 'foldkit/html';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

/**
 * The controls every animation on the website has, in a strip of their own under what it shows: back, stop or start, and next, each drawn as its symbol and named for a screen reader. What each does is the animation's own; a click on one goes no further than the control.
 */

const styles = stylex.create({
  // A strip of its own under what the animation shows, joined to it by the line between them.
  bar: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colours.border,
    backgroundColor: colours.surface,
  },
  control: {
    display: 'grid',
    placeItems: 'center',
    width: 40,
    height: 40,
    padding: 0,
    borderWidth: 0,
    borderRadius: 999,
    color: { default: colours.muted, ':hover': colours.text, ':focus-visible': colours.text },
    backgroundColor: { default: 'transparent', ':hover': colours.border },
    outline: { default: 'none', ':focus-visible': `2px solid ${colours.accent}` },
    cursor: 'pointer',
  },
  main: { color: colours.text },
  icon: { width: 18, height: 18, fill: 'currentColor' },
});

/** The symbols, each a path in a 24 by 24 box. */
const BACK =
  'M6 5h2.4v14H6zM19 5.6v12.8a.8.8 0 0 1-1.2.7L9.5 12.7a.8.8 0 0 1 0-1.4l8.3-6.4a.8.8 0 0 1 1.2.7z';
const NEXT =
  'M15.6 5H18v14h-2.4zM5 5.6v12.8a.8.8 0 0 0 1.2.7l8.3-6.4a.8.8 0 0 0 0-1.4L6.2 4.9a.8.8 0 0 0-1.2.7z';
const STOP = 'M6.5 5h3.6v14H6.5zM13.9 5h3.6v14h-3.6z';
const START = 'M7 5.4v13.2a.9.9 0 0 0 1.4.8l10.4-6.6a.9.9 0 0 0 0-1.6L8.4 4.6a.9.9 0 0 0-1.4.8z';

/** What an animation's controls do, and whether its time runs, so the middle one stops it or starts it. */
export interface Controls<Message> {
  readonly isRunning: boolean;
  readonly back: Message;
  readonly stop: Message;
  readonly start: Message;
  readonly next: Message;
}

/** The controls of an animation, as the strip under what it shows. */
export const view = <Message>(h: HtmlBuilder<Message>, controls: Controls<Message>): Html => {
  const control = (label: string, symbol: string, message: Message, isMain = false) =>
    h.button(
      [
        h.Type('button'),
        h.AriaLabel(label),
        h.Title(label),
        h.OnClick(message, { propagation: 'Stop' }),
        ...Styled.attributes(h, styles.control, isMain && styles.main),
      ],
      [
        h.svg(
          [h.ViewBox('0 0 24 24'), h.AriaHidden(true), ...Styled.attributes(h, styles.icon)],
          [h.path([h.D(symbol)])],
        ),
      ],
    );
  return h.div(
    [h.Role('group'), h.AriaLabel('Animation'), ...Styled.attributes(h, styles.bar)],
    [
      control('Back', BACK, controls.back),
      controls.isRunning
        ? control('Stop', STOP, controls.stop, true)
        : control('Start', START, controls.start, true),
      control('Next', NEXT, controls.next),
    ],
  );
};
