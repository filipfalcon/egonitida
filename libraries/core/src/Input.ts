import type * as Component from '#src/Component.ts';
import * as State from '#src/State.ts';

/**
 * What a player sent for a step, aimed at the entity it controls. Only the engine writes input, at the start of the step it belongs to, so a recording of a game is its first state and the input of every step after it.
 */

export type InputComponent = Component.Component<string, unknown, 'input'>;

/** An input aimed at an entity. Its value stays inside `writeInto`, made where the value's type is known, so no input can carry a value its component does not hold. */
export interface Input {
  readonly entity: State.Entity;
  readonly component: InputComponent;
  /** Its value, encoded as JSON by its component's schema, as it is sent and recorded. */
  readonly encoded: () => unknown;
  /** Writes the value into a draft of the next state. */
  readonly writeInto: (draft: State.Draft) => void;
}

export const of = <Value>(
  entity: State.Entity,
  component: Component.Component<string, Value, 'input'>,
  value: Value,
): Input => ({
  entity,
  component,
  encoded: () => component.of(value).encoded(),
  writeInto: (draft) => State.write(draft, entity, component, value),
});

/** `instance`, a value of an input component, as an input aimed at `entity`: as a client predicting its own player steps its state with the input it sent. */
export const fromInstance = (
  entity: State.Entity,
  instance: Component.Instance<InputComponent>,
): Input => ({
  entity,
  component: instance.component,
  encoded: instance.encoded,
  writeInto: (draft) =>
    instance.writeWith((component, value) => State.write(draft, entity, component, value)),
});
