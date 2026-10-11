import type * as Component from '#src/Component.ts';
import * as World from '#src/World.ts';

/**
 * What a player sent for a step, aimed at the entity it controls. Only the engine writes input, at the start of the step it belongs to, so a recording of a game is its first world and the input of every step after it.
 */

export type InputComponent = Component.Component<string, unknown, 'input'>;

/** An input aimed at an entity. Its value stays inside `writeInto`, made where the value's type is known, so no input can carry a value its component does not hold. */
export interface Input {
  readonly entity: World.Entity;
  readonly component: InputComponent;
  /** Its value, encoded as JSON by its component's schema, as it is sent and recorded. */
  readonly encoded: () => unknown;
  /** Writes the value into a world being stepped. */
  readonly writeInto: (draft: World.Draft) => void;
}

export const of = <Value>(
  entity: World.Entity,
  component: Component.Component<string, Value, 'input'>,
  value: Value,
): Input => ({
  entity,
  component,
  encoded: () => component.of(value).encoded(),
  writeInto: (draft) => World.write(draft, entity, component, value),
});
