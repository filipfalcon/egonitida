import { Option, Schema } from 'effect';
import type * as Game from '#src/Game.ts';
import * as World from '#src/World.ts';

/**
 * A world as the server sends it to its clients: the game's world schema, over only the components that travel. Local components each client keeps for itself, and private ones the server keeps for itself. A snapshot is whole and carries its tick, so a client can take any one of them, in any order, and lose some on the way.
 *
 * It is JSON for now; a binary encoding waits until something real measures it.
 */

interface Wire {
  /** The names of the components that travel. */
  readonly sent: ReadonlySet<string>;
  readonly json: Schema.Codec<World.World, string>;
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
    json: Schema.fromJsonString(World.schema(sent)),
  };
  wires.set(game, wire);
  return wire;
};

export const encode = (world: World.World, game: Game.Game): string =>
  Schema.encodeSync(wireOf(game).json)(world);

/**
 * `world` with every component that travels replaced by the snapshot's, including any the snapshot no longer holds, and the rest kept, with the ids of the entities the client spawned for itself. A snapshot that does not decode, in any part, changes nothing: `None`.
 */
export const apply = (
  world: World.World,
  text: string,
  game: Game.Game,
): Option.Option<World.World> => {
  const wire = wireOf(game);
  return Option.map(Schema.decodeOption(wire.json)(text), (received) => ({
    ...received,
    // Its own entities' ids are the client's to keep counting.
    nextLocal: world.nextLocal,
    stores: new Map([
      ...[...world.stores].filter(([name]) => !wire.sent.has(name)),
      ...received.stores,
    ]),
  }));
};
