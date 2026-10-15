import { Styled } from '@egonitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Option } from 'effect';
import type { Html, HtmlBuilder } from 'foldkit/html';
// The smallest game's files as they are, so the page shows the code the repository runs.
import cubeStory from '../../../../examples/spinning-cube/src/cube.story.test.ts?raw';
import cube from '../../../../examples/spinning-cube/src/cube.ts?raw';
import cubeView from '../../../../examples/spinning-cube/src/cube.view.ts?raw';
import { docsSections, firstPageOf } from '#src/docsNav.ts';
import { DISCORD, REPOSITORY, inRepository } from '#src/links.ts';
import type { Message, Model } from '#src/main.ts';
import { architectureRouter } from '#src/route.ts';
import { CANVAS_ID, MountCanvas } from '#src/session.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from '../tokens.stylex.ts';

const NARROW = '@media (max-width: 720px)';

const styles = stylex.create({
  page: {
    minHeight: '100vh',
    backgroundColor: colours.page,
    color: colours.text,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 17,
    lineHeight: 1.6,
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingBlock: 20,
    paddingInline: { default: 40, [NARROW]: 16 },
  },
  wordmark: { fontWeight: 700, fontSize: 20, letterSpacing: '0.02em', color: colours.text },
  links: { display: 'flex', flexWrap: 'wrap', gap: { default: 24, [NARROW]: 14 } },
  link: {
    color: { default: colours.muted, ':hover': colours.text },
    textDecoration: 'none',
  },
  hero: {
    position: 'relative',
    height: { default: 'min(88vh, 820px)', [NARROW]: '86vh' },
    minHeight: 520,
    overflow: 'hidden',
  },
  canvas: { display: 'block', width: '100%', height: '100%' },
  // Over the canvas, letting clicks through to the lights except on its links.
  heroText: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBlock: { default: 56, [NARROW]: 32 },
    paddingInline: { default: 40, [NARROW]: 16 },
    backgroundImage: `linear-gradient(to top, ${colours.page} 15%, transparent)`,
    pointerEvents: 'none',
  },
  title: {
    margin: 0,
    maxWidth: 760,
    fontSize: { default: 64, [NARROW]: 40 },
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
  },
  lead: {
    maxWidth: 680,
    marginBlock: 20,
    color: colours.muted,
    fontSize: { default: 20, [NARROW]: 18 },
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  primary: {
    pointerEvents: 'auto',
    paddingBlock: 12,
    paddingInline: 20,
    borderRadius: 8,
    backgroundColor: colours.accent,
    color: colours.onAccent,
    fontWeight: 600,
    textDecoration: 'none',
  },
  secondary: {
    pointerEvents: 'auto',
    paddingBlock: 11,
    paddingInline: 19,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 8,
    color: colours.text,
    textDecoration: 'none',
    backgroundColor: { default: 'transparent', ':hover': colours.surface },
  },
  caption: { marginTop: 24, marginBottom: 0, color: colours.muted, fontSize: 14 },
  error: { color: colours.danger },
  section: {
    maxWidth: 1080,
    marginInline: 'auto',
    paddingBlock: { default: 72, [NARROW]: 48 },
    paddingInline: { default: 40, [NARROW]: 16 },
  },
  heading: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: { default: 36, [NARROW]: 28 },
    lineHeight: 1.2,
  },
  intro: { marginTop: 0, marginBottom: 32, maxWidth: 720, color: colours.muted },
  file: { marginBottom: 32 },
  fileName: { margin: 0, fontSize: 18 },
  fileNote: { marginTop: 4, marginBottom: 12, color: colours.muted },
  code: {
    margin: 0,
    padding: 20,
    overflowX: 'auto',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 8,
    backgroundColor: colours.code,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 14,
    lineHeight: 1.55,
  },
  inline: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.9em',
    color: colours.accent,
  },
  // Left out of a narrow bar, which has room for only the links found nowhere else on the page.
  wide: { display: { default: 'inline', [NARROW]: 'none' } },
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(3, 1fr)',
      '@media (max-width: 960px)': '1fr 1fr',
      [NARROW]: '1fr',
    },
    gap: 16,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  card: {
    padding: 24,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 8,
    backgroundColor: colours.surface,
  },
  cardTitle: { marginTop: 0, marginBottom: 8, fontSize: 18 },
  cardText: { margin: 0, color: colours.muted },
  list: { margin: 0, paddingLeft: 20, maxWidth: 760 },
  item: { marginBottom: 8 },
  stack: { display: 'grid', gap: 12, margin: 0 },
  stackRow: {
    display: 'grid',
    gridTemplateColumns: { default: '160px 1fr', [NARROW]: '1fr' },
    gap: { default: 16, [NARROW]: 2 },
    paddingBlock: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colours.border,
  },
  term: { fontWeight: 600 },
  definition: { margin: 0, color: colours.muted },
  notice: {
    marginTop: 0,
    marginBottom: 32,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftStyle: 'solid',
    borderLeftColor: colours.warning,
    backgroundColor: colours.surface,
    maxWidth: 720,
  },
  step: { marginBottom: 24 },
  stepText: { marginTop: 0, marginBottom: 8 },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    maxWidth: 1080,
    marginInline: 'auto',
    paddingBlock: 40,
    paddingInline: { default: 40, [NARROW]: 16 },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colours.border,
    color: colours.muted,
    fontSize: 15,
  },
});

/** What the structure of a game buys, each a claim the engine's code holds to. */
const CLAIMS: ReadonlyArray<{ readonly title: string; readonly text: string }> = [
  {
    title: 'One owner for every field',
    text: 'A component says whether the rules or the simulation own it, and whether it is sent to clients, predicted, kept on the client, or kept on the server. A system that writes what it does not own does not compile.',
  },
  {
    title: 'Domains, not a pile of code',
    text: "A game is a list of domains. A domain writes only its own components and changes another's components only by emitting an event that domain declares, so who changes what can be read off the game.",
  },
  {
    title: 'Determinism',
    text: 'Systems take randomness and time only from their context, and a lint rule holds them to it. The same state and the same input give the same next state, which rewinding, recordings, and the check in development rest on.',
  },
  {
    title: 'One shape for one player and many',
    text: "A singleplayer game runs its server in a Web Worker. The same game can be hosted for players across a network in a Durable Object, each player's own entity predicted. That hosting is experimental.",
  },
  {
    title: 'Effects at the edges',
    text: 'Steps and frames are plain synchronous code. Effect runs the hosting, the transports, the services, and the commands a rule issues when it needs something done outside the game, such as saving a score.',
  },
  {
    title: 'Tools for agents',
    text: 'In development, an MCP server lets an agent read the state of the running game, hold and step time, play as one player or several, take screenshots, and turn what it played into a test.',
  },
];

/** What the engine is built on, and what each part does there. */
const PARTS: ReadonlyArray<{ readonly name: string; readonly role: string }> = [
  {
    name: 'Effect 4',
    role: 'Schemas for every component, services and Layers, hosting, and transports.',
  },
  { name: 'Three.js', role: 'The only renderer, on WebGPU, with materials written in TSL.' },
  {
    name: 'Foldkit',
    role: "The DOM: an application's UI, a game's HUD and menus, and the editor.",
  },
  { name: 'Cloudflare', role: 'Durable Objects host rooms over a network. Experimental.' },
  { name: 'Vite+, Alchemy', role: 'Development servers, checks, tests, and deployment.' },
];

/** When another tool fits better. */
const ELSEWHERE: ReadonlyArray<string> = [
  'You need React and the React Three Fiber ecosystem.',
  'You are building a 3D showcase with nothing to simulate; plain Three.js does that.',
  'You need a ready physics engine or high-end graphics; Unity, Godot, or Unreal fit better.',
  'You need thousands of entities today. Performance has not been measured and optimized yet.',
];

/** The commands that take a clone of the repository from nothing to running, each with what it does. */
const START: ReadonlyArray<{ readonly text: string; readonly command: string }> = [
  { text: 'Install, with Node 24.15 or later and npm 12:', command: 'npm install' },
  { text: 'Format, lint, and type-check everything:', command: 'npm run check' },
  { text: 'Run every test:', command: 'npm test' },
  { text: 'Serve one example on its own:', command: 'npm run dev -w @egonitida/example-horde' },
];

/** The home page: the ocean with what EgoNitida is over it, then a game whole, what its structure buys, what it is built on, when to use something else, and how to start. */
export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const external = (href: string, text: string, style: Styled.Style = styles.link) =>
    h.a(
      [h.Href(href), h.Target('_blank'), h.Rel('noreferrer'), ...Styled.attributes(h, style)],
      [text],
    );

  const code = (source: string): Html =>
    h.pre(Styled.attributes(h, styles.code), [h.code([], [source.trimEnd()])]);

  const section = (id: string, title: string, children: ReadonlyArray<Html>): Html =>
    h.section(
      [h.Id(id), h.AriaLabel(title), ...Styled.attributes(h, styles.section)],
      [h.h2(Styled.attributes(h, styles.heading), [title]), ...children],
    );

  const file = (path: string, note: string, source: string): Html =>
    h.div(Styled.attributes(h, styles.file), [
      h.h3(Styled.attributes(h, styles.fileName), [
        external(inRepository(`examples/spinning-cube/src/${path}`), path, styles.inline),
      ]),
      h.p(Styled.attributes(h, styles.fileNote), [note]),
      code(source),
    ]);

  return h.main(Styled.attributes(h, styles.page), [
    h.header(Styled.attributes(h, styles.bar), [
      h.span(Styled.attributes(h, styles.wordmark), ['EgoNitida']),
      h.nav(
        [h.AriaLabel('Main'), ...Styled.attributes(h, styles.links)],
        [
          // The documentation, from whichever page its navigation starts at.
          ...Option.match(firstPageOf(docsSections), {
            onNone: () => [],
            onSome: ({ href }) => [
              h.a([h.Href(href), ...Styled.attributes(h, styles.link, styles.wide)], ['Docs']),
            ],
          }),
          external(`${REPOSITORY}/tree/main/examples`, 'Examples', [styles.link, styles.wide]),
          external(REPOSITORY, 'GitHub'),
          external(DISCORD, 'Discord'),
        ],
      ),
    ]),
    h.div(Styled.attributes(h, styles.hero), [
      // The canvas is in the page while the ocean is joined, and goes with it.
      ...(model.ocean._tag === 'Joined'
        ? [
            h.canvas(
              [
                h.Id(CANVAS_ID),
                h.AriaLabel('An ocean of lights'),
                ...Styled.attributes(h, styles.canvas),
                h.OnMount(MountCanvas()),
              ],
              [],
            ),
          ]
        : []),
      h.div(Styled.attributes(h, styles.heroText), [
        h.h1(Styled.attributes(h, styles.title), ['Build games agents understand.']),
        h.p(Styled.attributes(h, styles.lead), [
          'EgoNitida is an engine for real-time web applications and games. Every component has one owner and every change happens in a step, so a game replays, rewinds, runs on a server, and can be played by an agent.',
        ]),
        h.div(Styled.attributes(h, styles.actions), [
          h.a([h.Href('#start'), ...Styled.attributes(h, styles.primary)], ['Get started']),
          h.a(
            [h.Href(architectureRouter()), ...Styled.attributes(h, styles.secondary)],
            ['Read the architecture'],
          ),
        ]),
        Option.match(model.maybeError, {
          onNone: () =>
            h.p(Styled.attributes(h, styles.caption), [
              'This ocean is a game on the engine, stepped in a worker beside this page. Click a light to send a ripple out from it.',
            ]),
          onSome: (reason) =>
            h.p(Styled.attributes(h, styles.caption, styles.error), [
              `The ocean cannot be shown here: ${reason}`,
            ]),
        }),
      ]),
    ]),
    section('game', 'A game, whole', [
      h.p(Styled.attributes(h, styles.intro), [
        'The smallest game is a cube that turns: one component, one system, one domain, one view, and the story that tests it. These are its files as the repository has them.',
      ]),
      file(
        'cube.ts',
        'The domain. The component says who owns it; the system says what it reads and writes.',
        cube,
      ),
      file(
        'cube.view.ts',
        'The view, in its own module, so a server never imports Three.js.',
        cubeView,
      ),
      file(
        'cube.story.test.ts',
        "The story. It steps the game itself: time is the game's step, so there are no mocks and no fake timers.",
        cubeStory,
      ),
    ]),
    section('structure', 'What the structure buys', [
      h.ul(
        Styled.attributes(h, styles.grid),
        CLAIMS.map(({ title, text }) =>
          h.li(Styled.attributes(h, styles.card), [
            h.h3(Styled.attributes(h, styles.cardTitle), [title]),
            h.p(Styled.attributes(h, styles.cardText), [text]),
          ]),
        ),
      ),
    ]),
    section('built-on', 'Built on', [
      h.div(
        Styled.attributes(h, styles.stack),
        PARTS.map(({ name, role }) =>
          h.div(Styled.attributes(h, styles.stackRow), [
            h.span(Styled.attributes(h, styles.term), [name]),
            h.p(Styled.attributes(h, styles.definition), [role]),
          ]),
        ),
      ),
    ]),
    section('elsewhere', 'When to use something else', [
      h.ul(
        Styled.attributes(h, styles.list),
        ELSEWHERE.map((reason) => h.li(Styled.attributes(h, styles.item), [reason])),
      ),
    ]),
    section('start', 'Get started', [
      h.p(Styled.attributes(h, styles.notice), [
        'EgoNitida is not published yet. It stays private until its architecture is built and Border, the first game on it, runs on it. Names and signatures may still change. Until then, it runs from a clone of the repository.',
      ]),
      ...START.map(({ text, command }) =>
        h.div(Styled.attributes(h, styles.step), [
          h.p(Styled.attributes(h, styles.stepText), [text]),
          code(command),
        ]),
      ),
      h.p(Styled.attributes(h, styles.intro), [
        'Before writing a game, read ',
        external(inRepository('AGENTS.md'), 'AGENTS.md', styles.inline),
        ': the rules for types, state, messages, drawing, and tests, for people as much as for agents.',
      ]),
    ]),
    h.footer(Styled.attributes(h, styles.footer), [
      h.span([], ['EgoNitida is released under the MIT License.']),
      h.nav(
        [h.AriaLabel('Elsewhere'), ...Styled.attributes(h, styles.links)],
        [
          external(REPOSITORY, 'GitHub'),
          external(DISCORD, 'Discord'),
          external(inRepository('LICENSE'), 'License'),
        ],
      ),
    ]),
  ]);
};
