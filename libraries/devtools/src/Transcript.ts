import { Game, Story, type State } from '@nitida/core';
import { Result, Schema } from 'effect';
import type * as Recording from '#src/Recording.ts';
import type * as Replay from '#src/Replay.ts';

/**
 * A stretch of a recording told as a story test: the state at its first tick, the input of each step after it, and, at its end, every value that came of them. It is told with components and actions by name, as a tool that knows a game only as data tells it, and it holds when told again with the game itself; so what an agent did while playing becomes a test.
 *
 * A stretch in which a player joined or left, or the host went back in time, cannot be told, since a story has no part for them: it must start after them, or end before.
 */

/** One part of a story, as it is told. */
export type Line =
  | {
      readonly _tag: 'GivenAs';
      readonly state: unknown;
      readonly names: Readonly<Record<string, State.Entity>>;
    }
  | {
      readonly _tag: 'DemandAs';
      readonly name: string;
      readonly component: string;
      readonly value: unknown;
    }
  | { readonly _tag: 'ActAs'; readonly name: string; readonly action: unknown }
  | { readonly _tag: 'ResolveAs'; readonly result: unknown }
  | { readonly _tag: 'Steps'; readonly count: number }
  | {
      readonly _tag: 'ExpectAs';
      readonly name: string;
      readonly component: string;
      readonly value: unknown;
    }
  | { readonly _tag: 'ExpectNoneAs'; readonly name: string; readonly component: string };

const nameOf = (entity: State.Entity) => `e${entity}`;

/** The values of `state` by component name, then by entity, as `game` encodes them. */
const valuesOf = (game: Game.Game, state: State.State) =>
  new Map(
    game.components.map((component) => [
      component.name,
      new Map(component.encode(state.stores.get(component.name))),
    ]),
  );

/** The input of one step, told by name: its demands, then its actions, each a player's or a command's result. */
const stepLines = (actionTags: ReadonlySet<string>, entry: Recording.Entry): ReadonlyArray<Line> =>
  entry._tag !== 'Stepped'
    ? []
    : [
        ...entry.input.demands.map(({ entity, component, value }): Line => ({
          _tag: 'DemandAs',
          name: nameOf(entity),
          component,
          value,
        })),
        ...entry.input.actions.map((encoded): Line => {
          if (
            typeof encoded === 'object' &&
            encoded !== null &&
            '_tag' in encoded &&
            typeof encoded._tag === 'string' &&
            actionTags.has(encoded._tag) &&
            'player' in encoded &&
            typeof encoded.player === 'number'
          ) {
            const { player, ...action } = encoded;
            return { _tag: 'ActAs', name: nameOf(player), action };
          }
          return { _tag: 'ResolveAs', result: encoded };
        }),
      ];

/** Why a stretch holding `entry` cannot be told, if it cannot. */
const untellable = (entry: Recording.Entry, tick: number): Result.Result<void, string> => {
  switch (entry._tag) {
    case 'Joined':
      return Result.fail(`a player joined at tick ${tick}: tell a stretch that starts after it`);
    case 'Left':
      return Result.fail(`a player left at tick ${tick}: tell a stretch that ends before it`);
    case 'Restored':
      return Result.fail(
        `the host went back in time at tick ${tick}: tell a stretch that starts after it`,
      );
    case 'Stepped':
      return Result.void;
  }
};

/** The story of `entries`, taken with `setup` from `state`, which came to `end`; or why it cannot be told. */
export const of = (
  setup: Replay.Setup,
  state: State.State,
  entries: ReadonlyArray<Recording.Entry>,
  end: State.State,
): Result.Result<ReadonlyArray<Line>, string> => {
  const ticks = entries.reduce<Array<number>>(
    (seen, entry) => [...seen, entry._tag === 'Stepped' ? entry.tick : (seen.at(-1) ?? state.tick)],
    [],
  );
  for (const [index, entry] of entries.entries()) {
    const refused = untellable(entry, ticks[index] ?? state.tick);
    if (Result.isFailure(refused)) {
      return Result.fail(refused.failure);
    }
  }

  const actionTags = new Set(setup.game.actions.map(({ tag }) => tag));
  const played = entries.reduce<Array<Line>>((lines, entry) => {
    const went = stepLines(actionTags, entry);
    const last = lines.at(-1);
    if (went.length === 0 && last?._tag === 'Steps') {
      return [...lines.slice(0, -1), { _tag: 'Steps', count: last.count + 1 }];
    }
    return [...lines, ...went, { _tag: 'Steps', count: 1 }];
  }, []);

  const before = valuesOf(setup.game, state);
  const after = valuesOf(setup.game, end);
  const expected = setup.game.components.flatMap((component): ReadonlyArray<Line> => {
    const was = before.get(component.name) ?? new Map<State.Entity, unknown>();
    const is = after.get(component.name) ?? new Map<State.Entity, unknown>();
    return [
      ...[...is]
        .filter(([entity, value]) => JSON.stringify(was.get(entity)) !== JSON.stringify(value))
        .map(([entity, value]): Line => ({
          _tag: 'ExpectAs',
          name: nameOf(entity),
          component: component.name,
          value,
        })),
      ...[...was.keys()]
        .filter((entity) => !is.has(entity))
        .map((entity): Line => ({
          _tag: 'ExpectNoneAs',
          name: nameOf(entity),
          component: component.name,
        })),
    ];
  });

  const named = [...played, ...expected].flatMap((line) => ('name' in line ? [line.name] : []));
  const names = Object.fromEntries(
    [...new Set(named)].map((name) => [name, Number(name.slice(1))]),
  );
  return Result.succeed([
    {
      _tag: 'GivenAs',
      state: Schema.encodeSync(Game.schema(setup.game))(state),
      names,
    },
    ...played,
    ...expected,
  ]);
};

/** `lines` as the steps of a story, to tell with the game itself. */
export const steps = (lines: ReadonlyArray<Line>): ReadonlyArray<Story.Line> =>
  lines.map((line) => {
    switch (line._tag) {
      case 'GivenAs':
        return Story.givenAs(line.state, line.names);
      case 'DemandAs':
        return Story.demandAs(line.name, line.component, line.value);
      case 'ActAs':
        return Story.actAs(line.name, line.action);
      case 'ResolveAs':
        return Story.resolveAs(line.result);
      case 'Steps':
        return Story.steps(line.count);
      case 'ExpectAs':
        return Story.expectAs(line.name, line.component, line.value);
      case 'ExpectNoneAs':
        return Story.expectNoneAs(line.name, line.component);
    }
  });

/** `text` as a string in single quotes, as the workspace writes them. */
const quoted = (text: string) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** One line of a story as source. */
const sourceOf = (line: Line): string => {
  const json = JSON.stringify;
  switch (line._tag) {
    case 'GivenAs':
      return `Story.givenAs(${json(line.state)}, ${json(line.names)})`;
    case 'DemandAs':
      return `Story.demandAs(${quoted(line.name)}, ${quoted(line.component)}, ${json(line.value)})`;
    case 'ActAs':
      return `Story.actAs(${quoted(line.name)}, ${json(line.action)})`;
    case 'ResolveAs':
      return `Story.resolveAs(${json(line.result)})`;
    case 'Steps':
      return `Story.steps(${line.count})`;
    case 'ExpectAs':
      return `Story.expectAs(${quoted(line.name)}, ${quoted(line.component)}, ${json(line.value)})`;
    case 'ExpectNoneAs':
      return `Story.expectNoneAs(${quoted(line.name)}, ${quoted(line.component)})`;
  }
};

/** `lines` as the source of a story test called `title`, telling the game `game.name` exports from `game.from`. */
export const source = (
  lines: ReadonlyArray<Line>,
  options: {
    readonly title: string;
    readonly game: { readonly from: string; readonly name: string };
  },
): string =>
  [
    "import { it } from '@effect/vitest';",
    "import { Story } from '@nitida/core';",
    `import { ${options.game.name} } from '${options.game.from}';`,
    '',
    `it(${quoted(options.title)}, () => {`,
    '  Story.story(',
    `    ${options.game.name},`,
    ...lines.map((line) => `    ${sourceOf(line)},`),
    '  );',
    '});',
    '',
  ].join('\n');
