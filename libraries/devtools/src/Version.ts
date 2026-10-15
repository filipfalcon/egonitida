import type { Game } from '@egonitida/core';
import { Option, Schema } from 'effect';

/**
 * Which code of a game played: the build its bundler named, if it named one, and its state's schema, a hash for each component. A recording holds for one version alone, x′ = f_v(x, u): replayed by another, a step that comes apart says the code changed, not that the game is not deterministic. The build tells every change to the code apart, even one that leaves every schema as it was; the schema tells which components a change touched.
 */
export const Version = Schema.Struct({
  build: Schema.OptionFromOptionalKey(Schema.String),
  /** A hash of each component's schema, owner, and network role, by its name. */
  components: Schema.Record(Schema.String, Schema.String),
});
export type Version = typeof Version.Type;

/** `value` as JSON whose objects list their keys in order, so the same value always reads the same. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, held: unknown) =>
    typeof held === 'object' && held !== null && !Array.isArray(held)
      ? Object.fromEntries(Object.entries(held).toSorted(([a], [b]) => a.localeCompare(b)))
      : held,
  );

/** A 32-bit hash of `text` (FNV-1a), in hexadecimal. */
const hash = (text: string): string => {
  let hashed = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hashed = Math.imul(hashed ^ text.charCodeAt(index), 0x01000193);
  }
  return (hashed >>> 0).toString(16).padStart(8, '0');
};

/** The version of `game`, as the build `build` of its code. */
export const of = (game: Game.Game, build: Option.Option<string>): Version => ({
  build,
  components: Object.fromEntries(
    game.components.map((component) => [
      component.name,
      hash(
        canonical({
          schema: Schema.toJsonSchemaDocument(Schema.toCodecJson(component.schema)),
          owner: component.owner,
          network: component.network,
        }),
      ),
    ]),
  ),
});

/** How a recording's version and the one replaying it differ: both, and the components whose schemas differ, added or taken away among them. */
export interface Mismatch {
  readonly recorded: Version;
  readonly replayed: Version;
  readonly changed: ReadonlyArray<string>;
}

/** How `replayed` differs from `recorded`, if it does. Two builds named alike are the same code; two unnamed are told apart by their schemas alone, the most that can be known of them. */
export const mismatch = (recorded: Version, replayed: Version): Option.Option<Mismatch> => {
  const names = [
    ...new Set([...Object.keys(recorded.components), ...Object.keys(replayed.components)]),
  ];
  const changed = names.filter((name) => recorded.components[name] !== replayed.components[name]);
  const same = Option.match(recorded.build, {
    onNone: () => Option.isNone(replayed.build) && changed.length === 0,
    onSome: (build) => Option.contains(replayed.build, build),
  });
  return same ? Option.none() : Option.some({ recorded, replayed, changed });
};

const buildText = (build: Option.Option<string>) =>
  Option.match(build, { onNone: () => 'an unnamed build', onSome: (id) => `build ${id}` });

/** `mismatch` in words: what recorded, what replays, and which components changed. */
export const told = (found: Mismatch): string =>
  `recorded by ${buildText(found.recorded.build)}, replayed by ${buildText(found.replayed.build)} (${
    found.changed.length === 0
      ? 'no component changed'
      : `changed components: ${found.changed.join(', ')}`
  })`;
