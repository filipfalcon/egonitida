import { Domain, Game, Pointing, Rule, State } from '@lightocean/core';
import { Option, Schema } from 'effect';
import * as Objects from '#src/objects.ts';

/**
 * A document playing: a click on an object carries out its reactions, in order, each on the object itself or on another, by the events of the `Objects` domain. The game it plays in has no editing in it, so while a document plays, nothing in it is edited. It plays in a worker of its own, which starts from the document as the editor has it, handed over as the worker's opening.
 */

// RULES

/** A click on an object carries out each of its reactions, on whom the reaction names. */
const react = Rule.on(Pointing.Clicked, {
  reads: [Objects.Behaviour],
  writes: [],
  emits: [Objects.Recoloured, Objects.Moved, Objects.SpinChanged],
  run: (context, { entity }) => {
    Option.map(context.get(entity, Objects.Behaviour), ({ reactions }) => {
      for (const { target, change } of reactions) {
        const on = target._tag === 'Itself' ? entity : target.entity;
        switch (change._tag) {
          case 'Recolour':
            context.emit({ _tag: 'Recoloured', entity: on, hex: change.hex });
            break;
          case 'MoveBy':
            context.emit({ _tag: 'Moved', entity: on, offset: change.offset });
            break;
          case 'SetSpin':
            context.emit({ _tag: 'SpinChanged', entity: on, speed: change.speed });
            break;
        }
      }
    });
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Playing',
  requires: [Pointing.domain, Objects.domain],
  components: [],
  actions: [],
  events: [],
  systems: [],
  rules: [react],
});

/** A document playing: its objects, and clicks that make them react. */
export const game = Game.make({
  stepRate: 30,
  domains: [Pointing.domain, Objects.domain, domain],
});

/** A state of this game as text, without what only a client keeps: what a worker playing a document is opened with. */
const Opened = Schema.fromJsonString(
  State.schema(game.components.filter(({ network }) => network !== 'local')),
);

/** The document `edited` as a worker playing it is opened with: its objects as they are, each by its own id, so reactions still find their targets, and nothing of what only editing keeps, which this game does not hold. */
export const opening = (edited: State.State): string => Schema.encodeSync(Opened)(edited);

/** The state a worker plays, from what it was opened with; none if that is not a document. */
export const fromOpening = (opening: string): Option.Option<State.State> =>
  Schema.decodeOption(Opened)(opening);
