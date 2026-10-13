import { Option, Schema } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Game from '#src/Game.ts';
import * as State from '#src/State.ts';

/**
 * A state as the host sends it to a client: the host's output for that client, y = h(x), in the game's state schema. Today h is the same for every client: the state without its local components, which each client keeps for itself, and its private ones, which the host keeps for itself. A snapshot is whole and carries its tick, so a client can take any one of them, in any order, and lose some on the way.
 *
 * It carries its era too: a host that goes back in time, or shows its clients a past state, starts a new era, so a client tells a state it is meant to go back to from one that arrived late.
 *
 * It is JSON for now; a binary encoding waits until something real measures it.
 */

/** A state as it is sent, with the era it belongs to. */
export interface Sent {
  readonly era: number;
  readonly state: State.State;
}

interface Wire {
  /** The names of the components that travel. */
  readonly sent: ReadonlySet<string>;
  readonly json: Schema.Codec<Sent, string>;
}

// A game's wire is made once and kept, since a host encodes with it every step.
const wires = new WeakMap<Game.Game, Wire>();

const wireOf = (game: Game.Game): Wire => {
  const known = wires.get(game);
  if (known !== undefined) {
    return known;
  }
  const sent = game.components.filter(
    (component) => component.network === 'server' || component.network === 'predicted',
  );
  const wire: Wire = {
    sent: new Set(sent.map((component) => component.name)),
    json: Schema.fromJsonString(Schema.Struct({ era: Schema.Int, state: State.schema(sent) })),
  };
  wires.set(game, wire);
  return wire;
};

/** `state` as `game` sends it, in `era`, the first unless given. */
export const encode = (state: State.State, game: Game.Game, era = 0): string =>
  Schema.encodeSync(wireOf(game).json)({ era, state });

/** `store` without what it holds on entities of the server's that `held` does not have: what a client kept on an entity goes with it. */
const keptOn = (store: Component.Store, held: ReadonlySet<State.Entity>): Component.Store =>
  [...store.entities()]
    .filter((entity) => !State.isLocal(entity) && !held.has(entity))
    .reduce((kept, gone) => kept.without(gone), store);

/**
 * The era a snapshot belongs to, and `state` with every component that travels replaced by the snapshot's, including any the snapshot no longer holds, and the rest kept, with the ids of the entities the client spawned for itself. What the client keeps on an entity of the server's that the snapshot no longer holds goes with it. A snapshot that does not decode, in any part, changes nothing: `None`.
 */
export const apply = (state: State.State, text: string, game: Game.Game): Option.Option<Sent> => {
  const wire = wireOf(game);
  return Option.map(Schema.decodeOption(wire.json)(text), ({ era, state: received }) => {
    const held = new Set([...received.stores.values()].flatMap((store) => [...store.entities()]));
    const merged: State.State = {
      ...received,
      // Its own entities' ids are the client's to keep counting.
      nextLocal: state.nextLocal,
      stores: new Map([
        ...[...state.stores]
          .filter(([name]) => !wire.sent.has(name))
          .map(([name, store]) => [name, keptOn(store, held)] as const),
        ...received.stores,
      ]),
    };
    return { era, state: merged };
  });
};
