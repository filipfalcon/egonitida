import type { World } from '@lightocean/core';
import { Context, Effect, Option } from 'effect';

/**
 * The lights of what a player holds and plays on, a pad's lightbar or a keyboard's and a mouse's RGB, lit from the state of the game the way the scene is drawn from it. Views light them through the `Lighting` service, for an entity, and only the page whose player that entity is lights anything; each device is lit as it can be, through a WebHID driver or a vendor's own software, such as Razer's Chroma, and a device that cannot is left as it is.
 */

/** A colour, by how much of each of red, green, and blue it has, from 0 to 1. */
export interface Colour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** A device that can be lit: all its lights one colour, and as many of its player lights as asked, if it has any, such as the five on a DualSense; one with none leaves them be. */
export interface Lit {
  readonly colour: (colour: Colour) => Effect.Effect<void>;
  readonly players: (count: number) => Effect.Effect<void>;
}

/** Lighting what the player of an entity holds and plays on, for views to use. */
export class Lighting extends Context.Service<
  Lighting,
  {
    /** Lights what the player of `entity` holds and plays on `colour`, until it is lit again. */
    readonly colour: (entity: World.Entity, colour: Colour) => Effect.Effect<void>;
    /** Lights `count` of the player lights of what the player of `entity` holds, such as how much health is left, until they are lit again. */
    readonly players: (entity: World.Entity, count: number) => Effect.Effect<void>;
  }
>()('@lightocean/client/Lighting') {}

/** Lighting for a page whose player is `player`, lit on the devices `lit` gives at that moment; and lighting them all `again` as last asked, so a device connected since is lit as the rest. */
export const make = (options: {
  readonly player: World.Entity;
  readonly lit: () => ReadonlyArray<Lit>;
}): Lighting['Service'] & { readonly again: Effect.Effect<void> } => {
  const latest = { colour: Option.none<Colour>(), players: Option.none<number>() };
  const light = (colour: Colour) =>
    Effect.suspend(() => {
      latest.colour = Option.some(colour);
      return Effect.forEach(options.lit(), (device) => device.colour(colour), { discard: true });
    });
  const lightPlayers = (count: number) =>
    Effect.suspend(() => {
      latest.players = Option.some(count);
      return Effect.forEach(options.lit(), (device) => device.players(count), { discard: true });
    });
  return {
    colour: (entity, colour) => (entity === options.player ? light(colour) : Effect.void),
    players: (entity, count) => (entity === options.player ? lightPlayers(count) : Effect.void),
    again: Effect.andThen(
      Effect.suspend(() =>
        Option.match(latest.colour, { onNone: () => Effect.void, onSome: light }),
      ),
      Effect.suspend(() =>
        Option.match(latest.players, { onNone: () => Effect.void, onSome: lightPlayers }),
      ),
    ),
  };
};
