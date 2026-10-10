import type * as Component from '#src/Component.ts';
import type { Entity } from '#src/World.ts';

/**
 * What a player sent for a step, aimed at the entity it controls. Only the engine writes input, at the start of the step it belongs to, so a recording of a game is its first world and the input of every step after it.
 */

// oxlint-disable-next-line typescript/no-explicit-any
export type InputComponent = Component.Component<string, any, 'input'>;

export interface Input {
  readonly entity: Entity;
  readonly component: InputComponent;
  readonly value: unknown;
}

export const of = <C extends InputComponent>(
  entity: Entity,
  component: C,
  value: Component.ValueOf<C>,
): Input => ({ entity, component, value });
