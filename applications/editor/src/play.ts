import { Schema } from 'effect';
import { type Action, type Document, Entity, SELF } from '#src/document.ts';

/**
 * The program a document becomes when it plays: the world is its Model, a world event is its Message, and the entities' rules are its update.
 */

export const WorldEvent = Schema.TaggedStruct('ClickedEntity', { id: Schema.String });
export type WorldEvent = typeof WorldEvent.Type;

const apply = (entity: Entity, action: Action): Entity => {
  switch (action._tag) {
    case 'SetColor':
      return { ...entity, color: action.color };
    case 'MoveBy':
      return {
        ...entity,
        position: [
          entity.position[0] + action.offset[0],
          entity.position[1] + action.offset[1],
          entity.position[2] + action.offset[2],
        ],
      };
    case 'SetSpin':
      return { ...entity, spinSpeed: action.speed };
  }
};

/** The world after `event`: every rule of the clicked entity, applied in order to its target. */
export const step = (world: Document, event: WorldEvent): Document => {
  const clicked = world.entities.find((entity) => entity.id === event.id);
  if (clicked === undefined || clicked.rules.length === 0) {
    return world;
  }
  return {
    entities: clicked.rules.reduce((entities, rule) => {
      const targetId = rule.target === SELF ? clicked.id : rule.target;
      return entities.map((entity) =>
        entity.id === targetId ? apply(entity, rule.action) : entity,
      );
    }, world.entities),
  };
};

export interface Change {
  readonly entityId: string;
  readonly entityName: string;
  readonly key: string;
}

const entityKeys = Object.keys(Entity.fields).filter((key) => key !== 'id');

// Entity values are plain data, so their JSON is a faithful structural comparison.
const differs = (before: unknown, after: unknown) =>
  JSON.stringify(before) !== JSON.stringify(after);

/** Each property that differs between two worlds, entity by entity, in field order. */
export const changes = (before: Document, after: Document): ReadonlyArray<Change> =>
  after.entities.flatMap((entity) => {
    const previous = before.entities.find((candidate) => candidate.id === entity.id);
    return previous === undefined
      ? []
      : entityKeys
          .filter((key) => differs(previous[key as keyof Entity], entity[key as keyof Entity]))
          .map((key) => ({ entityId: entity.id, entityName: entity.name, key }));
  });
