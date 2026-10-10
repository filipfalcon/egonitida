import { Option, Schema } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as World from '#src/World.ts';

/**
 * A world as the server sends it to its clients. Every component travels encoded by its own schema, except the local ones, which each client keeps for itself, and the private ones, which the server keeps for itself. A snapshot is whole and carries its tick, so a client can take any one of them, in any order, and lose some on the way.
 *
 * It is JSON for now; a binary encoding waits until something real measures it.
 */

const Wire = Schema.Struct({
  tick: Schema.Int,
  nextEntity: Schema.Int,
  random: Schema.Int,
  stores: Schema.Record(Schema.String, Schema.Array(Schema.Tuple([Schema.Int, Schema.Unknown]))),
});
const WireJson = Schema.fromJsonString(Wire);

const sent = (components: ReadonlyArray<Component.Any>) =>
  components.filter(
    (component) => component.network === 'server' || component.network === 'predicted',
  );

export const encode = (world: World.World, components: ReadonlyArray<Component.Any>): string =>
  Schema.encodeSync(WireJson)({
    tick: world.tick,
    nextEntity: world.nextEntity,
    random: world.random,
    stores: Object.fromEntries(
      sent(components).map((component) => [
        component.name,
        component.encode(world.stores.get(component.name)),
      ]),
    ),
  });

/**
 * `world` with every sent component replaced by the snapshot's, and its local components kept. A snapshot that does not decode, in any part, changes nothing: `None`.
 */
export const apply = (
  world: World.World,
  text: string,
  components: ReadonlyArray<Component.Any>,
): Option.Option<World.World> =>
  Option.flatMap(Schema.decodeOption(WireJson)(text), (wire) =>
    Option.all(
      sent(components).map((component) =>
        Option.map(
          component.decode(wire.stores[component.name] ?? []),
          (store) => [component.name, store] as const,
        ),
      ),
    ).pipe(
      Option.map((received) => ({
        tick: wire.tick,
        nextEntity: wire.nextEntity,
        random: wire.random,
        stores: new Map([...world.stores, ...received]),
      })),
    ),
  );
