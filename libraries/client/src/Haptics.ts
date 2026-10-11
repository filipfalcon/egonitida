import type { World } from '@lightocean/core';
import { Context, Effect } from 'effect';

/**
 * What a player feels through what they hold: a rumble of a pad's motors, a moment such as a hit, and its triggers pushing back, set as something comes to hold, such as a gun being drawn. Views make it felt through the `Haptics` service, for an entity, and only the page whose player that entity is makes it felt; each device is felt as it can be, through the Gamepad API or a WebHID driver, and a device that cannot is left still.
 */

/** A rumble: how hard the strong, slow motor and the weak, quick one turn, from 0 to 1, and for how long. */
export interface Rumble {
  readonly strong: number;
  readonly weak: number;
  readonly seconds: number;
}

/** How a trigger pushes back: not at all; from a point of its travel on, with a strength; or as a gun's trigger does, over a stretch of its travel and giving way after it. Points and strengths run from 0 to 1. */
export type Trigger =
  | { readonly _tag: 'Free' }
  | { readonly _tag: 'Resisting'; readonly from: number; readonly strength: number }
  | {
      readonly _tag: 'Clicking';
      readonly from: number;
      readonly to: number;
      readonly strength: number;
    };

/** Both triggers. */
export interface Triggers {
  readonly left: Trigger;
  readonly right: Trigger;
}

/** A trigger that does not push back. */
export const free: Trigger = { _tag: 'Free' };

/** Triggers that do not push back. */
export const freeTriggers: Triggers = { left: free, right: free };

/** A device that can be felt, as much as it can: a rumble, and its triggers set. */
export interface Felt {
  readonly rumble: (rumble: Rumble) => Effect.Effect<void>;
  readonly triggers: (triggers: Triggers) => Effect.Effect<void>;
}

/** Making things felt by the player of an entity, for views to use. */
export class Haptics extends Context.Service<
  Haptics,
  {
    /** Rumbles what the player of `entity` holds. */
    readonly rumble: (entity: World.Entity, rumble: Rumble) => Effect.Effect<void>;
    /** Sets how the triggers the player of `entity` holds push back, until they are set again. */
    readonly triggers: (entity: World.Entity, triggers: Triggers) => Effect.Effect<void>;
  }
>()('@lightocean/client/Haptics') {}

/** Haptics for a page whose player is `player`, felt on the devices `felt` gives at that moment. */
export const make = (options: {
  readonly player: World.Entity;
  readonly felt: () => ReadonlyArray<Felt>;
}): Haptics['Service'] => {
  /** Does `feel` to every device, if `entity` is the player's. */
  const feelFor = (entity: World.Entity, feel: (device: Felt) => Effect.Effect<void>) =>
    entity === options.player
      ? Effect.suspend(() => Effect.forEach(options.felt(), feel, { discard: true }))
      : Effect.void;
  return {
    rumble: (entity, rumble) => feelFor(entity, (device) => device.rumble(rumble)),
    triggers: (entity, triggers) => feelFor(entity, (device) => device.triggers(triggers)),
  };
};
