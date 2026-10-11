import * as stylex from '@stylexjs/stylex';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

/** What the editor's panels share: buttons, headings, and hints. */
export const ui = stylex.create({
  button: {
    paddingBlock: 6,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: {
      default: colours.control,
      ':hover:not(:disabled)': colours.controlHover,
    },
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    cursor: { default: 'pointer', ':disabled': 'default' },
    opacity: { default: 1, ':disabled': 0.4 },
  },
  heading: {
    marginBlock: '16px 8px',
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: colours.muted,
  },
  hint: {
    color: colours.muted,
  },
});
