import { Component, Domain, Event, Pointing, Rule, System } from '@lightocean/core';
import { Inspector } from '@lightocean/reflection';
import { Option, Schema } from 'effect';

/**
 * What a document is made of: objects, each a shape with a place, a colour, a spin, and the reactions it has when clicked, and read out by its label. Each turns at its spin, which only a client keeps, so an editor and a document playing show it alike. Whatever changes an object, an editor or a document playing, changes it by this domain's events, which its rules check against the components' own schemas. Each field annotated with `inspector` is one the Details panel edits.
 */

const Vector3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);

// COMPONENTS

export const ShapeFields = Schema.Struct({
  kind: Schema.Literals(['Box', 'Sphere']).annotate({
    title: 'Shape',
    inspector: Inspector.choice(),
  }),
});
/** The shapes an object can be. */
export type ShapeKind = (typeof ShapeFields.Type)['kind'];
/** What an object is: a box or a sphere. */
export const Shape = Component.make('Shape', ShapeFields, { owner: 'rules', network: 'server' });

/** What a transform holds, each field as the Details panel edits it. */
export const TransformFields = Schema.Struct({
  position: Vector3.annotate({ title: 'Position', inspector: Inspector.vector3({ step: 0.1 }) }),
  rotation: Vector3.annotate({ title: 'Rotation (°)', inspector: Inspector.vector3({ step: 5 }) }),
  scale: Vector3.annotate({ title: 'Scale', inspector: Inspector.vector3({ step: 0.1 }) }),
});
/** Where an object stands, how it is turned, in degrees, and how large it is. */
export const Transform = Component.make('Transform', TransformFields, {
  owner: 'rules',
  network: 'server',
});

/** What a colour holds, as the Details panel edits it. */
export const ColourFields = Schema.Struct({
  hex: Schema.Int.annotate({ title: 'Colour', inspector: Inspector.color() }),
});
/** An object's colour, as `0xRRGGBB`. */
export const Colour = Component.make('Colour', ColourFields, { owner: 'rules', network: 'server' });

/** What a spin holds, as the Details panel edits it. */
export const SpinFields = Schema.Struct({
  speed: Schema.Finite.annotate({
    title: 'Spin (rad/s)',
    inspector: Inspector.number({ min: -10, max: 10, step: 0.1 }),
  }),
});
/** How fast an object turns about its upright, in radians a second. */
export const Spin = Component.make('Spin', SpinFields, { owner: 'rules', network: 'server' });

// REACTIONS

/** How far an object has turned at its spin, in radians: drawn, never sent, and kept by each client for itself. */
export const Turn = Component.make('Turn', Schema.Struct({ angle: Schema.Finite }), {
  owner: 'simulation',
  network: 'local',
});

/** Whom a reaction acts on: the object clicked itself, or another. */
export const Target = Schema.Union([
  Schema.TaggedStruct('Itself', {}),
  Schema.TaggedStruct('Other', { entity: Schema.Int }),
]);
export type Target = typeof Target.Type;

/** The object clicked itself. */
export const itself: Target = { _tag: 'Itself' };

/** A change that gives the target a colour. */
export const Recolour = Schema.TaggedStruct('Recolour', {
  hex: Schema.Int.annotate({ title: 'Colour', inspector: Inspector.color() }),
});
/** A change that moves the target by an offset from where it is. */
export const MoveBy = Schema.TaggedStruct('MoveBy', {
  offset: Vector3.annotate({ title: 'Offset', inspector: Inspector.vector3({ step: 0.5 }) }),
});
/** A change that sets how fast the target spins. */
export const SetSpin = Schema.TaggedStruct('SetSpin', {
  speed: Schema.Finite.annotate({
    title: 'Spin (rad/s)',
    inspector: Inspector.number({ min: -10, max: 10, step: 0.1 }),
  }),
});

/** What a reaction does to its target. */
export const Change = Schema.Union([Recolour, MoveBy, SetSpin]);
export type Change = typeof Change.Type;
/** The kinds of change a reaction can make. */
export type ChangeKind = Change['_tag'];
/** The kinds of change a reaction can make, as a schema an editor's choice is checked against. */
export const ChangeKind = Schema.Literals(['Recolour', 'MoveBy', 'SetSpin']);

/** A change of each kind, as a reaction starts doing it. */
export const changeOf = (kind: ChangeKind): Change => {
  switch (kind) {
    case 'Recolour':
      return { _tag: 'Recolour', hex: 0xffffff };
    case 'MoveBy':
      return { _tag: 'MoveBy', offset: [0, 1, 0] };
    case 'SetSpin':
      return { _tag: 'SetSpin', speed: 2 };
  }
};

/** The fields of a change its kind's schema lets be edited, if it takes `value` for `field`. */
const editedIn = <Fields extends Inspector.DecodableFields>(
  schema: Schema.Struct<Fields>,
  value: Schema.Struct<Fields>['Type'],
  field: string,
  candidate: unknown,
): Option.Option<Schema.Struct<Fields>['Type']> =>
  Inspector.properties(schema).some(({ key }) => key === field)
    ? Inspector.edit(schema, value, field, candidate)
    : Option.none();

/** `change` with `field` set to `candidate`, if its kind's schema shows the field and takes the value. */
export const editChange = (
  change: Change,
  field: string,
  candidate: unknown,
): Option.Option<Change> => {
  switch (change._tag) {
    case 'Recolour':
      return editedIn(Recolour, change, field, candidate);
    case 'MoveBy':
      return editedIn(MoveBy, change, field, candidate);
    case 'SetSpin':
      return editedIn(SetSpin, change, field, candidate);
  }
};

/** When the object is clicked, `change` happens to `target`. */
export const Reaction = Schema.Struct({ target: Target, change: Change });
export type Reaction = typeof Reaction.Type;

/** What an object does when clicked: its reactions, in order. */
export const Behaviour = Component.make(
  'Behaviour',
  Schema.Struct({ reactions: Schema.Array(Reaction) }),
  {
    owner: 'rules',
    network: 'server',
  },
);

/** Where the `index`th object made stands: rows of five, filled from the middle outwards, a row further back for every five. */
export const placeOf = (index: number): readonly [number, number, number] => {
  const across = [0, -1, 1, -2, 2][index % 5] ?? 0;
  return [across * 2, 0, 0 - Math.floor(index / 5) * 2];
};

/** A new object of `kind`, the `index`th made, read out as `name`. */
export const objectOf = (kind: ShapeKind, index: number, name: string) => [
  Shape.of({ kind }),
  Transform.of({ position: placeOf(index), rotation: [0, 0, 0], scale: [1, 1, 1] }),
  Colour.of({ hex: kind === 'Box' ? 0x4f8cff : 0xff6b6b }),
  Spin.of({ speed: 0.5 }),
  Behaviour.of({ reactions: [] }),
  Pointing.Label.of({ text: name }),
];

// EVENTS

/** An object's `field` of `component` is to be `value`, if the component's schema shows the field and takes the value. */
export const Edited = Event.make('Edited', {
  entity: Schema.Int,
  component: Schema.String,
  field: Schema.String,
  value: Schema.Json,
});

/** One edit of an object's reactions: one added, which recolours the object itself, or the `index`th removed, or its kind of change, its target, or a setting of its change changed. */
export const ReactionEdit = Schema.Union([
  Schema.TaggedStruct('Added', {}),
  Schema.TaggedStruct('Removed', { index: Schema.Int }),
  Schema.TaggedStruct('KindChanged', { index: Schema.Int, kind: ChangeKind }),
  Schema.TaggedStruct('TargetChanged', { index: Schema.Int, target: Target }),
  Schema.TaggedStruct('SettingChanged', {
    index: Schema.Int,
    field: Schema.String,
    value: Schema.Json,
  }),
]);
export type ReactionEdit = typeof ReactionEdit.Type;

/** An object's reactions are to be edited by `edit`, if it is one they can take: a target must be another object, and a setting one its change's schema shows and takes. */
export const ReactionEdited = Event.make('ReactionEdited', {
  entity: Schema.Int,
  edit: ReactionEdit,
});

/** An object of `kind` is to be made, the `index`th, read out as `name`, for whoever `by` is, which `Made` tells back. */
export const Added = Event.make('Added', {
  kind: ShapeFields.fields.kind,
  index: Schema.Int,
  name: Schema.String,
  by: Schema.Int,
});

/** An object was made, as `Added` asked, for whoever `by` is. */
export const Made = Event.make('Made', { entity: Schema.Int, by: Schema.Int });

/** An object is to be gone. */
export const Removed = Event.make('Removed', { entity: Schema.Int });

/** An object is to be `hex` in colour. */
export const Recoloured = Event.make('Recoloured', { entity: Schema.Int, hex: Schema.Int });
/** An object is to move by `offset` from where it is. */
export const Moved = Event.make('Moved', {
  entity: Schema.Int,
  offset: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
});
/** An object is to spin at `speed` from now on. */
export const SpinChanged = Event.make('SpinChanged', { entity: Schema.Int, speed: Schema.Finite });

// RULES

const edit = Rule.on(Edited, {
  writes: [Shape, Transform, Colour, Spin],
  emits: [],
  run: (context, { entity, component, field, value }) => {
    switch (component) {
      case 'Shape':
        Option.map(
          Option.flatMap(context.get(entity, Shape), (current) =>
            editedIn(ShapeFields, current, field, value),
          ),
          (edited) => context.set(entity, Shape, edited),
        );
        break;
      case 'Transform':
        Option.map(
          Option.flatMap(context.get(entity, Transform), (current) =>
            editedIn(TransformFields, current, field, value),
          ),
          (edited) => context.set(entity, Transform, edited),
        );
        break;
      case 'Colour':
        Option.map(
          Option.flatMap(context.get(entity, Colour), (current) =>
            editedIn(ColourFields, current, field, value),
          ),
          (edited) => context.set(entity, Colour, edited),
        );
        break;
      case 'Spin':
        Option.map(
          Option.flatMap(context.get(entity, Spin), (current) =>
            editedIn(SpinFields, current, field, value),
          ),
          (edited) => context.set(entity, Spin, edited),
        );
        break;
    }
  },
});

/** `reactions` with the `index`th changed by `change`, if there is one and `change` gives one. */
const changeAt = (
  reactions: ReadonlyArray<Reaction>,
  index: number,
  change: (reaction: Reaction) => Option.Option<Reaction>,
): Option.Option<ReadonlyArray<Reaction>> =>
  Option.map(Option.flatMap(Option.fromNullishOr(reactions[index]), change), (changed) =>
    reactions.map((reaction, at) => (at === index ? changed : reaction)),
  );

const editReactions = Rule.on(ReactionEdited, {
  writes: [Behaviour],
  emits: [],
  run: (context, { entity, edit }) => {
    const isObject = (other: number) =>
      other !== entity && Option.isSome(context.get(other, Shape));
    const edited = Option.flatMap(context.get(entity, Behaviour), ({ reactions }) => {
      switch (edit._tag) {
        case 'Added':
          return Option.some([...reactions, { target: itself, change: changeOf('Recolour') }]);
        case 'Removed':
          return Option.some(reactions.filter((_, at) => at !== edit.index));
        case 'KindChanged':
          return changeAt(reactions, edit.index, (reaction) =>
            Option.some({ ...reaction, change: changeOf(edit.kind) }),
          );
        case 'TargetChanged':
          return edit.target._tag === 'Other' && !isObject(edit.target.entity)
            ? Option.none()
            : changeAt(reactions, edit.index, (reaction) =>
                Option.some({ ...reaction, target: edit.target }),
              );
        case 'SettingChanged':
          return changeAt(reactions, edit.index, (reaction) =>
            Option.map(editChange(reaction.change, edit.field, edit.value), (change) => ({
              ...reaction,
              change,
            })),
          );
      }
    });
    Option.map(edited, (reactions) => context.set(entity, Behaviour, { reactions }));
  },
});

/** An object added is made as asked, and said to have been made. */
const add = Rule.on(Added, {
  writes: [],
  emits: [Made],
  spawns: [Shape, Transform, Colour, Spin, Behaviour, Pointing.Label],
  run: (context, { kind, index, name, by }) => {
    const entity = context.spawn(objectOf(kind, index, name));
    context.emit({ _tag: 'Made', entity, by });
  },
});

/** An object removed is gone; anything else is left be. */
const remove = Rule.on(Removed, {
  writes: [],
  emits: [],
  despawns: true,
  run: (context, { entity }) => {
    if (Option.isSome(context.get(entity, Shape))) {
      context.despawn(entity);
    }
  },
});

const recolour = Rule.on(Recoloured, {
  writes: [Colour],
  emits: [],
  run: (context, { entity, hex }) => {
    if (Option.isSome(context.get(entity, Colour))) {
      context.set(entity, Colour, { hex });
    }
  },
});

/** A move is from where the object is by then, so two in one step add up. */
const move = Rule.on(Moved, {
  writes: [Transform],
  emits: [],
  run: (context, { entity, offset }) => {
    Option.map(context.get(entity, Transform), (transform) => {
      const [x, y, z] = transform.position;
      context.set(entity, Transform, {
        ...transform,
        position: [x + offset[0], y + offset[1], z + offset[2]],
      });
    });
  },
});

const changeSpin = Rule.on(SpinChanged, {
  writes: [Spin],
  emits: [],
  run: (context, { entity, speed }) => {
    if (Option.isSome(context.get(entity, Spin))) {
      context.set(entity, Spin, { speed });
    }
  },
});

// SYSTEMS

/** Every object turns on at its spin, from wherever it had turned to. */
const turning = System.make({
  name: 'turning',
  reads: [Spin],
  writes: [Turn],
  emits: [],
  run: (context) => {
    for (const [entity, { speed }] of context.query(Spin)) {
      const { angle } = Option.getOrElse(context.get(entity, Turn), () => ({ angle: 0 }));
      context.set(entity, Turn, { angle: angle + speed * context.time.stepSeconds });
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Objects',
  requires: [Pointing.domain],
  components: [Shape, Transform, Colour, Spin, Behaviour, Turn],
  actions: [],
  events: [Added, Made, Removed, Edited, ReactionEdited, Recoloured, Moved, SpinChanged],
  systems: [],
  rules: [add, remove, edit, editReactions, recolour, move, changeSpin],
  localSystems: [turning],
});
