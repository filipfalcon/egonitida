import { Inspector } from '@lightocean/reflection';
import { Schema } from 'effect';

/**
 * The project document the editor works on. Each field's `inspector` annotation is what puts it in the Details panel; `id` has none, so it is never edited there.
 */

export const Shape = Schema.Literals(['Box', 'Sphere']);
export type Shape = typeof Shape.Type;

const Vector3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);

// BEHAVIOUR
//
// What an entity does when it is clicked while the document plays. Each action is a schema like any other, so the Details panel draws its settings from its `inspector` annotations.

export const SetColor = Schema.TaggedStruct('SetColor', {
  color: Schema.Int.annotate({ title: 'Colour', inspector: Inspector.color() }),
});

export const MoveBy = Schema.TaggedStruct('MoveBy', {
  offset: Vector3.annotate({ title: 'Offset', inspector: Inspector.vector3({ step: 0.5 }) }),
});

export const SetSpin = Schema.TaggedStruct('SetSpin', {
  speed: Schema.Finite.annotate({
    title: 'Spin (rad/s)',
    inspector: Inspector.number({ min: -10, max: 10, step: 0.1 }),
  }),
});

export const Action = Schema.Union([SetColor, MoveBy, SetSpin]);
export type Action = typeof Action.Type;
export type ActionKind = Action['_tag'];

export const actionSchemas = { SetColor, MoveBy, SetSpin } as const;

export const actionTitles: Record<ActionKind, string> = {
  SetColor: 'Set colour',
  MoveBy: 'Move by',
  SetSpin: 'Set spin',
};

export const defaultAction = (kind: ActionKind): Action => {
  switch (kind) {
    case 'SetColor':
      return { _tag: 'SetColor', color: 0xffffff };
    case 'MoveBy':
      return { _tag: 'MoveBy', offset: [0, 1, 0] };
    case 'SetSpin':
      return { _tag: 'SetSpin', speed: 2 };
  }
};

/** The entity a rule acts on when its target is the entity that was clicked. */
export const SELF = 'self';

export const Rule = Schema.Struct({
  id: Schema.String,
  /** `SELF`, or the id of another entity. */
  target: Schema.String,
  action: Action,
});
export type Rule = typeof Rule.Type;

// DOCUMENT

export const Entity = Schema.Struct({
  id: Schema.String,
  name: Schema.String.annotate({ title: 'Name', inspector: Inspector.text() }),
  shape: Shape.annotate({ title: 'Shape', inspector: Inspector.choice() }),
  position: Vector3.annotate({ title: 'Position', inspector: Inspector.vector3({ step: 0.1 }) }),
  rotation: Vector3.annotate({ title: 'Rotation (°)', inspector: Inspector.vector3({ step: 5 }) }),
  scale: Vector3.annotate({ title: 'Scale', inspector: Inspector.vector3({ step: 0.1 }) }),
  color: Schema.Int.annotate({ title: 'Colour', inspector: Inspector.color() }),
  spinSpeed: Schema.Finite.annotate({
    title: 'Spin (rad/s)',
    inspector: Inspector.number({ min: -10, max: 10, step: 0.1 }),
  }),
  // Edited by the Behaviour section, not the generated properties: a list of variants needs more than one widget.
  rules: Schema.Array(Rule),
});
export type Entity = typeof Entity.Type;

export const Document = Schema.Struct({ entities: Schema.Array(Entity) });
export type Document = typeof Document.Type;

const colors: Record<Shape, number> = { Box: 0x4f8cff, Sphere: 0xff6b6b };

// Where the nth entity lands: rows of five, filled from the middle outwards.
const offsets = [0, -1, 1, -2, 2];
const spacing = 2;

/** A new entity, numbered `number` from one. */
export const makeEntity = (shape: Shape, number: number): Entity => {
  const index = number - 1;
  return {
    id: `entity-${number}`,
    name: `${shape} ${number}`,
    shape,
    position: [
      (offsets[index % offsets.length] ?? 0) * spacing,
      0,
      -Math.floor(index / 5) * spacing,
    ],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: colors[shape],
    spinSpeed: 0.5,
    rules: [],
  };
};

/** The fields of an entity the Details panel shows, in order. */
export const entityProperties = Inspector.properties(Entity);
