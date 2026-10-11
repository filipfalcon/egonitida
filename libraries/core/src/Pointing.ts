import { Schema } from 'effect';
import * as Action from '#src/Action.ts';
import * as Component from '#src/Component.ts';
import * as Domain from '#src/Domain.ts';

/**
 * Pointing at things in a world, as the engine gives it: an entity with a `Label` can be clicked, and a click on one is the action `Clicked`, whatever the player clicked with, a pointer, a touch, or a key on the accessible mirror of the scene. A game that requires this domain answers `Clicked` with its own rules, which decide what a click on each kind of entity does.
 *
 * The label is also what the entity is read out as, so whatever can be clicked can be reached without a pointer.
 */

// COMPONENTS

/** What an entity is read out as; holding one, the entity can be clicked. */
export const Label = Component.make('Label', Schema.Struct({ text: Schema.String }), {
  owner: 'rules',
  network: 'server',
});

// ACTIONS

/** The player clicked an entity. */
export const Clicked = Action.make('Clicked', { entity: Schema.Int });

// DOMAIN

export const domain = Domain.make({
  name: 'Pointing',
  requires: [],
  components: [Label],
  actions: [Clicked],
  events: [],
  systems: [],
  rules: [],
});
