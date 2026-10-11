import { World } from '@lightocean/foldkit';
import { Pointing } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Editing from '#src/editing.ts';
import * as Objects from '#src/objects.ts';

/**
 * The editor's page. The document is a world, joined in a worker; the page holds no more of it than its panels show, the objects in the outliner and the one the editor has selected, and sends the document every edit as the editor's action, which the document checks and decides on.
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

export const Model = Schema.Struct({
  isDocumentJoined: Schema.Boolean,
  isCanvasMounted: Schema.Boolean,
  outline: Schema.Array(OutlineEntry),
  maybeSelected: Schema.Option(Selected),
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

export const Message = defineMessageUnion({
  JoinedDocument: {},
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
});
export type Message = typeof Message.Type;

// RESOURCES

/** The document, joined while the editor is open. */
export const Document = ManagedResource.tag<World.Joined>()('Document');

/** What the editor's Commands and Subscriptions reach: its document. */
export type Services = ManagedResource.ServiceOf<typeof Document>;

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

/** Sends `edit`, if there is one; the page changes only once the document says what came of it. */
const sending = (
  model: Model,
  edit: Option.Option<Edit>,
): Update.Return<Model, Message, Services> =>
  Option.match(edit, {
    onNone: () => ({ model }),
    onSome: (sent) => ({ model, commands: [SendEdit({ edit: sent })] }),
  });

/** An edit of the selected object, if one is selected. */
const ofSelected = (model: Model, edit: (entity: number) => Option.Option<Edit>) =>
  Option.flatMap(model.maybeSelected, ({ entity }) => edit(entity));

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    JoinedDocument: () => ({ model: modifyFields(model, { isDocumentJoined: () => true }) }),
    // The canvas goes with the document, so a document joined again waits for its own canvas.
    LeftDocument: () => ({
      model: modifyFields(model, { isDocumentJoined: () => false, isCanvasMounted: () => false }),
    }),
    FailedJoinDocument: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({ model: modifyFields(model, { isCanvasMounted: () => true }) }),
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
  });

// INIT

export const initialModel: Model = {
  isDocumentJoined: false,
  isCanvasMounted: false,
  outline: [],
  maybeSelected: Option.none(),
  maybeError: Option.none(),
};

export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
