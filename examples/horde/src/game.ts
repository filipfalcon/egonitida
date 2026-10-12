import { Game, State } from '@lightocean/core';
import * as Body from '#src/body.ts';
import * as Horde from '#src/horde.ts';
import * as Survivor from '#src/survivor.ts';

/**
 * The fourth example: survivors in an arena against a horde that keeps rising. Small as it is, it holds what a game is made of: domains requiring one another and sharing where bodies are, demands and actions, events between domains, randomness, and entities spawned and despawned. Its views are in `survivor.view.ts` and `horde.view.ts`.
 */

/** Survivors walk first, the horde follows them, and every body is then kept within the arena. */
export const game = Game.make({
  stepRate: 60,
  domains: [Survivor.domain, Horde.domain, Body.domain],
});

/** The arena before anyone has joined: empty, but for when the next zombie rises. */
export const [state] = State.spawn(State.empty({ seed: 1 }), [Horde.Tide.of({ nextAt: 0 })]);
