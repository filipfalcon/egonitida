import { Tab, Viewport } from '@lightocean/client';
import { Pointing, State } from '@lightocean/core';
import { Projection, Session, Stage } from '@lightocean/foldkit';
import { Bridge, Inspect, Log, Page } from '@lightocean/devtools';
import { Effect, Option, Schedule, Schema, Stream } from 'effect';
import { ManagedResource, Mount, Subscription } from 'foldkit';
import * as Three from 'three/webgpu';
import * as Editing from '#src/editing.ts';
import * as EditingView from '#src/editing.view.ts';
import {
  Document,
  Message,
  type Model,
  OutlineEntry,
  Played,
  Selected,
  type Services,
} from '#src/main.ts';
import * as Objects from '#src/objects.ts';
import * as ObjectsView from '#src/objects.view.ts';
import * as Playing from '#src/playing.ts';

// Where the document meets the page: joined in a worker while the editor is open, shown on the canvas once Foldkit has it in the page, and read for the outliner and the panels of what is selected. While it plays, a second worker plays it, and the canvas shows that game instead.

/** The id the devtools know the editor's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the document kept for the tab. */
const host = Tab.id('editor');

/** The id of the canvas the document is shown on. */
export const CANVAS_ID = 'viewport';

/** In development, the canvas `viewport` draws on, captured for an agent asking through the development server as the page drawing `host`, so it sees what a person would. */
const capturedAs = (host: string) => (viewport: Viewport.Viewport) =>
  import.meta.env.DEV
    ? Option.match(Bridge.vite, {
        onNone: () => Effect.void,
        onSome: (channel) =>
          Page.serve(channel, {
            host,
            capture: (width) =>
              viewport.capture(width).pipe(Effect.mapError(({ reason }) => reason)),
          }),
      })
    : Effect.void;

/** The document, joined while the editor is open, and the document playing, opened with the document as it was, while it plays. */
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  document: entry(
    Session.Requirements,
    Session.managed<Model, Message, Services>({
      resource: Document,
      game: Editing.game,
      worker: () =>
        new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
          name: host,
        }),
      joins: () => true,
      onJoined: () => Message.JoinedDocument(),
      onLeft: () => Message.LeftDocument(),
      onFailed: (reason) => Message.FailedJoinDocument({ reason }),
    }),
  ),
  played: entry(
    Session.Opening,
    Session.opened<Model, Message, Services>({
      resource: Played,
      game: Playing.game,
      worker: () =>
        new Worker(new URL('./play.worker.ts', import.meta.url), {
          type: 'module',
          name: `${host}-playing`,
        }),
      opens: ({ play }) => (play._tag === 'Playing' ? Option.some(play.opening) : Option.none()),
      onJoined: () => Message.JoinedPlay(),
      onLeft: () => Message.LeftPlay(),
      onFailed: (reason) => Message.FailedJoinPlay({ reason }),
    }),
  ),
}));

/** Says when the canvas is in the page, so the document can be shown on it. */
export const MountCanvas = Mount.define('MountCanvas', {
  messages: [Message.MountedCanvas],
  execute: () => Effect.succeed(Message.MountedCanvas()),
});

/** A camera looking down over the document, and the light its objects are seen by. */
const setUp = ({
  scene,
  camera,
}: {
  readonly scene: Three.Scene;
  readonly camera: Three.Camera;
}) => {
  const sun = new Three.DirectionalLight(0xffffff, 2.5);
  sun.position.set(5, 8, 6);
  scene.add(new Three.AmbientLight(0xffffff, 0.4), sun);
  camera.position.set(0, 4, 10);
  camera.rotation.set(-0.35, 0, 0);
};

/** Every object in the document, as the outliner lists it, in the order they were made. */
const outlineOf = (state: State.State): ReadonlyArray<OutlineEntry> =>
  State.entitiesHolding(state, [Objects.Shape]).flatMap((entity) =>
    Option.toArray(
      Option.all({
        shape: State.get(state, entity, Objects.Shape),
        label: State.get(state, entity, Pointing.Label),
        behaviour: State.get(state, entity, Objects.Behaviour),
      }).pipe(
        Option.map(({ shape, label, behaviour }) => ({
          entity,
          name: label.text,
          kind: shape.kind,
          reacts: behaviour.reactions.length > 0,
        })),
      ),
    ),
  );

/** The object `editor` has selected, as the panels show it, if they have one. */
const selectedBy = (state: State.State, editor: State.Entity): Option.Option<Selected> =>
  Option.flatMap(
    Option.flatMap(State.get(state, editor, Editing.Selection), ({ selected }) => selected),
    (entity) =>
      Option.map(
        Option.all({
          label: State.get(state, entity, Pointing.Label),
          shape: State.get(state, entity, Objects.Shape),
          transform: State.get(state, entity, Objects.Transform),
          colour: State.get(state, entity, Objects.Colour),
          spin: State.get(state, entity, Objects.Spin),
          behaviour: State.get(state, entity, Objects.Behaviour),
        }),
        ({ label, behaviour, ...rest }) => ({
          entity,
          name: label.text,
          reactions: behaviour.reactions,
          ...rest,
        }),
      ),
  );

/** What the canvas shows: nothing until it and the document are there, then the document being edited, or the document playing once its session is joined. */
const shownBy = (model: Model): 'Nothing' | 'Editing' | 'Playing' => {
  if (model.document._tag !== 'Joined' || model.document.canvas !== 'Mounted') {
    return 'Nothing';
  }
  if (model.play._tag === 'Editing') {
    return 'Editing';
  }
  return model.play.session === 'Joined' ? 'Playing' : 'Nothing';
};

/** The ticks the debugger of the document playing keeps. */
const Span = Schema.Struct({ oldest: Schema.Int, newest: Schema.Int });

/** How often the debugger is asked what happened. */
const ASKED_EVERY = '500 millis';

/** The steps of the document playing in which something happened, as its debugger tells them, whenever they change. */
const stepsTold: Stream.Stream<Message, never, Services> = Stream.unwrap(
  Played.get.pipe(
    Effect.map(({ client }) =>
      Stream.fromSchedule(Schedule.spaced(ASKED_EVERY)).pipe(
        Stream.mapEffect(() =>
          Inspect.ask(client, { _tag: 'Span' }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Span)),
            Effect.flatMap(({ oldest, newest }) =>
              Inspect.steps(client, { from: oldest, to: newest }),
            ),
            Effect.option,
          ),
        ),
        // What the debugger could not tell this time is asked again next time.
        Stream.flatMap((told) => Stream.fromIterable(Option.toArray(told))),
        Stream.changesWith(Schema.toEquivalence(Schema.Array(Log.Step))),
        Stream.map((steps): Message => Message.ToldSteps({ steps })),
      ),
    ),
    // Not joined, though the Model says it is, as one restored after a reload does: the Model is put right, and the steps asked again once it is joined.
    Effect.orElseSucceed(() =>
      Stream.make(Message.LeftPlay()).pipe(Stream.map((left): Message => left)),
    ),
  ),
);

/** The canvas showing the document or the document playing, the steps the debugger tells, and what the outliner and the panels show of the document. */
export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  // The canvas shows the document being edited, with what is selected outlined, or the document playing, once its session is joined.
  stage: entry(
    { shown: Schema.Literals(['Nothing', 'Editing', 'Playing']) },
    {
      modelToDependencies: (model) => ({ shown: shownBy(model) }),
      dependenciesToStream: ({ shown }) => {
        switch (shown) {
          case 'Nothing':
            return Stream.empty;
          case 'Editing':
            return Stage.stream({
              resource: Document,
              canvasId: CANVAS_ID,
              views: [...ObjectsView.views, ...EditingView.views],
              viewport: Viewport.sharp,
              setup: setUp,
              alongside: capturedAs(host),
              onNotJoined: (): Message => Message.LeftDocument(),
              onFailed: (reason) => Message.FailedShowDocument({ reason }),
            });
          case 'Playing':
            return Stage.stream({
              resource: Played,
              canvasId: CANVAS_ID,
              views: ObjectsView.views,
              viewport: Viewport.sharp,
              setup: setUp,
              alongside: capturedAs(`${host}-playing`),
              onNotJoined: (): Message => Message.LeftPlay(),
              onFailed: (reason) => Message.FailedShowDocument({ reason }),
            });
        }
      },
    },
  ),
  steps: entry(
    { isPlayJoined: Schema.Boolean },
    {
      modelToDependencies: ({ play }) => ({
        isPlayJoined: play._tag === 'Playing' && play.session === 'Joined',
      }),
      dependenciesToStream: ({ isPlayJoined }) => (isPlayJoined ? stepsTold : Stream.empty),
    },
  ),
  outline: entry(
    { isDocumentJoined: Schema.Boolean },
    {
      modelToDependencies: ({ document }) => ({ isDocumentJoined: document._tag === 'Joined' }),
      dependenciesToStream: ({ isDocumentJoined }) =>
        isDocumentJoined
          ? Projection.stream({
              resource: Document,
              schema: Schema.Array(OutlineEntry),
              project: outlineOf,
              onProjected: (objects) => Message.ProjectedOutline({ objects }),
              onNotJoined: (): Message => Message.LeftDocument(),
            })
          : Stream.empty,
    },
  ),
  selection: entry(
    { isDocumentJoined: Schema.Boolean },
    {
      modelToDependencies: ({ document }) => ({ isDocumentJoined: document._tag === 'Joined' }),
      dependenciesToStream: ({ isDocumentJoined }) =>
        isDocumentJoined
          ? Projection.stream({
              resource: Document,
              schema: Schema.Option(Selected),
              project: selectedBy,
              onProjected: (maybeSelected) => Message.ProjectedSelection({ maybeSelected }),
              onNotJoined: (): Message => Message.LeftDocument(),
            })
          : Stream.empty,
    },
  ),
  // While the Model says the document, or the game playing it, is not joined, it may already be: joined a moment before the stage found it was not.
  documentJoining: entry(
    { isJoining: Schema.Boolean },
    {
      modelToDependencies: ({ document }) => ({ isJoining: document._tag === 'Joining' }),
      dependenciesToStream: ({ isJoining }) =>
        isJoining
          ? Session.whenJoined({
              resource: Document,
              onJoined: (): Message => Message.FoundDocumentJoined(),
            })
          : Stream.empty,
    },
  ),
  playJoining: entry(
    { isJoining: Schema.Boolean },
    {
      modelToDependencies: ({ play }) => ({
        isJoining: play._tag === 'Playing' && play.session === 'Opening',
      }),
      dependenciesToStream: ({ isJoining }) =>
        isJoining
          ? Session.whenJoined({
              resource: Played,
              onJoined: (): Message => Message.FoundPlayJoined(),
            })
          : Stream.empty,
    },
  ),
}));
