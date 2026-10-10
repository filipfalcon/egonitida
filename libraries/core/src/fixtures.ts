import { Schema } from 'effect';
import * as Component from '#src/Component.ts';
import * as Event from '#src/Event.ts';

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

export const Bitten = Event.make('Bitten', { entity: Schema.Int, damage: Schema.Int });

export const Died = Event.make('Died', { entity: Schema.Int });
