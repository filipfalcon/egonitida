import { Action, Component, Domain, Game, Pointing, Rule, World } from '@lightocean/core';
import { Option, Schema } from 'effect';
import * as Objects from '#src/objects.ts';

/**
 * Editing a document, as a world: whoever edits it is a player, and every edit is their action, which the rules here answer by the events of the `Objects` domain, so an edit is checked against the components' schemas wherever it comes from, a panel, a click, or an agent. What each editor has selected is theirs, on their own entity. A document playing is another game, without this domain, so nothing is edited while it plays.
 */

// COMPONENTS

/** The object an editor has selected, if any. */
export const Selection = Component.make(
  'Selection',
  Schema.Struct({ selected: Schema.Option(Schema.Int) }),
  { owner: 'rules', network: 'server' },
);

/** The number the next object made is named by, held by the document's own entity, so a name is never given twice. */
export const Numbering = Component.make('Numbering', Schema.Struct({ next: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

// ACTIONS

/** The editor added an object of a shape. */
export const AddedObject = Action.make('AddedObject', { shape: Objects.ShapeFields.fields.kind });
/** The editor removed an object. */
export const RemovedObject = Action.make('RemovedObject', { entity: Schema.Int });
/** The editor changed a property of an object to a value not yet checked against its schema; the label's `text` renames it. */
export const EditedProperty = Action.make('EditedProperty', {
  entity: Schema.Int,
  component: Schema.String,
  field: Schema.String,
  value: Schema.Json,
});
/** The editor let go of what they had selected. */
export const Deselected = Action.make('Deselected', {});
/** The editor added a reaction to an object. */
export const AddedReaction = Action.make('AddedReaction', { entity: Schema.Int });
/** The editor removed an object's `index`th reaction. */
export const RemovedReaction = Action.make('RemovedReaction', {
  entity: Schema.Int,
  index: Schema.Int,
});
/** The editor changed what kind of change an object's `index`th reaction makes. */
export const ChangedReactionKind = Action.make('ChangedReactionKind', {
  entity: Schema.Int,
  index: Schema.Int,
  kind: Objects.ChangeKind,
});
/** The editor changed whom an object's `index`th reaction acts on. */
export const ChangedReactionTarget = Action.make('ChangedReactionTarget', {
  entity: Schema.Int,
  index: Schema.Int,
  target: Objects.Target,
});
/** The editor changed a setting of an object's `index`th reaction to a value not yet checked against its schema. */
export const ChangedReactionSetting = Action.make('ChangedReactionSetting', {
  entity: Schema.Int,
  index: Schema.Int,
  field: Schema.String,
  value: Schema.Json,
});

// RULES

/** An object added is named by the next number, stands in the next place, and is selected by whoever added it. */
const addObject = Rule.on(AddedObject, {
  writes: [Numbering, Selection],
  emits: [],
  spawns: [
    Objects.Shape,
    Objects.Transform,
    Objects.Colour,
    Objects.Spin,
    Objects.Behaviour,
    Pointing.Label,
  ],
  run: (context, { player, shape }) => {
    for (const [document, { next }] of context.query(Numbering)) {
      const object = context.spawn(Objects.objectOf(shape, next - 1, `${shape} ${next}`));
      context.set(document, Numbering, { next: next + 1 });
      context.set(player, Selection, { selected: Option.some(object) });
    }
  },
});

/** An object removed is gone, and let go of by every editor who had it selected. */
const removeObject = Rule.on(RemovedObject, {
  writes: [Selection],
  emits: [],
  despawns: true,
  run: (context, { entity }) => {
    if (Option.isNone(context.get(entity, Objects.Shape))) {
      return;
    }
    context.despawn(entity);
    for (const [editor, { selected }] of context.query(Selection)) {
      if (Option.contains(selected, entity)) {
        context.set(editor, Selection, { selected: Option.none() });
      }
    }
  },
});

/** A property edited is the `Objects` domain's to check and set, but for a label, which is renamed. */
const editProperty = Rule.on(EditedProperty, {
  writes: [],
  emits: [Objects.Edited, Pointing.Relabelled],
  run: (context, { entity, component, field, value }) => {
    if (Option.isNone(context.get(entity, Objects.Shape))) {
      return;
    }
    if (component === 'Label') {
      if (field === 'text' && typeof value === 'string') {
        context.emit({ _tag: 'Relabelled', entity, text: value });
      }
      return;
    }
    context.emit({ _tag: 'Edited', entity, component, field, value });
  },
});

/** An object clicked while editing is selected by whoever clicked it. */
const select = Rule.on(Pointing.Clicked, {
  writes: [Selection],
  emits: [],
  run: (context, { player, entity }) => {
    if (Option.isSome(context.get(entity, Objects.Shape))) {
      context.set(player, Selection, { selected: Option.some(entity) });
    }
  },
});

const deselect = Rule.on(Deselected, {
  writes: [Selection],
  emits: [],
  run: (context, { player }) => {
    context.set(player, Selection, { selected: Option.none() });
  },
});

// Each edit of an object's reactions is the `Objects` domain's to check and make.

const addReaction = Rule.on(AddedReaction, {
  writes: [],
  emits: [Objects.ReactionEdited],
  run: (context, { entity }) => {
    context.emit({ _tag: 'ReactionEdited', entity, edit: { _tag: 'Added' } });
  },
});

const removeReaction = Rule.on(RemovedReaction, {
  writes: [],
  emits: [Objects.ReactionEdited],
  run: (context, { entity, index }) => {
    context.emit({ _tag: 'ReactionEdited', entity, edit: { _tag: 'Removed', index } });
  },
});

const changeKind = Rule.on(ChangedReactionKind, {
  writes: [],
  emits: [Objects.ReactionEdited],
  run: (context, { entity, index, kind }) => {
    context.emit({ _tag: 'ReactionEdited', entity, edit: { _tag: 'KindChanged', index, kind } });
  },
});

const changeTarget = Rule.on(ChangedReactionTarget, {
  writes: [],
  emits: [Objects.ReactionEdited],
  run: (context, { entity, index, target }) => {
    context.emit({
      _tag: 'ReactionEdited',
      entity,
      edit: { _tag: 'TargetChanged', index, target },
    });
  },
});

const changeSetting = Rule.on(ChangedReactionSetting, {
  writes: [],
  emits: [Objects.ReactionEdited],
  run: (context, { entity, index, field, value }) => {
    context.emit({
      _tag: 'ReactionEdited',
      entity,
      edit: { _tag: 'SettingChanged', index, field, value },
    });
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Editing',
  requires: [Pointing.domain, Objects.domain],
  components: [Selection, Numbering],
  actions: [
    AddedObject,
    RemovedObject,
    EditedProperty,
    Deselected,
    AddedReaction,
    RemovedReaction,
    ChangedReactionKind,
    ChangedReactionTarget,
    ChangedReactionSetting,
  ],
  events: [],
  systems: [],
  rules: [
    addObject,
    removeObject,
    editProperty,
    select,
    deselect,
    addReaction,
    removeReaction,
    changeKind,
    changeTarget,
    changeSetting,
  ],
});

/** A document being edited: a world of objects, and the editors at it. */
export const game = Game.make({
  stepRate: 30,
  domains: [Pointing.domain, Objects.domain, domain],
});

/** An editor joining: an entity with nothing selected. */
export const join = (world: World.World): readonly [World.World, World.Entity] =>
  World.spawn(world, [Selection.of({ selected: Option.none() })]);

const [numbered] = World.spawn(World.empty({ seed: 1 }), [Numbering.of({ next: 3 })]);
const [withBox, box] = World.spawn(numbered, Objects.objectOf('Box', 0, 'Box 1'));
const [withSphere, sphere] = World.spawn(withBox, Objects.objectOf('Sphere', 1, 'Sphere 2'));

/** A new document: a box and a sphere. */
export const document = withSphere;
export { box, sphere };

const [joinedWorld, editor] = join(document);
/** The new document with one editor at it. */
export const joined = { world: joinedWorld, editor };
