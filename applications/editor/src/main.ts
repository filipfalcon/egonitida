import { Inspect, Log, Rewind } from '@nitida/devtools';
import { Session } from '@nitida/foldkit';
import { Pointing } from '@nitida/core';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Editing from '#src/editing.ts';
import * as Objects from '#src/objects.ts';
import * as Playing from '#src/playing.ts';

/**
 * The editor's page. The document is a game, joined in a worker; the page holds no more of it than its panels show, the objects in the outliner and the one the editor has selected, and sends the document every edit as the editor's action, which the document checks and decides on. Play opens a second worker from the document as it is, and the canvas shows that game until Stop ends it; nothing is edited meanwhile. While it plays, the debugger tells what happened at each step, what it changed, and the state after any of them, on the canvas too.
 */

// MODEL

/** An object as the outliner lists it. */
export const OutlineEntry = Schema.Struct({
  entity: Schema.Int,
  name: Schema.String,
  kind: Objects.ShapeFields.fields.kind,
  /** Whether it reacts when clicked. */
  reacts: Schema.Boolean,
});
export type OutlineEntry = typeof OutlineEntry.Type;

/** The object the editor has selected, as the Details and Behaviour panels show it. */
export const Selected = Schema.Struct({
  entity: Schema.Int,
  name: Schema.String,
  shape: Objects.ShapeFields,
  transform: Objects.TransformFields,
  colour: Objects.ColourFields,
  spin: Objects.SpinFields,
  reactions: Schema.Array(Objects.Reaction),
});
export type Selected = typeof Selected.Type;

/** The document as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const DocumentState = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type DocumentState = typeof DocumentState.Type;

/** What the debugger shows of the document playing: the state after `tick`, entity by entity as JSON. */
export const Past = Schema.Struct({ tick: Schema.Int, state: Schema.String });

/**
 * Whether the document is being edited, or plays from `opening`, the document as it was when Play was pressed: its session being opened or joined, the steps its debugger told of in which something happened, and the past it shows, if not the live game.
 */
export const Play = Schema.Union([
  Schema.TaggedStruct('Editing', {}),
  Schema.TaggedStruct('Playing', {
    opening: Schema.String,
    session: Schema.Literals(['Opening', 'Joined']),
    steps: Schema.Array(Log.Step),
    maybePast: Schema.Option(Past),
  }),
]);
export type Play = typeof Play.Type;
/** The document playing. */
export type PlayingState = Extract<Play, { readonly _tag: 'Playing' }>;

/** The editor's page: the document as far as it has it, its objects as the outliner lists them, the one selected, whether the document plays, and what last went wrong. */
export const Model = Schema.Struct({
  document: DocumentState,
  outline: Schema.Array(OutlineEntry),
  maybeSelected: Schema.Option(Selected),
  play: Play,
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the page: the document and the game playing joined and left, what they tell, and what the editor does. */
export const Message = defineMessageUnion({
  JoinedDocument: {},
  FoundDocumentJoined: {},
  LeftDocument: {},
  FailedJoinDocument: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowDocument: { reason: Schema.String },
  ProjectedOutline: { objects: Schema.Array(OutlineEntry) },
  ProjectedSelection: { maybeSelected: Schema.Option(Selected) },
  ClickedAddObject: { shape: Objects.ShapeFields.fields.kind },
  ClickedObject: { entity: Schema.Int },
  ClickedDeleteSelected: {},
  ClickedDeselect: {},
  /** A value typed into the Details panel, not yet checked against its component's schema. */
  ChangedProperty: { component: Schema.String, field: Schema.String, value: Schema.Unknown },
  ClickedAddReaction: {},
  ClickedRemoveReaction: { index: Schema.Int },
  ChangedReactionKind: { index: Schema.Int, kind: Objects.ChangeKind },
  /** The target chosen: `itself`, or the id of another object. */
  ChangedReactionTarget: { index: Schema.Int, target: Schema.String },
  /** A value typed into a reaction's settings, not yet checked against its change's schema. */
  ChangedReactionSetting: { index: Schema.Int, field: Schema.String, value: Schema.Unknown },
  SentEdit: {},
  FailedSendEdit: { reason: Schema.String },
  ClickedPlay: {},
  ReadDocumentForPlay: { opening: Schema.String },
  FailedOpenPlay: { reason: Schema.String },
  JoinedPlay: {},
  FoundPlayJoined: {},
  LeftPlay: {},
  FailedJoinPlay: { reason: Schema.String },
  ClickedStop: {},
  ToldSteps: { steps: Schema.Array(Log.Step) },
  InspectedStep: { tick: Schema.Int },
  ShowedPast: { tick: Schema.Int, state: Schema.String },
  ClickedLive: {},
  WentLive: {},
  FailedDebug: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The document, joined while the editor is open. */
export const Document = ManagedResource.tag<Session.Joined>()('Document');

/** The document playing, joined while it plays. */
export const Played = ManagedResource.tag<Session.Joined>()('Played');

/** What the editor's Commands and Subscriptions reach: its document, and the document playing. */
export type Services =
  | ManagedResource.ServiceOf<typeof Document>
  | ManagedResource.ServiceOf<typeof Played>;

// COMMANDS

/** An edit, as the editor's action it is sent as. */
export const Edit = Schema.Union([
  Schema.TaggedStruct('AddedObject', { shape: Objects.ShapeFields.fields.kind }),
  Schema.TaggedStruct('RemovedObject', { entity: Schema.Int }),
  Schema.TaggedStruct('Clicked', { entity: Schema.Int }),
  Schema.TaggedStruct('Deselected', {}),
  Schema.TaggedStruct('EditedProperty', {
    entity: Schema.Int,
    component: Schema.String,
    field: Schema.String,
    value: Schema.Json,
  }),
  Schema.TaggedStruct('AddedReaction', { entity: Schema.Int }),
  Schema.TaggedStruct('RemovedReaction', { entity: Schema.Int, index: Schema.Int }),
  Schema.TaggedStruct('ChangedReactionKind', {
    entity: Schema.Int,
    index: Schema.Int,
    kind: Objects.ChangeKind,
  }),
  Schema.TaggedStruct('ChangedReactionTarget', {
    entity: Schema.Int,
    index: Schema.Int,
    target: Objects.Target,
  }),
  Schema.TaggedStruct('ChangedReactionSetting', {
    entity: Schema.Int,
    index: Schema.Int,
    field: Schema.String,
    value: Schema.Json,
  }),
]);
export type Edit = typeof Edit.Type;

/** Sends `edit` to the document, as the editor's action. */
export const SendEdit = Command.define('SendEdit', {
  args: { edit: Edit },
  messages: [Message.SentEdit, Message.FailedSendEdit],
  execute: ({ edit }) =>
    Document.get.pipe(
      Effect.flatMap(({ client }) => {
        switch (edit._tag) {
          case 'AddedObject':
            return client.act(Editing.AddedObject, { shape: edit.shape });
          case 'RemovedObject':
            return client.act(Editing.RemovedObject, { entity: edit.entity });
          case 'Clicked':
            return client.act(Pointing.Clicked, { entity: edit.entity });
          case 'Deselected':
            return client.act(Editing.Deselected, {});
          case 'EditedProperty':
            return client.act(Editing.EditedProperty, {
              entity: edit.entity,
              component: edit.component,
              field: edit.field,
              value: edit.value,
            });
          case 'AddedReaction':
            return client.act(Editing.AddedReaction, { entity: edit.entity });
          case 'RemovedReaction':
            return client.act(Editing.RemovedReaction, { entity: edit.entity, index: edit.index });
          case 'ChangedReactionKind':
            return client.act(Editing.ChangedReactionKind, {
              entity: edit.entity,
              index: edit.index,
              kind: edit.kind,
            });
          case 'ChangedReactionTarget':
            return client.act(Editing.ChangedReactionTarget, {
              entity: edit.entity,
              index: edit.index,
              target: edit.target,
            });
          case 'ChangedReactionSetting':
            return client.act(Editing.ChangedReactionSetting, {
              entity: edit.entity,
              index: edit.index,
              field: edit.field,
              value: edit.value,
            });
        }
      }),
      Effect.as(Message.SentEdit()),
      Effect.catch(({ resource }) =>
        Effect.succeed(
          Message.FailedSendEdit({ reason: `The document ${resource} is not joined.` }),
        ),
      ),
    ),
});

/** Reads the document as it is, as a worker playing it is opened with. */
export const OpenPlay = Command.define('OpenPlay', {
  messages: [Message.ReadDocumentForPlay, Message.FailedOpenPlay],
  execute: Document.get.pipe(
    Effect.flatMap(({ client }) => client.state),
    Effect.map((state) => Message.ReadDocumentForPlay({ opening: Playing.opening(state) })),
    Effect.catch(({ resource }) =>
      Effect.succeed(Message.FailedOpenPlay({ reason: `The document ${resource} is not joined.` })),
    ),
  ),
});

/** Suspends the time of the document playing and shows it, the canvas too, as it was after `tick`, with the state then. */
export const ShowPast = Command.define('ShowPast', {
  args: { tick: Schema.Int },
  messages: [Message.ShowedPast, Message.FailedDebug],
  execute: ({ tick }) =>
    Played.get.pipe(
      Effect.flatMap(({ client }) =>
        Effect.gen(function* () {
          const rewind = Rewind.controls(client);
          yield* rewind.suspend;
          yield* rewind.seek(tick);
          return yield* Inspect.ask(client, { _tag: 'State', tick });
        }),
      ),
      Effect.map((state) => Message.ShowedPast({ tick, state: JSON.stringify(state, null, 2) })),
      Effect.catchTags({
        ResourceNotAvailable: () =>
          Effect.succeed(Message.FailedDebug({ reason: 'The document is not playing.' })),
        Unanswered: ({ reason }) => Effect.succeed(Message.FailedDebug({ reason })),
      }),
    ),
});

/** Shows the document playing as it is now, and lets its time go on. */
export const GoLive = Command.define('GoLive', {
  messages: [Message.WentLive, Message.FailedDebug],
  execute: Played.get.pipe(
    Effect.flatMap(({ client }) => Rewind.controls(client).live),
    Effect.as(Message.WentLive()),
    Effect.orElseSucceed(() => Message.FailedDebug({ reason: 'The document is not playing.' })),
  ),
});

// UPDATE

/** A typed value as it can travel: whole numbers, text, and lists of them; none while a number is not yet typed whole. */
const isWhole = (value: unknown): boolean =>
  typeof value === 'number'
    ? Number.isFinite(value)
    : Array.isArray(value)
      ? value.every(isWhole)
      : typeof value === 'string' || typeof value === 'boolean';

const jsonOf = (value: unknown): Option.Option<Schema.Json> =>
  isWhole(value) ? Schema.decodeUnknownOption(Schema.Json)(value) : Option.none();

/** A target as chosen: the object itself, or another by its id. */
const targetOf = (chosen: string): Option.Option<Objects.Target> =>
  chosen === 'itself'
    ? Option.some(Objects.itself)
    : Option.map(
        Option.filter(Option.some(Number(chosen)), Number.isInteger),
        (entity): Objects.Target => ({ _tag: 'Other', entity }),
      );

const failed = (model: Model, reason: string) =>
  modifyFields(model, { maybeError: () => Option.some(reason) });

/** Sends `edit`, if there is one and the document is being edited, not played; the page changes only once the document says what came of it. */
const sending = (
  model: Model,
  edit: Option.Option<Edit>,
): Update.Return<Model, Message, Services> =>
  Option.match(
    Option.filter(edit, () => isEditing(model)),
    {
      onNone: () => ({ model }),
      onSome: (sent) => ({ model, commands: [SendEdit({ edit: sent })] }),
    },
  );

/** Whether the document is being edited, rather than played. */
const isEditing = (model: Model) => model.play._tag === 'Editing';

/** `model` with what plays changed by `change`, while the document plays; as it is otherwise. */
const whilePlaying = (model: Model, change: (playing: PlayingState) => PlayingState): Model => {
  const { play } = model;
  return play._tag === 'Playing' ? modifyFields(model, { play: () => change(play) }) : model;
};

/** An edit of the selected object, if one is selected. */
const ofSelected = (model: Model, edit: (entity: number) => Option.Option<Edit>) =>
  Option.flatMap(model.maybeSelected, ({ entity }) => edit(entity));

/** The page after `message`, and the Commands it sends: edits to the document, what Play and the debugger ask of the game playing. */
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    // Joined again while the Model already says so, as one restored after a reload does, the canvas in the page stays as it is. What went wrong while it was not joined is past.
    JoinedDocument: () => ({
      model: modifyFields(model, {
        document: (was) => (was._tag === 'Joined' ? was : { _tag: 'Joined', canvas: 'Waiting' }),
        maybeError: () => Option.none(),
      }),
    }),
    // Found joined while waiting for it, the document is joined, as when the stage found it not joined a moment before it was; found joined once the page has it, it changes nothing, and what went wrong since stays told.
    FoundDocumentJoined: () => ({
      model:
        model.document._tag === 'Joining'
          ? modifyFields(model, {
              document: () => ({ _tag: 'Joined', canvas: 'Waiting' }),
              maybeError: () => Option.none(),
            })
          : model,
    }),
    // The canvas goes with the document, so a document joined again waits for its own canvas.
    LeftDocument: () => ({ model: modifyFields(model, { document: () => ({ _tag: 'Joining' }) }) }),
    FailedJoinDocument: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({
      model:
        model.document._tag === 'Joined'
          ? modifyFields(model, { document: () => ({ _tag: 'Joined', canvas: 'Mounted' }) })
          : model,
    }),
    FailedShowDocument: ({ reason }) => ({ model: failed(model, reason) }),
    ProjectedOutline: ({ objects }) => ({ model: modifyFields(model, { outline: () => objects }) }),
    ProjectedSelection: ({ maybeSelected }) => ({
      model: modifyFields(model, { maybeSelected: () => maybeSelected }),
    }),
    ClickedAddObject: ({ shape }) => sending(model, Option.some({ _tag: 'AddedObject', shape })),
    ClickedObject: ({ entity }) => sending(model, Option.some({ _tag: 'Clicked', entity })),
    ClickedDeleteSelected: () =>
      sending(
        model,
        ofSelected(model, (entity) => Option.some({ _tag: 'RemovedObject', entity })),
      ),
    ClickedDeselect: () => sending(model, Option.some({ _tag: 'Deselected' })),
    ChangedProperty: ({ component, field, value }) =>
      sending(
        model,
        ofSelected(model, (entity) =>
          Option.map(jsonOf(value), (json) => ({
            _tag: 'EditedProperty',
            entity,
            component,
            field,
            value: json,
          })),
        ),
      ),
    ClickedAddReaction: () =>
      sending(
        model,
        ofSelected(model, (entity) => Option.some({ _tag: 'AddedReaction', entity })),
      ),
    ClickedRemoveReaction: ({ index }) =>
      sending(
        model,
        ofSelected(model, (entity) => Option.some({ _tag: 'RemovedReaction', entity, index })),
      ),
    ChangedReactionKind: ({ index, kind }) =>
      sending(
        model,
        ofSelected(model, (entity) =>
          Option.some({ _tag: 'ChangedReactionKind', entity, index, kind }),
        ),
      ),
    ChangedReactionTarget: ({ index, target }) =>
      sending(
        model,
        ofSelected(model, (entity) =>
          Option.map(targetOf(target), (chosen) => ({
            _tag: 'ChangedReactionTarget',
            entity,
            index,
            target: chosen,
          })),
        ),
      ),
    ChangedReactionSetting: ({ index, field, value }) =>
      sending(
        model,
        ofSelected(model, (entity) =>
          Option.map(jsonOf(value), (json) => ({
            _tag: 'ChangedReactionSetting',
            entity,
            index,
            field,
            value: json,
          })),
        ),
      ),
    SentEdit: () => ({ model }),
    FailedSendEdit: ({ reason }) => ({ model: failed(model, reason) }),
    ClickedPlay: () => ({
      model,
      commands: isEditing(model) && model.document._tag === 'Joined' ? [OpenPlay()] : [],
    }),
    ReadDocumentForPlay: ({ opening }) => ({
      model: modifyFields(model, {
        play: () => ({
          _tag: 'Playing',
          opening,
          session: 'Opening',
          steps: [],
          maybePast: Option.none(),
        }),
      }),
    }),
    FailedOpenPlay: ({ reason }) => ({ model: failed(model, reason) }),
    // What went wrong while the game playing was not joined is past.
    JoinedPlay: () => ({
      model: modifyFields(
        whilePlaying(model, (playing) => ({ ...playing, session: 'Joined' })),
        {
          maybeError: () => Option.none(),
        },
      ),
    }),
    LeftPlay: () => ({
      model: whilePlaying(model, (playing) => ({ ...playing, session: 'Opening' })),
    }),
    // Found joined while waiting for it, the game playing is joined; found joined once the page has it, it changes nothing.
    FoundPlayJoined: () => ({
      model:
        model.play._tag === 'Playing' && model.play.session === 'Opening'
          ? modifyFields(
              whilePlaying(model, (playing) => ({ ...playing, session: 'Joined' })),
              {
                maybeError: () => Option.none(),
              },
            )
          : model,
    }),
    FailedJoinPlay: ({ reason }) => ({ model: failed(model, reason) }),
    // The worker playing goes with it, and everything that happened while it played.
    ClickedStop: () => ({ model: modifyFields(model, { play: () => ({ _tag: 'Editing' }) }) }),
    ToldSteps: ({ steps }) => ({
      model: whilePlaying(model, (playing) => ({ ...playing, steps })),
    }),
    InspectedStep: ({ tick }) => ({ model, commands: [ShowPast({ tick })] }),
    ShowedPast: ({ tick, state }) => ({
      model: whilePlaying(model, (playing) => ({
        ...playing,
        maybePast: Option.some({ tick, state }),
      })),
    }),
    ClickedLive: () => ({ model, commands: [GoLive()] }),
    WentLive: () => ({
      model: whilePlaying(model, (playing) => ({ ...playing, maybePast: Option.none() })),
    }),
    FailedDebug: ({ reason }) => ({ model: failed(model, reason) }),
  });

// INIT

/** The page as it opens: joining the document, with nothing outlined or selected, editing. */
export const initialModel: Model = {
  document: { _tag: 'Joining' },
  outline: [],
  maybeSelected: Option.none(),
  play: { _tag: 'Editing' },
  maybeError: Option.none(),
};

/** The page as it opens. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
