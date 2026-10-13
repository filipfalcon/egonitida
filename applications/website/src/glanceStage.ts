import { Viewport } from '@lightocean/client';
import { Projection, Stage, Styled, type Session } from '@lightocean/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Effect, Match, Option, Schema, Stream } from 'effect';
import { Command, ManagedResource, Mount, Subscription, type Update } from 'foldkit';
import type { HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import { defineView } from 'foldkit/submodel';
import * as Three from 'three/webgpu';
import * as Glance from '#src/glance.ts';
import * as AnimationControls from '#src/animationControls.ts';
import * as GlanceView from '#src/glance.view.ts';
import * as Stepping from '#src/stepping.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

/**
 * The stage of First Things First: the interactive part of the section First Things First on the page of key terms, above its text. It is the engine's own renderer, drawing the first game, `glance.ts`, hosted in a worker of its own, on a canvas in the page, and it tells, line by line, how that game begins, as far as the game has come.
 */

// MODEL

/** The panes the game is shown in: the stage itself, and the pane each term the telling introduces is shown in, a camera of its own on the same game. */
export const Pane = Schema.Literals(['Stage', 'State', 'Entity', 'Component', 'Step']);
export type Pane = typeof Pane.Type;

/** The stage itself: its session being joined, joined with the panes whose canvases are in the page, or not to be shown, and why. */
export const StageState = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { mounted: Schema.Array(Pane) }),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
]);
export type StageState = typeof StageState.Type;

/** The stage; where the telling of its game is, once the game has said; the state's tick, while the telling counts the ticks; and whether the game's time runs or the viewer stopped it. */
export const Model = Schema.Struct({
  stage: StageState,
  maybeMoment: Schema.Option(Glance.Moment),
  maybeTick: Schema.Option(Schema.Int),
  time: Schema.Literals(['Running', 'Suspended']),
});
export type Model = typeof Model.Type;

/** The stage as the page opens: joining its game, with nothing told. */
export const initialModel: Model = {
  stage: { _tag: 'Joining' },
  maybeMoment: Option.none(),
  maybeTick: Option.none(),
  time: 'Running',
};

// MESSAGE

/** What happens to the stage: its game joined, left, or not joined; its canvas in the page; the game not to be shown on it; where the telling of the game has come to, and its tick while the telling counts it; and the controls the viewer pressed, and what came of them. */
export const Message = defineMessageUnion({
  JoinedGame: {},
  LeftGame: {},
  FailedJoinGame: { reason: Schema.String },
  MountedCanvas: { pane: Pane },
  FailedShowState: { reason: Schema.String },
  ProjectedTelling: { moment: Glance.Moment, maybeTick: Schema.Option(Schema.Int) },
  PressedPlay: {},
  PressedBack: {},
  PressedStop: {},
  PressedStart: {},
  PressedNext: {},
  ControlledGame: {},
  FailedControlGame: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The first game's session, joined while the page of key terms is open. */
export const GlanceSession = ManagedResource.tag<Session.Joined>()('GlanceSession');

/** What the stage's Subscriptions reach: its session. */
export type Services = ManagedResource.ServiceOf<typeof GlanceSession>;

/** Says when the canvas of `pane` is in the page, so the game can be shown on it. */
export const MountCanvas = Mount.define('MountGlanceCanvas', {
  args: { pane: Pane },
  messages: [Message.MountedCanvas],
  execute: ({ pane }) => Effect.succeed(Message.MountedCanvas({ pane })),
});

// COMMANDS

const notJoined = ({ resource }: { readonly resource: string }) =>
  Effect.succeed(Message.FailedControlGame({ reason: `The session ${resource} is not joined.` }));

/** Stops the game's time for the viewer. */
export const SuspendTime = Command.define('SuspendTime', {
  messages: [Message.ControlledGame, Message.FailedControlGame],
  execute: GlanceSession.get.pipe(
    Effect.flatMap(({ client }) => client.suspend),
    Effect.as(Message.ControlledGame()),
    Effect.catch(notJoined),
  ),
});

/** Lets the game's time run again. */
export const ResumeTime = Command.define('ResumeTime', {
  messages: [Message.ControlledGame, Message.FailedControlGame],
  execute: GlanceSession.get.pipe(
    Effect.flatMap(({ client }) => client.resume),
    Effect.as(Message.ControlledGame()),
    Effect.catch(notJoined),
  ),
});

/** Starts the telling, or chooses the beat before or after, as the viewer; while the game's time is suspended, it takes one step, so the game takes the choice in. */
export const ChooseBeat = Command.define('ChooseBeat', {
  args: { choice: Schema.Literals(['Start', 'Back', 'Next']), isSuspended: Schema.Boolean },
  messages: [Message.ControlledGame, Message.FailedControlGame],
  execute: ({ choice, isSuspended }) =>
    GlanceSession.get.pipe(
      Effect.flatMap(({ client }) =>
        Effect.andThen(
          Match.value(choice).pipe(
            Match.when('Start', () => client.act(Glance.ChoseStart, {})),
            Match.when('Back', () => client.act(Glance.ChoseBack, {})),
            Match.when('Next', () => client.act(Glance.ChoseNext, {})),
            Match.exhaustive,
          ),
          isSuspended ? Stepping.step(client) : Effect.void,
        ),
      ),
      Effect.as(Message.ControlledGame()),
      Effect.catch(notJoined),
    ),
});

// TELLING

/** The line the stage tells at `moment`, in phrases: a phrase to a line while it is set over the whole stage, run on once it keeps to the stage's foot. */
export const phrasesOf = (moment: Glance.Moment): ReadonlyArray<string> =>
  Match.value(moment).pipe(
    Match.whenOr('Waiting', 'Nothing', () => ['At first', 'there is', 'nothing.']),
    Match.when('Ideas', () => ['Then the ideas', 'start coming.']),
    Match.when('State', () => ['Finally,', 'a state', 'emerges.']),
    Match.when('Entities', () => ['Entities', 'emerge.']),
    Match.when('Components', () => ['Components', 'give them form.']),
    Match.when('Step', () => ['Time starts', 'stepping.']),
    Match.exhaustive,
  );

const lineAt = (moment: Glance.Moment): string => phrasesOf(moment).join(' ');

/** A term the telling introduces, and how it is shown: in a pane of its own, a camera on the game, or, for a tick, as the state's count of them. */
export interface Concept {
  readonly term: string;
  readonly shown: Option.Option<Pane>;
}

/** Every term the telling introduces, each with the beat that introduces it, in order. */
const CONCEPTS: ReadonlyArray<Concept & { readonly beat: Glance.Moment }> = [
  { beat: 'State', term: 'State', shown: Option.some('State') },
  { beat: 'Entities', term: 'Entity', shown: Option.some('Entity') },
  { beat: 'Components', term: 'Component', shown: Option.some('Component') },
  { beat: 'Step', term: 'Step', shown: Option.some('Step') },
  { beat: 'Step', term: 'Tick', shown: Option.none() },
];

/** The terms the telling has introduced by `moment`, in the order it introduced them. */
export const conceptsOf = (moment: Glance.Moment): ReadonlyArray<Concept> =>
  CONCEPTS.filter(({ beat }) => Glance.hasCome(moment, beat)).map(({ term, shown }) => ({
    term,
    shown,
  }));

/** Whether the telling waits for the viewer to start it. */
export const isWaiting = (model: Model): boolean => Option.contains(model.maybeMoment, 'Waiting');

/** The line the stage tells now, once its game has said where the telling is. */
export const lineOf = (model: Model): Option.Option<string> =>
  Option.map(model.maybeMoment, lineAt);

// UPDATE

const withStage = (model: Model, stage: StageState): Model =>
  modifyFields(model, { stage: () => stage });

type Return = Update.Return<Model, Message, Services>;

const isJoined = (model: Model) => model.stage._tag === 'Joined';

/** The stage after `message`. */
export const update = (model: Model, message: Message): Return =>
  Message.match<Return>(message, {
    // Joined again while the Model already says so, as one restored after a reload does, the canvas in the page stays as it is.
    JoinedGame: () => ({
      model:
        model.stage._tag === 'Joined' ? model : withStage(model, { _tag: 'Joined', mounted: [] }),
    }),
    // The canvas goes with the session, so a session joined again waits for its own canvas.
    LeftGame: () => ({ model: withStage(model, { _tag: 'Joining' }) }),
    FailedJoinGame: ({ reason }) => ({ model: withStage(model, { _tag: 'Failed', reason }) }),
    MountedCanvas: ({ pane }) => ({
      model:
        model.stage._tag === 'Joined' && !model.stage.mounted.includes(pane)
          ? withStage(model, { _tag: 'Joined', mounted: [...model.stage.mounted, pane] })
          : model,
    }),
    FailedShowState: ({ reason }) => ({ model: withStage(model, { _tag: 'Failed', reason }) }),
    ProjectedTelling: ({ moment, maybeTick }) => ({
      model: modifyFields(model, {
        maybeMoment: () => Option.some(moment),
        maybeTick: () => maybeTick,
      }),
    }),
    // The controls act on the game only once it is joined.
    PressedPlay: () =>
      isJoined(model)
        ? {
            model,
            commands: [ChooseBeat({ choice: 'Start', isSuspended: model.time === 'Suspended' })],
          }
        : { model },
    PressedBack: () =>
      isJoined(model)
        ? {
            model,
            commands: [ChooseBeat({ choice: 'Back', isSuspended: model.time === 'Suspended' })],
          }
        : { model },
    PressedNext: () =>
      isJoined(model)
        ? {
            model,
            commands: [ChooseBeat({ choice: 'Next', isSuspended: model.time === 'Suspended' })],
          }
        : { model },
    PressedStop: () =>
      isJoined(model)
        ? {
            model: modifyFields(model, { time: () => 'Suspended' as const }),
            commands: [SuspendTime()],
          }
        : { model },
    PressedStart: () =>
      isJoined(model)
        ? {
            model: modifyFields(model, { time: () => 'Running' as const }),
            commands: [ResumeTime()],
          }
        : { model },
    ControlledGame: () => ({ model }),
    FailedControlGame: () => ({ model }),
  });

// SUBSCRIPTIONS

/** The id of the canvas each pane shows the game on. */
const canvasIdOf = (pane: Pane): string =>
  pane === 'Stage' ? 'glance' : `glance-${pane.toLowerCase()}`;

/** The views each pane draws the game with: the stage's own, and each term's. */
const viewsOf = (pane: Pane) =>
  Match.value(pane).pipe(
    Match.when('Stage', () => GlanceView.views),
    Match.when('State', () => GlanceView.stateViews),
    Match.when('Entity', () => GlanceView.entityViews),
    Match.when('Component', () => GlanceView.componentViews),
    Match.when('Step', () => GlanceView.stepViews),
    Match.exhaustive,
  );

/** A camera looking at where the state emerges, and a soft light over it. */
const setUp = ({
  scene,
  camera,
}: {
  readonly scene: Three.Scene;
  readonly camera: Three.Camera;
}) => {
  const sun = new Three.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-3, 5, 6);
  scene.add(new Three.AmbientLight(0xbcd7ff, 0.35), sun);
  camera.position.set(0, 1.2, 7);
  camera.lookAt(0, 0, 0);
};

/** The game shown in `pane`, while it is joined and the pane's canvas is in the page. */
const paneEntry = (
  entry: Parameters<
    Parameters<ReturnType<typeof Subscription.make<Model, Message, Services>>>[0]
  >[0],
  pane: Pane,
) =>
  entry(
    { isShown: Schema.Boolean },
    {
      modelToDependencies: ({ stage }: Model) => ({
        isShown: stage._tag === 'Joined' && stage.mounted.includes(pane),
      }),
      dependenciesToStream: ({ isShown }: { readonly isShown: boolean }) =>
        isShown
          ? Stage.stream({
              resource: GlanceSession,
              canvasId: canvasIdOf(pane),
              views: viewsOf(pane),
              viewport: Viewport.sharp,
              setup: setUp,
              onNotJoined: (): Message => Message.LeftGame(),
              onFailed: (reason) => Message.FailedShowState({ reason }),
            })
          : Stream.empty,
    },
  );

/** What the stage reads off its game's state: where the telling is, and the state's tick while the telling counts the ticks, so it is told again every step only then. */
const Told = Schema.Struct({ moment: Glance.Moment, maybeTick: Schema.Option(Schema.Int) });

const toldOf = (state: Parameters<typeof Glance.momentOf>[0]): typeof Told.Type => {
  const moment = Glance.momentOf(state);
  return {
    moment,
    maybeTick: Glance.hasCome(moment, 'Step') ? Option.some(state.tick) : Option.none(),
  };
};

/** The game shown on the canvas, while it is joined and the canvas is in the page; and where the telling of the game is, while it is joined. */
export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  glanceStage: paneEntry(entry, 'Stage'),
  glanceStatePane: paneEntry(entry, 'State'),
  glanceEntityPane: paneEntry(entry, 'Entity'),
  glanceComponentPane: paneEntry(entry, 'Component'),
  glanceStepPane: paneEntry(entry, 'Step'),
  glanceMoment: entry(
    { isJoined: Schema.Boolean },
    {
      modelToDependencies: ({ stage }) => ({ isJoined: stage._tag === 'Joined' }),
      dependenciesToStream: ({ isJoined }) =>
        isJoined
          ? Projection.stream({
              resource: GlanceSession,
              schema: Told,
              project: toldOf,
              onProjected: ({ moment, maybeTick }): Message =>
                Message.ProjectedTelling({ moment, maybeTick }),
              onNotJoined: (): Message => Message.LeftGame(),
            })
          : Stream.empty,
    },
  ),
}));

// VIEW

const appear = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const NARROW = '@media (max-width: 720px)';

const styles = stylex.create({
  // The stage, its table of terms, and its controls are one card: the picture and the table side by side, or the table under the picture on a narrow screen, and the controls in a strip of their own under both.
  card: {
    marginTop: 8,
    marginBottom: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 10,
    backgroundColor: colours.code,
  },
  // Until the telling introduces its first term, the picture has the whole card; then the table opens beside it, or under it on a narrow screen.
  body: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) 0%', [NARROW]: 'minmax(0, 1fr)' },
    gridTemplateRows: { default: 'minmax(0, 1fr)', [NARROW]: 'auto 0fr' },
    aspectRatio: { default: '16 / 9', [NARROW]: 'auto' },
    transitionProperty: 'grid-template-columns, grid-template-rows',
    transitionDuration: { default: '1.1s', '@media (prefers-reduced-motion: reduce)': '0s' },
    transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
  },
  opened: {
    gridTemplateColumns: { default: 'minmax(0, 1fr) 30%', [NARROW]: 'minmax(0, 1fr)' },
    gridTemplateRows: { default: 'minmax(0, 1fr)', [NARROW]: 'auto 1fr' },
  },
  // Its lines are sized by its own width, so they fill it on a phone as on a wide screen.
  stage: {
    position: 'relative',
    minHeight: 0,
    backgroundColor: colours.code,
    // The dark gives way to the state's own ground as the bang spreads.
    transitionProperty: 'background-color',
    transitionDuration: { default: '1.6s', '@media (prefers-reduced-motion: reduce)': '0s' },
    transitionDelay: { default: '0.5s', '@media (prefers-reduced-motion: reduce)': '0s' },
    transitionTimingFunction: 'ease-out',
    aspectRatio: { default: 'auto', [NARROW]: '1 / 1' },
    containerType: 'inline-size',
  },
  // Before the state emerges, there is only dark.
  dark: { backgroundColor: colours.void, transitionDelay: '0s', transitionDuration: '0.4s' },
  canvas: { display: 'block', width: '100%', height: '100%' },
  // Every line fills the stage, a phrase to a line, sized by the stage's own width.
  line: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '0.18em',
    margin: 0,
    paddingInline: '5cqw',
    color: colours.text,
    fontFamily: 'Unbounded, system-ui, sans-serif',
    fontSize: { default: '8cqw', [NARROW]: '11cqw' },
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '0.01em',
    textTransform: 'uppercase',
    textShadow: `0 0 24px ${colours.accent}`,
    textAlign: 'center',
    pointerEvents: 'none',
    animationName: {
      default: appear,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: '1.2s',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  // Once there is something to see, a line keeps to the band along the stage's foot, its phrases running on, so the state stands clear above it.
  atFoot: { top: 'auto', display: 'block', paddingBottom: '5cqw' },
  phrase: { display: 'block' },
  phraseRunning: { display: 'inline' },
  // The state's tick, while the telling counts the ticks: in the stage's corner, in the telling's own type.
  counter: {
    position: 'absolute',
    top: '4cqw',
    left: '4cqw',
    margin: 0,
    color: colours.accent,
    fontFamily: 'Unbounded, system-ui, sans-serif',
    fontSize: { default: '4cqw', [NARROW]: '6cqw' },
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.08em',
    textShadow: `0 0 18px ${colours.accent}`,
    pointerEvents: 'none',
  },
  table: {
    minWidth: 0,
    minHeight: 0,
    margin: 0,
    overflow: 'hidden',
    borderStyle: 'solid',
    borderColor: colours.border,
    borderWidth: 0,
  },
  tableOpened: {
    borderLeftWidth: { default: 1, [NARROW]: 0 },
    borderTopWidth: { default: 0, [NARROW]: 1 },
  },
  // A pane to a term, one under another, sharing the table's height; a tick takes only the row its count needs.
  tableInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: 10,
  },
  concept: {
    position: 'relative',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: { default: 0, [NARROW]: 'auto' },
    height: { default: 'auto', [NARROW]: 150 },
    minHeight: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 8,
    backgroundColor: colours.page,
    animationName: {
      default: appear,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: '0.8s',
    // After the table has begun to open.
    animationDelay: '0.35s',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  newest: { borderColor: colours.accent },
  counted: {
    flexGrow: 0,
    flexShrink: 0,
    height: 'auto',
    paddingTop: 26,
    paddingBottom: 10,
    paddingInline: 10,
  },
  term: {
    position: 'absolute',
    top: 7,
    left: 9,
    zIndex: 1,
    margin: 0,
    color: colours.text,
    fontFamily: 'Unbounded, system-ui, sans-serif',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    pointerEvents: 'none',
  },
  pane: { display: 'block', width: '100%', height: '100%' },
  // A tick as the state counts it: a mark for each of the last steps, a long one every second, the newest lit, and the count in the row's corner.
  ruler: { display: 'flex', alignItems: 'flex-end' },
  marks: { display: 'flex', alignItems: 'flex-end', gap: 2, flexGrow: 1, height: 22 },
  mark: { flexGrow: 1, height: 9, borderRadius: 1, backgroundColor: colours.border },
  longMark: { height: 16 },
  nowMark: { height: 22, backgroundColor: colours.accent },
  count: {
    position: 'absolute',
    top: 5,
    right: 9,
    color: colours.accent,
    fontFamily: 'Unbounded, system-ui, sans-serif',
    fontSize: 11,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  note: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    margin: 0,
    padding: 16,
    color: colours.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});

/** Whether there is something to see at `moment`, so its line keeps to the stage's foot, clear of it. */
const isAtFoot = (moment: Glance.Moment) => Glance.hasCome(moment, 'Ideas');

/** Whether a state has emerged, so the stage is no longer dark. */
const hasBegun = (model: Model) =>
  Option.exists(model.maybeMoment, (moment) => Glance.hasCome(moment, 'State'));

/** Whether the telling has introduced any term, so its table is open. */
const hasTerms = (model: Model) =>
  Option.exists(model.maybeMoment, (moment) => conceptsOf(moment).length > 0);

/** How many of the last steps the tick's ruler marks. */
const MARKS = 24;

/** The canvas `pane` shows the game on, saying when it is in the page. */
const canvasOf = (pane: Pane, label: string, h: HtmlBuilder<Message>, style: Styled.Style) =>
  h.canvas(
    [
      h.Id(canvasIdOf(pane)),
      h.AriaLabel(label),
      ...Styled.attributes(h, style),
      h.OnMount(MountCanvas({ pane })),
    ],
    [],
  );

/** The ruler a tick is shown on: the last steps marked, the newest lit, and the state's count of them. */
const rulerOf = (tick: number, h: HtmlBuilder<Message>) =>
  h.div(Styled.attributes(h, styles.ruler), [
    h.div(
      [h.AriaHidden(true), ...Styled.attributes(h, styles.marks)],
      Array.from({ length: MARKS }, (_, index) => {
        const marked = tick - (MARKS - 1 - index);
        return h.span(
          Styled.attributes(
            h,
            styles.mark,
            marked % Glance.game.stepRate === 0 && styles.longMark,
            index === MARKS - 1 && styles.nowMark,
          ),
          [],
        );
      }),
    ),
    h.span(
      [h.AriaLabel(`Tick ${tick}`), ...Styled.attributes(h, styles.count)],
      [String(tick).padStart(4, '0')],
    ),
  ]);

/** The table of the terms the telling has introduced, each shown, not told: a pane to a term, a camera of its own on the game, or, for a tick, the state's count of them; the newest marked, and closed until the first. */
const tableOf = (model: Model, h: HtmlBuilder<Message>) => {
  const concepts = Option.match(model.maybeMoment, { onNone: () => [], onSome: conceptsOf });
  return h.aside(
    [
      h.AriaLabel('Terms introduced'),
      h.AriaHidden(concepts.length === 0),
      ...Styled.attributes(h, styles.table, concepts.length > 0 && styles.tableOpened),
    ],
    [
      h.div(
        Styled.attributes(h, styles.tableInner),
        concepts.map(({ term, shown }, index) =>
          h.keyed('section')(
            term,
            [
              h.AriaLabel(term),
              ...Styled.attributes(
                h,
                styles.concept,
                index === concepts.length - 1 && styles.newest,
                Option.isNone(shown) && styles.counted,
              ),
            ],
            [
              h.h3(Styled.attributes(h, styles.term), [term]),
              ...Option.match(shown, {
                onSome: (pane) =>
                  model.stage._tag === 'Joined'
                    ? [canvasOf(pane, `${term}, drawn by the engine`, h, styles.pane)]
                    : [],
                onNone: () =>
                  Option.match(model.maybeTick, {
                    onNone: () => [],
                    onSome: (tick) => [rulerOf(tick, h)],
                  }),
              }),
            ],
          ),
        ),
      ),
    ],
  );
};

/** The stage: the canvas while the game is joined, with the line it tells over it and the tick it counts; the table of the terms it has introduced beside it; and the controls in a strip under both; and what is wrong while it cannot be shown. */
export const view = defineView<Model, Message>((model, h) =>
  h.div(Styled.attributes(h, styles.card), [
    h.div(Styled.attributes(h, styles.body, hasTerms(model) && styles.opened), [
      h.div(Styled.attributes(h, styles.stage, !hasBegun(model) && styles.dark), [
        ...(model.stage._tag === 'Joined'
          ? [canvasOf('Stage', 'The first game, drawn by the engine', h, styles.canvas)]
          : []),
        // Each line is an element of its own, so a new line appears as it is told, and the same line stays as it is.
        ...Option.match(Option.all([model.maybeMoment, lineOf(model)]), {
          onNone: () => [],
          onSome: ([moment, line]) => [
            h.keyed('p')(
              line,
              [
                h.AriaLive('polite'),
                h.AriaLabel(line),
                ...Styled.attributes(h, styles.line, isAtFoot(moment) && styles.atFoot),
              ],
              phrasesOf(moment).map((phrase) =>
                h.span(
                  [
                    h.AriaHidden(true),
                    ...Styled.attributes(
                      h,
                      isAtFoot(moment) ? styles.phraseRunning : styles.phrase,
                    ),
                  ],
                  [isAtFoot(moment) ? `${phrase} ` : phrase],
                ),
              ),
            ),
          ],
        }),
        ...Option.match(model.maybeTick, {
          onNone: () => [],
          onSome: (tick) => [
            h.p(
              [h.AriaLabel(`Tick ${tick}`), ...Styled.attributes(h, styles.counter)],
              [String(tick).padStart(4, '0')],
            ),
          ],
        }),
        ...(model.stage._tag === 'Failed'
          ? [
              h.p(Styled.attributes(h, styles.note), [
                `The game cannot be shown here: ${model.stage.reason}`,
              ]),
            ]
          : []),
      ]),
      tableOf(model, h),
    ]),
    ...(model.stage._tag === 'Joined'
      ? [
          AnimationControls.view(h, {
            // While the telling waits, the middle control plays it.
            isRunning: !isWaiting(model) && model.time === 'Running',
            back: Message.PressedBack(),
            stop: Message.PressedStop(),
            start: isWaiting(model) ? Message.PressedPlay() : Message.PressedStart(),
            next: Message.PressedNext(),
          }),
        ]
      : []),
  ]),
);
