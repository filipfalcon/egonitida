import { type Event, Game, type Host, type World } from '@lightocean/core';
import { Data, Effect, Option, Result, Schema } from 'effect';
import * as Log from '#src/Log.ts';
import type * as Rewind from '#src/Rewind.ts';
import * as Transcript from '#src/Transcript.ts';

/**
 * A hosted game as an agent asks after it: what the game is made of, the world at any tick kept, how two ticks differ, what happened between them, and time itself, held, stepped, or played on from a past tick; and the game played, by players joined with no client, or any player, through input and actions the game reads. Every request and every answer is plain data, so it travels as JSON to whatever asks, such as an MCP server; nothing here knows how.
 */

const OptionalInt = Schema.OptionFromOptionalKey(Schema.Int);

/** What can be asked. A tick left out means the world as it is now. */
export const Request = Schema.Union([
  /** The game: its domains, components, actions, events, and commands, each with its schema and the parts that change it. */
  Schema.TaggedStruct('Describe', {}),
  /** The ticks kept, oldest and newest. */
  Schema.TaggedStruct('Span', {}),
  /** The world at a tick, entity by entity: all of it, or one entity, or one component. */
  Schema.TaggedStruct('World', {
    tick: OptionalInt,
    entity: OptionalInt,
    component: Schema.OptionFromOptionalKey(Schema.String),
  }),
  /** How the world at `to` differs from the world at `from`, component by component. */
  Schema.TaggedStruct('Compare', { from: Schema.Int, to: Schema.Int }),
  /** What happened after the world at `from`, up to the world at `to`, step by step, as text; with input if asked. */
  Schema.TaggedStruct('Log', {
    from: Schema.Int,
    to: Schema.Int,
    inputs: Schema.OptionFromOptionalKey(Schema.Boolean),
  }),
  Schema.TaggedStruct('Hold', {}),
  Schema.TaggedStruct('Release', {}),
  /** Takes so many steps at once, as time held is stepped through. */
  Schema.TaggedStruct('Advance', { steps: Schema.Int }),
  /** Shows the host's clients the world at a tick, while time is held. */
  Schema.TaggedStruct('Seek', { tick: Schema.Int }),
  /** Goes back to the world at a tick and plays on from it, the time after it gone. */
  Schema.TaggedStruct('PlayFrom', { tick: Schema.Int }),
  /** Shows the host's clients the world as it is now again. */
  Schema.TaggedStruct('Live', {}),
  /** Writes what happened after the world at `from`, up to the world at `to`, as the source of a story test called `title`, telling the game `game.name` exports from the module `game.from`. */
  Schema.TaggedStruct('Story', {
    from: Schema.Int,
    to: Schema.Int,
    title: Schema.String,
    game: Schema.Struct({ from: Schema.String, name: Schema.String }),
  }),
  /** Joins a player with no client, as the game's own `join` makes one: its entity. */
  Schema.TaggedStruct('Join', {}),
  /** Lets go of the player of an entity. */
  Schema.TaggedStruct('Leave', { entity: Schema.Int }),
  /** Gives an entity input, by its input components' names, each value as it travels. */
  Schema.TaggedStruct('Input', {
    entity: Schema.Int,
    values: Schema.Record(Schema.String, Schema.Unknown),
  }),
  /** Takes an action as from the player of an entity, tagged with the action it is. */
  Schema.TaggedStruct('Act', { entity: Schema.Int, action: Schema.Unknown }),
]);
export type Request = typeof Request.Type;

/** A request that cannot be answered, and why. */
export class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

export interface Inspector {
  /** Answers `request` with plain data. */
  readonly answer: (request: typeof Request.Encoded) => Effect.Effect<unknown, Refused>;
  /** Answers a request as it travelled, refusing one that is no request. */
  readonly answerUnknown: (request: unknown) => Effect.Effect<unknown, Refused>;
}

/** The values of `world`, as `game` encodes them, by entity, then by component. */
const byEntity = (game: Game.Game, world: World.World): Record<string, Record<string, unknown>> => {
  const entities: Record<string, Record<string, unknown>> = {};
  for (const component of game.components) {
    for (const [entity, value] of component.encode(world.stores.get(component.name))) {
      entities[entity] = { ...entities[entity], [component.name]: value };
    }
  }
  return entities;
};

/** The JSON Schema of `schema`, as it travels. */
const jsonSchemaOf = (schema: Schema.Top) =>
  Schema.toJsonSchemaDocument(Schema.toCodecJson(schema)).schema;

/** What `game` is made of, for an agent to read. */
const describe = (game: Game.Game) => {
  const changes = Game.changes(game);
  const names = (parts: ReadonlyArray<Game.Part>) => parts.map(Log.nameOf);
  const eventOf = (event: Event.Any) => {
    const changed = changes.events.get(event.tag);
    return {
      tag: event.tag,
      schema: jsonSchemaOf(event.schema),
      emittedBy: names(changed?.emittedBy ?? []),
      handledBy: names(changed?.handledBy ?? []),
    };
  };
  return {
    stepRate: game.stepRate,
    domains: game.domains.map(({ name }) => name),
    components: game.components.map((component) => {
      const changed = changes.components.get(component.name);
      return {
        name: component.name,
        owner: component.owner,
        network: component.network,
        schema: jsonSchemaOf(component.schema),
        readBy: names(changed?.readBy ?? []),
        writtenBy: names(changed?.writtenBy ?? []),
        spawnedBy: names(changed?.spawnedBy ?? []),
      };
    }),
    actions: game.actions.map(eventOf),
    events: game.events.map(eventOf),
    commands: game.commands.map((command) => ({
      name: command.name,
      issuedBy: names(changes.commands.get(command.name)?.issuedBy ?? []),
      results: command.results.map(({ tag }) => tag),
    })),
    despawnedBy: names(changes.despawnedBy),
  };
};

/** How the values of each component differ from `before` to `after`, entity by entity. */
const compare = (
  before: Record<string, Record<string, unknown>>,
  after: Record<string, Record<string, unknown>>,
  game: Game.Game,
) =>
  Object.fromEntries(
    game.components.flatMap((component) => {
      const holding = (world: Record<string, Record<string, unknown>>) =>
        new Map(
          Object.entries(world).flatMap(([entity, values]) =>
            component.name in values ? [[Number(entity), values[component.name]]] : [],
          ),
        );
      const was = holding(before);
      const is = holding(after);
      const added = [...is.keys()].filter((entity) => !was.has(entity));
      const removed = [...was.keys()].filter((entity) => !is.has(entity));
      const changed = [...is].flatMap(([entity, value]) =>
        was.has(entity) && JSON.stringify(was.get(entity)) !== JSON.stringify(value)
          ? [{ entity, from: was.get(entity), to: value }]
          : [],
      );
      return added.length + removed.length + changed.length === 0
        ? []
        : [[component.name, { added, removed, changed }]];
    }),
  );

/** An inspector of `host`, through `rewind`, which keeps the ticks it can tell of. */
export const make = (host: Host.Host, rewind: Rewind.Rewind): Inspector => {
  const refuse = (reason: string) => new Refused({ reason });
  const kept = (tick: number) =>
    Effect.gen(function* () {
      const { oldest, newest } = yield* rewind.span;
      const world = yield* rewind
        .worldAt(tick)
        .pipe(Effect.mapError(({ reason }) => refuse(reason)));
      return yield* Effect.fromOption(world).pipe(
        Effect.mapError(() => refuse(`tick ${tick} is not kept: ticks ${oldest} to ${newest} are`)),
      );
    });
  const worldAt = (tick: Option.Option<number>) =>
    Option.match(tick, { onNone: () => host.world, onSome: kept });

  const answer = (request: Request) =>
    Effect.gen(function* () {
      const { game } = yield* rewind.setup;
      switch (request._tag) {
        case 'Describe':
          return describe(game);
        case 'Span':
          return yield* rewind.span;
        case 'World': {
          const world = yield* worldAt(request.tick);
          const wanted = (entity: string) =>
            Option.match(request.entity, {
              onNone: () => true,
              onSome: (only) => Number(entity) === only,
            });
          const picked = (values: Record<string, unknown>) =>
            Option.match(request.component, {
              onNone: () => values,
              onSome: (name) => (name in values ? { [name]: values[name] } : {}),
            });
          const entities = Object.fromEntries(
            Object.entries(byEntity(game, world))
              .filter(([entity]) => wanted(entity))
              .map(([entity, values]) => [entity, picked(values)]),
          );
          return { tick: world.tick, entities };
        }
        case 'Compare': {
          const before = yield* kept(request.from);
          const after = yield* kept(request.to);
          return {
            from: request.from,
            to: request.to,
            components: compare(byEntity(game, before), byEntity(game, after), game),
          };
        }
        case 'Log': {
          const stretch = yield* rewind
            .between(request.from, request.to)
            .pipe(Effect.mapError(({ reason }) => refuse(reason)));
          if (Option.isNone(stretch)) {
            const { oldest, newest } = yield* rewind.span;
            return yield* refuse(
              `ticks ${request.from} to ${request.to} are not kept: ticks ${oldest} to ${newest} are`,
            );
          }
          const lines = yield* Log.from(
            yield* rewind.setup,
            stretch.value.world,
            stretch.value.entries,
            { inputs: Option.getOrElse(request.inputs, () => false) },
          ).pipe(Effect.mapError(({ reason }) => refuse(reason)));
          return { text: Log.format(lines) };
        }
        case 'Story': {
          const stretch = yield* rewind
            .between(request.from, request.to)
            .pipe(Effect.mapError(({ reason }) => refuse(reason)));
          if (Option.isNone(stretch)) {
            const { oldest, newest } = yield* rewind.span;
            return yield* refuse(
              `ticks ${request.from} to ${request.to} are not kept: ticks ${oldest} to ${newest} are`,
            );
          }
          const end = yield* kept(request.to);
          const lines = Transcript.of(
            yield* rewind.setup,
            stretch.value.world,
            stretch.value.entries,
            end,
          );
          if (Result.isFailure(lines)) {
            return yield* refuse(lines.failure);
          }
          return {
            source: Transcript.source(lines.success, { title: request.title, game: request.game }),
          };
        }
        case 'Hold':
          return yield* host.hold;
        case 'Release':
          return yield* host.release;
        case 'Advance':
          return yield* host.advance(request.steps);
        case 'Seek':
          return yield* host.show(yield* kept(request.tick));
        case 'PlayFrom':
          yield* kept(request.tick);
          return yield* rewind
            .playFrom(request.tick)
            .pipe(Effect.mapError(({ reason }) => refuse(reason)));
        case 'Live':
          return yield* host.show(yield* host.world);
        case 'Join':
          return { entity: yield* host.join };
        case 'Leave':
          return yield* host.leave(request.entity);
        case 'Input':
          return yield* host
            .input(
              request.entity,
              Object.entries(request.values).map(([component, value]) => ({ component, value })),
            )
            .pipe(Effect.mapError(({ reason }) => refuse(reason)));
        case 'Act':
          return yield* host
            .act(request.entity, request.action)
            .pipe(Effect.mapError(({ reason }) => refuse(reason)));
      }
    }).pipe(Effect.map((answered) => answered ?? { done: true }));

  const answerUnknown = (request: unknown) =>
    Schema.decodeUnknownEffect(Request)(request).pipe(
      Effect.mapError((issue) => refuse(`not a request: ${issue.message}`)),
      Effect.flatMap(answer),
    );

  return {
    answer: (request) => answerUnknown(request),
    answerUnknown,
  };
};
