import { Tab } from '@lightocean/client';
import { Pointing, World as Worlds } from '@lightocean/core';
import { Projection, Stage, World } from '@lightocean/foldkit';
import { Inspect, Log } from '@lightocean/devtools';
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

// Where the document meets the page: joined in a worker while the editor is open, shown on the canvas once Foldkit has it in the page, and read for the outliner and the panels of what is selected. While it plays, a second worker plays it, and the canvas shows that world instead.

/** The id the devtools know the editor's host by, kept by the tab across reloads, and given to its worker as its name, so the worker finds the document kept for the tab. */
const host = Tab.id('editor');

/** The id of the canvas the document is shown on. */
export const CANVAS_ID = 'viewport';

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  document: entry(
    World.Requirements,
    World.managed<Model, Message, Services>({
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
    World.Opening,
    World.opened<Model, Message, Services>({
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
const outlineOf = (world: Worlds.World): ReadonlyArray<OutlineEntry> =>
  Worlds.holding(world, [Objects.Shape]).flatMap((entity) =>
    Option.toArray(
      Option.all({
        shape: Worlds.get(world, entity, Objects.Shape),
        label: Worlds.get(world, entity, Pointing.Label),
        behaviour: Worlds.get(world, entity, Objects.Behaviour),
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
const selectedBy = (world: Worlds.World, editor: Worlds.Entity): Option.Option<Selected> =>
  Option.flatMap(
    Option.flatMap(Worlds.get(world, editor, Editing.Selection), ({ selected }) => selected),
    (entity) =>
      Option.map(
        Option.all({
          label: Worlds.get(world, entity, Pointing.Label),
          shape: Worlds.get(world, entity, Objects.Shape),
          transform: Worlds.get(world, entity, Objects.Transform),
          colour: Worlds.get(world, entity, Objects.Colour),
          spin: Worlds.get(world, entity, Objects.Spin),
          behaviour: Worlds.get(world, entity, Objects.Behaviour),
        }),
        ({ label, behaviour, ...rest }) => ({
          entity,
          name: label.text,
          reactions: behaviour.reactions,
          ...rest,
        }),
      ),
  );

/** What the canvas shows: nothing until it and the document are there, then the document being edited, or the document playing once its world is joined. */
const shownBy = (model: Model): 'Nothing' | 'Editing' | 'Playing' => {
  if (model.document._tag !== 'Joined' || model.document.canvas !== 'Mounted') {
    return 'Nothing';
  }
  if (model.play._tag === 'Editing') {
    return 'Editing';
  }
  return model.play.world === 'Joined' ? 'Playing' : 'Nothing';
};

/** The ticks the debugger of the document playing keeps. */
const Span = Schema.Struct({ oldest: Schema.Int, newest: Schema.Int });

/** How often the debugger is asked what happened. */
const ASKED_EVERY = '500 millis';

/** The steps of the document playing in which something happened, as its debugger tells them, whenever they change. */
const stepsTold = Stream.unwrap(
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
        Stream.map((steps) => Message.ToldSteps({ steps })),
      ),
    ),
    Effect.orElseSucceed(() => Stream.empty),
  ),
);

export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  // The canvas shows the document being edited, with what is selected outlined, or the document playing, once its world is joined.
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
              setup: setUp,
              onFailed: (reason) => Message.FailedShowDocument({ reason }),
            });
          case 'Playing':
            return Stage.stream({
              resource: Played,
              canvasId: CANVAS_ID,
              views: ObjectsView.views,
              setup: setUp,
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
        isPlayJoined: play._tag === 'Playing' && play.world === 'Joined',
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
            })
          : Stream.empty,
    },
  ),
}));
