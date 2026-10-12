import * as stylex from '@stylexjs/stylex';

/** The website's colours: a night sea, its lights, the text over it, and the dark before a state begins. StyleX keeps variables in a `.stylex.ts` module of their own. */
export const colours = stylex.defineVars({
  page: '#050b18',
  surface: '#0b1530',
  code: '#08101f',
  border: '#1c2a4a',
  text: '#e6edf7',
  muted: '#93a4c3',
  accent: '#5cc8ff',
  onAccent: '#04101f',
  warning: '#ffd166',
  danger: '#ff6b6b',
  void: '#000000',
});

/** The figures' inks on the night sea: the paper a solid's fill hides what is behind with, its sides in four tones from darkest to lightest and its top, the lit part's faces, the line tones from brightest to faintest, the one accent the reader should watch, and the shadow under what stands on the bench. */
export const inks = stylex.defineVars({
  paper: '#08101f',
  card: '#08101f',
  shade0: '#0a1326',
  shade1: '#0c162b',
  shade2: '#0e1930',
  shade3: '#101c35',
  top: '#121e3a',
  litFace: '#12203f',
  litTop: '#1a2a4d',
  litShade: '#152343',
  hi: '#d6e2f5',
  mid: '#6b7da0',
  lo: '#3a4a6b',
  faint: '#24314d',
  lit: '#5cc8ff',
  dot: '#e6edf7',
  halo: '#010309',
});
