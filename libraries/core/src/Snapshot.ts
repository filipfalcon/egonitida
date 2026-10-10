import { Option, Schema } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as World from '#src/World.ts';

/**
 * A world as the server sends it to its clients. Every component travels encoded by its own schema, except the local ones, which each client keeps for itself and the server never sends. A snapshot is whole and carries its tick, so a client can take any one of them, in any order, and lose some on the way.
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
  components.filter((component) => component.network !== 'local');

const codecOf = (component: Component.Any) => component.schema as Schema.Codec<unknown, unknown>;

export const encode = (world: World.World, components: ReadonlyArray<Component.Any>): string =>
  Schema.encodeSync(WireJson)({
    tick: world.tick,
    nextEntity: world.nextEntity,
    random: world.random,
    stores: Object.fromEntries(
      sent(components).map((component) => [
        component.name,
        [...(world.stores.get(component.name) ?? new Map<World.Entity, unknown>())].map(
          ([entity, value]) => [entity, Schema.encodeSync(codecOf(component))(value)] as const,
        ),
      ]),
    ),
  }) as string;

/** The store a snapshot holds for a component, decoded by its schema; `None` if any of its values does not decode. */
const decodeStore = (
  component: Component.Any,
  entries: ReadonlyArray<readonly [number, unknown]>,
): Option.Option<ReadonlyMap<World.Entity, unknown>> =>
  Option.all(
    entries.map(([entity, encoded]) =>
      Option.map(
        Schema.decodeUnknownOption(codecOf(component))(encoded),
        (value) => [entity, value] as const,
      ),
    ),
  ).pipe(Option.map((decoded) => new Map(decoded)));

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
          decodeStore(component, wire.stores[component.name] ?? []),
          (store) => [component.name, store] as const,
        ),
      ),
    ).pipe(
      Option.map((received) => {
        const stores = new Map(world.stores);
        for (const [name, store] of received) {
          stores.set(name, store);
        }
        return {
          tick: wire.tick,
          nextEntity: wire.nextEntity,
          random: wire.random,
          stores,
        };
      }),
    ),
  );
