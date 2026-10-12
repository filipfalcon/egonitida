import type * as Component from '#src/Component.ts';
import * as State from '#src/State.ts';

/**
 * A demand is what a player is doing with their controls, such as a stick held to the left or a trigger held halfway, written at the start of the step to the entity the player controls.
 *
 * Only the engine writes a demand, so a recording of a game is its first state and the input of every step after it. A client repeats its demands unreliably, since the newest one is all a step needs.
 */

export type DemandComponent = Component.Component<string, unknown, 'input'>;

/** A demand on an entity. Its value stays inside `writeInto`, made where the value's type is known, so no demand can carry a value its component does not hold. */
export interface Demand {
  readonly entity: State.Entity;
  readonly component: DemandComponent;
  /** Its value, encoded as JSON by its component's schema, as it is sent and recorded. */
  readonly encoded: () => unknown;
  /** Writes the value into a draft of the next state. */
  readonly writeInto: (draft: State.Draft) => void;
}

export const of = <Value>(
  entity: State.Entity,
  component: Component.Component<string, Value, 'input'>,
  value: Value,
): Demand => ({
  entity,
  component,
  encoded: () => component.of(value).encoded(),
  writeInto: (draft) => State.write(draft, entity, component, value),
});

/** `instance`, a value of a demand component, as a demand on `entity`: as a client predicting its own player steps its state with the demand it sent. */
export const fromInstance = (
  entity: State.Entity,
  instance: Component.Instance<DemandComponent>,
): Demand => ({
  entity,
  component: instance.component,
  encoded: instance.encoded,
  writeInto: (draft) =>
    instance.writeWith((component, value) => State.write(draft, entity, component, value)),
});
