import { Option, Schema } from 'effect';
import * as Action from '#src/Action.ts';
import * as Component from '#src/Component.ts';
import * as Domain from '#src/Domain.ts';
import * as Event from '#src/Event.ts';
import * as Rule from '#src/Rule.ts';

/**
 * Pointing at things in a game, as the engine gives it: an entity with a `Label` can be clicked, and a click on one is the action `Clicked`, whatever the player clicked with, a pointer, a touch, or a key on the accessible mirror of the scene. A game that requires this domain handles `Clicked` with its own rules, which decide what a click on each kind of entity does.
 *
 * The label is also what the entity is read out as, so whatever can be clicked can be reached without a pointer. Another domain changes a label only by `Relabelled`, such as an editor renaming what it edits.
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

// EVENTS

/** An entity is to be read out as `text` from now on. */
export const Relabelled = Event.make('Relabelled', { entity: Schema.Int, text: Schema.String });

// RULES

/** A labelled entity relabelled is read out by its new label; one with no label stays without, as only a label makes an entity clickable. */
const relabel = Rule.on(Relabelled, {
  writes: [Label],
  emits: [],
  run: (context, { entity, text }) => {
    if (Option.isSome(context.get(entity, Label))) {
      context.set(entity, Label, { text });
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Pointing',
  requires: [],
  components: [Label],
  actions: [Clicked],
  events: [Relabelled],
  systems: [],
  rules: [relabel],
});
