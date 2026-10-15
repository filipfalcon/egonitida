import type { State } from '@nitida/core';
import { Context, Effect, Option } from 'effect';

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

/** How hard a device's strong, slow motor and its weak, quick one turn, from 0 to 1. */
export interface Motors {
  readonly strong: number;
  readonly weak: number;
}

/** Motors that do not turn. */
export const stillMotors: Motors = { strong: 0, weak: 0 };

/** A rumble under way: what was asked, and how long ago. */
export interface Pulse {
  readonly rumble: Rumble;
  readonly age: number;
}

/** `pulses` with `rumble` begun among them. */
export const added = (pulses: ReadonlyArray<Pulse>, rumble: Rumble): ReadonlyArray<Pulse> => [
  ...pulses,
  { rumble, age: 0 },
];

/** `pulses` `seconds` on, those over let go, and how hard the motors turn for them: as hard as the strongest, each fading evenly to nothing as it goes, so rumbles at once add up to the strongest of them rather than the latest. */
export const mixed = (
  pulses: ReadonlyArray<Pulse>,
  seconds: number,
): { readonly pulses: ReadonlyArray<Pulse>; readonly motors: Motors } => {
  const going = pulses
    .map(({ rumble, age }) => ({ rumble, age: age + seconds }))
    .filter(({ rumble, age }) => age < rumble.seconds);
  const motors = going.reduce((turning, { rumble, age }) => {
    const left = 1 - age / rumble.seconds;
    return {
      strong: Math.max(turning.strong, rumble.strong * left),
      weak: Math.max(turning.weak, rumble.weak * left),
    };
  }, stillMotors);
  return { pulses: going, motors };
};

/** A device that can be felt, as much as it can: its motors turned, until turned otherwise, and its triggers set. */
export interface Felt {
  readonly motors: (motors: Motors) => Effect.Effect<void>;
  readonly triggers: (triggers: Triggers) => Effect.Effect<void>;
}

/** Making things felt by the player of an entity, for views to use. */
export class Haptics extends Context.Service<
  Haptics,
  {
    /** Rumbles what the player of `entity` holds, beside whatever else rumbles it now. */
    readonly rumble: (entity: State.Entity, rumble: Rumble) => Effect.Effect<void>;
    /** Stops every rumble of what the player of `entity` holds, at once, such as when the game is paused. */
    readonly silence: (entity: State.Entity) => Effect.Effect<void>;
    /** Sets how the triggers the player of `entity` holds push back, until they are set again. */
    readonly triggers: (entity: State.Entity, triggers: Triggers) => Effect.Effect<void>;
  }
>()('@nitida/client/Haptics') {}

/** Whether `a` and `b` push back alike. */
const sameTrigger = (a: Trigger, b: Trigger): boolean => {
  switch (a._tag) {
    case 'Free':
      return b._tag === 'Free';
    case 'Resisting':
      return b._tag === 'Resisting' && a.from === b.from && a.strength === b.strength;
    case 'Clicking':
      return (
        b._tag === 'Clicking' && a.from === b.from && a.to === b.to && a.strength === b.strength
      );
  }
};

/** Haptics for a page whose player is `player`, felt on the devices `felt` gives at that moment. Its rumbles are mixed and turn the motors as the page's frames go, by `frame`, which the page calls every frame with the seconds since the one before; a device's motors are turned, and its triggers set, only when they are otherwise, so a view may ask every frame; and `again` sets them all as last asked, so a device connected since is set as the rest. */
export const make = (options: {
  readonly player: State.Entity;
  readonly felt: () => ReadonlyArray<Felt>;
}): Haptics['Service'] & {
  readonly frame: (seconds: number) => Effect.Effect<void>;
  readonly again: Effect.Effect<void>;
} => {
  const playing: {
    pulses: ReadonlyArray<Pulse>;
    turning: Motors;
    triggers: Option.Option<Triggers>;
  } = {
    pulses: [],
    turning: stillMotors,
    triggers: Option.none(),
  };
  /** Sets every device's triggers `triggers`. */
  const set = (triggers: Triggers) =>
    Effect.suspend(() => {
      playing.triggers = Option.some(triggers);
      return Effect.forEach(options.felt(), (device) => device.triggers(triggers), {
        discard: true,
      });
    });
  /** Turns every device's motors `motors`, unless they turn so already. */
  const turn = (motors: Motors) =>
    Effect.suspend(() => {
      if (motors.strong === playing.turning.strong && motors.weak === playing.turning.weak) {
        return Effect.void;
      }
      playing.turning = motors;
      return Effect.forEach(options.felt(), (device) => device.motors(motors), { discard: true });
    });
  return {
    rumble: (entity, rumble) =>
      entity === options.player
        ? Effect.sync(() => {
            playing.pulses = added(playing.pulses, rumble);
          })
        : Effect.void,
    silence: (entity) =>
      entity === options.player
        ? Effect.suspend(() => {
            playing.pulses = [];
            return turn(stillMotors);
          })
        : Effect.void,
    triggers: (entity, triggers) =>
      entity === options.player &&
      !Option.exists(
        playing.triggers,
        (now) => sameTrigger(now.left, triggers.left) && sameTrigger(now.right, triggers.right),
      )
        ? set(triggers)
        : Effect.void,
    again: Effect.suspend(() =>
      Option.match(playing.triggers, { onNone: () => Effect.void, onSome: set }),
    ),
    frame: (seconds) =>
      Effect.suspend(() => {
        const next = mixed(playing.pulses, seconds);
        playing.pulses = next.pulses;
        return turn(next.motors);
      }),
  };
};
