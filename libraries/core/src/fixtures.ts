import { Option, Schema } from 'effect';
import * as Action from '#src/Action.ts';
import * as Component from '#src/Component.ts';
import * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Plugin from '#src/Plugin.ts';
import * as Rule from '#src/Rule.ts';

/**
 * A small game the core's tests share: things that move, and a player whose health the rules keep.
 */

export const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});

export const Velocity = Component.make('Velocity', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});

export const Health = Component.make('Health', Schema.Struct({ current: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

export const Controls = Component.make(
  'Controls',
  Schema.Struct({ move: Schema.Finite, fire: Schema.Boolean }),
  { owner: 'input', network: 'predicted' },
);

/** A blood splat: drawn by each client for itself, never sent. */
export const Splat = Component.make('Splat', Schema.Struct({ size: Schema.Finite }), {
  owner: 'simulation',
  network: 'local',
});

export const Bitten = Event.make('Bitten', { entity: Schema.Int, damage: Schema.Int });

export const Died = Event.make('Died', { entity: Schema.Int });

/** A player chose to be put back at the start, at a given place. */
export const ChoseRestart = Action.make('ChoseRestart', { x: Schema.Finite });

/** The lab's walls: on the server only, since every client builds the same ones itself. */
export const Wall = Component.make('Wall', Schema.Struct({ x: Schema.Finite }), {
  owner: 'rules',
  network: 'private',
});

/** A bite takes from health, and one that takes the last of it is a death. */
export const takeBite = Rule.on(Bitten, {
  writes: [Health],
  emits: [Died],
  run: (context, bitten) => {
    const health = Option.getOrElse(context.get(bitten.entity, Health), () => ({ current: 0 }));
    const current = health.current - bitten.damage;
    context.set(bitten.entity, Health, { current });
    if (current <= 0 && health.current > 0) {
      context.emit({ _tag: 'Died', entity: bitten.entity });
    }
  },
});

/** A player who chose to restart is healed whole. */
export const restart = Rule.on(ChoseRestart, {
  writes: [Health],
  emits: [],
  run: (context, restarted) => {
    context.set(restarted.player, Health, { current: 100 });
  },
});

/** Everything the small game is made of, as one plugin answering its own actions and events, with no systems: a test gives the ones it is about. */
export const Fixture = Plugin.make({
  name: 'Fixture',
  requires: [],
  components: [Position, Velocity, Health, Controls, Splat, Wall],
  actions: [ChoseRestart],
  events: [Bitten, Died],
  systems: [],
  rules: [takeBite, restart],
});

/** The small game at ten steps a second, for a test to give the parts it is about with `Game.only`. */
export const fixture = Game.make({ stepRate: 10, plugins: [Fixture] });
