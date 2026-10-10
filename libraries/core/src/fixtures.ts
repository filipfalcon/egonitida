import { Schema } from 'effect';
import * as Action from '#src/Action.ts';
import * as Component from '#src/Component.ts';
import * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Plugin from '#src/Plugin.ts';

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

/** Everything the small game is made of, as one plugin with no parts of its own. */
export const Fixture = Plugin.make({
  name: 'Fixture',
  requires: [],
  components: [Position, Velocity, Health, Controls, Splat, Wall],
  actions: [ChoseRestart],
  events: [Bitten, Died],
  systems: [],
  rules: [],
});

/** The small game at ten steps a second, for a test to give the parts it is about with `Game.only`. */
export const fixture = Game.make({ stepRate: 10, plugins: [Fixture] });
