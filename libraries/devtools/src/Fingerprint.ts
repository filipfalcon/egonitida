import type { Game, World } from '@lightocean/core';
import { Option, Schema } from 'effect';

/**
 * A world, told in a few numbers: its tick, the state of its randomness, its next entity, and a hash of each component's values. Two worlds with the same fingerprint hold the same; where two fingerprints differ, they tell which component, so a replay that comes apart says where.
 */

export const Fingerprint = Schema.Struct({
  tick: Schema.Int,
  random: Schema.Int,
  nextEntity: Schema.Int,
  /** A hash of each component's values, by its name, for the components the world holds. */
  components: Schema.Record(Schema.String, Schema.Int),
});
export type Fingerprint = typeof Fingerprint.Type;

/** Where two worlds differ: in one of their own numbers, or in a component's values. */
export type Difference =
  | { readonly _tag: 'World'; readonly field: 'tick' | 'random' | 'nextEntity' }
  | { readonly _tag: 'Component'; readonly name: string };

/** The 32-bit FNV-1a hash of `text`. */
const hash = (text: string): number => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  }
  return value >>> 0;
};

/** The fingerprint of `world`, its values encoded by `game`'s components in the order of their entities, so the order they were set in does not count. */
export const of = (game: Game.Game, world: World.World): Fingerprint => ({
  tick: world.tick,
  random: world.random,
  nextEntity: world.nextEntity,
  components: Object.fromEntries(
    game.components.flatMap((component) => {
      const store = world.stores.get(component.name);
      const values = component.encode(store).toSorted(([a], [b]) => a - b);
      return store === undefined || values.length === 0
        ? []
        : [[component.name, hash(JSON.stringify(values))]];
    }),
  ),
});

type Field = Extract<Difference, { readonly _tag: 'World' }>['field'];
const FIELDS: ReadonlyArray<Field> = ['tick', 'random', 'nextEntity'];

/** The first place `recorded` and `replayed` differ: their own numbers first, then their components in the order `recorded` holds them. */
export const difference = (
  recorded: Fingerprint,
  replayed: Fingerprint,
): Option.Option<Difference> =>
  Option.orElse(
    Option.map(
      Option.fromNullishOr(FIELDS.find((field) => recorded[field] !== replayed[field])),
      (field): Difference => ({ _tag: 'World', field }),
    ),
    () =>
      Option.map(
        Option.fromNullishOr(
          [...Object.keys(recorded.components), ...Object.keys(replayed.components)].find(
            (name) => recorded.components[name] !== replayed.components[name],
          ),
        ),
        (name): Difference => ({ _tag: 'Component', name }),
      ),
  );
