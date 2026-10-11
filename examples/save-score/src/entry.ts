import { BrowserWorker } from '@effect/platform-browser';
import { Clicking, Drawing, Mirror, Tab, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Bridge, Page } from '@lightocean/devtools';
import * as stylex from '@stylexjs/stylex';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Score from '#src/score.ts';
import * as ScoreView from '#src/score.view.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

// The page: joins the local server in a worker, draws the targets at every frame the display shows, sends every click on one as the game's Clicked, and says how the round goes: its hits and time left, then whether its score was saved and the best kept. The targets are mirrored as buttons for the keyboard and a screen reader.

const styles = stylex.create({
  page: {
    position: 'relative',
    height: '100%',
    backgroundColor: colours.ground,
    color: colours.text,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 14,
  },
  canvas: { display: 'block', width: '100%', height: '100%' },
  hud: { position: 'absolute', top: 16, left: 16, display: 'flex', gap: 12, alignItems: 'center' },
  text: { margin: 0 },
  button: {
    paddingBlock: 6,
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: colours.accent,
    color: 'white',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
});

/** An element of `tag`, styled by `style`, added to `parent`. */
const element = <Tag extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: Tag,
  style: stylex.StyleXStyles,
) => {
  const made = document.createElement(tag);
  made.className = stylex.props(style).className ?? '';
  parent.append(made);
  return made;
};

/** How the round goes, as the page says it. */
const toldOf = (round: typeof Score.Round.schema.Type, tick: number, stepRate: number) => {
  switch (round._tag) {
    case 'Playing':
      return `${round.hits} hits · ${Math.max(0, Math.ceil((round.endsAt - tick) / stepRate))} s left`;
    case 'Saving':
      return `${round.hits} hits · saving the score…`;
    case 'Saved':
      return `${round.hits} hits · best ${round.best}`;
    case 'Unsaved':
      return `${round.hits} hits · not saved: ${round.reason}`;
  }
};

/** The id the devtools know this page's host by, kept by the tab across reloads, and given to its worker as its name. */
const host = Tab.id('save-score');

const main = Effect.gen(function* () {
  const page = element(document.body, 'main', styles.page);
  const canvas = element(page, 'canvas', styles.canvas);
  const hud = element(page, 'div', styles.hud);
  const told = element(hud, 'p', styles.text);
  const again = element(hud, 'button', styles.button);
  again.type = 'button';
  again.textContent = 'Play again';

  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Score.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas);
  const views = yield* View.make(ScoreView.views);

  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 6, 4);
  viewport.scene.add(views.root, new Three.AmbientLight(0xffffff, 0.5), sun);
  viewport.camera.position.set(0, 8, 8);
  viewport.camera.lookAt(0, 0, 0);

  yield* Clicking.serve({ clicks: viewport.clicks, camera: viewport.camera, views, client });
  const mirror = yield* Mirror.make({ container: page, views, scene: viewport.scene, client });
  const run = Effect.runForkWith(yield* Effect.context<never>());
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const choose = () => run(client.act(Score.ChoseNewRound, {}));
      again.addEventListener('click', choose);
      return choose;
    }),
    (choose) => Effect.sync(() => again.removeEventListener('click', choose)),
  );
  // In development, an agent asking through the development server can see what this page draws.
  if (import.meta.env.DEV) {
    yield* Option.match(Bridge.vite, {
      onNone: () => Effect.void,
      onSome: (channel) =>
        Page.serve(channel, {
          host,
          capture: (width) => viewport.capture(width).pipe(Effect.mapError(({ reason }) => reason)),
        }),
    });
  }
  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.andThen(views.frame(frame), mirror.frame(frame)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              const round = Option.flatMap(
                Option.fromNullishOr(frame.query(Score.Round)[0]),
                ([, value]) => Option.some(value),
              );
              told.textContent = Option.match(round, {
                onNone: () => '',
                onSome: (value) => toldOf(value, frame.tick, client.stepRate),
              });
              again.hidden = Option.exists(
                round,
                ({ _tag }) => _tag === 'Playing' || _tag === 'Saving',
              );
            }),
          ),
        ),
    }),
  );
  return yield* Effect.never;
}).pipe(
  Effect.provide(
    BrowserWorker.layer(
      () =>
        new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
          name: host,
        }),
    ),
  ),
  Effect.scoped,
);

Effect.runFork(main);
