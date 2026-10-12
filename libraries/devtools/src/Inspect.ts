import { Client, Game, type Host, type Rule, type State } from '@lightocean/core';
import { Data, Effect, Option, Result, Schema, type Scope } from 'effect';
import * as Log from '#src/Log.ts';
import type * as Rewind from '#src/Rewind.ts';
import * as Transcript from '#src/Transcript.ts';

/**
 * A hosted game as an agent asks after it: what the game is made of, the state at any tick kept, how two ticks differ, what happened between them, and time itself, suspended, stepped, or played on from a past tick; and the game played, by players joined with no client, or any player, through demands and actions the game reads. Every request and every answer is plain data, so it travels as JSON to whatever asks, such as an MCP server; nothing here knows how.
 */

const OptionalInt = Schema.OptionFromOptionalKey(Schema.Int);

/** What can be asked. A tick left out means the state as it is now. */
export const Request = Schema.Union([
  /** The game: its domains, components, actions, events, and commands, each with its schema and the parts that change it. */
  Schema.TaggedStruct('Describe', {}),
  /** The ticks kept, oldest and newest. */
  Schema.TaggedStruct('Span', {}),
  /** The state at a tick, entity by entity: all of it, or one entity, or the entities that hold one component. */
  Schema.TaggedStruct('State', {
    tick: OptionalInt,
    entity: OptionalInt,
    component: Schema.OptionFromOptionalKey(Schema.String),
  }),
  /** How the state at `to` differs from the state at `from`, component by component. */
  Schema.TaggedStruct('Compare', { from: Schema.Int, to: Schema.Int }),
  /** What happened after the state at `from`, up to the state at `to`, step by step, as text; with the demands if asked. */
  Schema.TaggedStruct('Log', {
    from: Schema.Int,
    to: Schema.Int,
    demands: Schema.OptionFromOptionalKey(Schema.Boolean),
  }),
  /** Suspends time: the host takes steps only when told to. */
  Schema.TaggedStruct('Suspend', {}),
  /** Resumes time. */
  Schema.TaggedStruct('Resume', {}),
  /** Takes `count` steps at once, as suspended time is stepped through. */
  Schema.TaggedStruct('Step', { count: Schema.Int }),
  /** Shows the host's clients the state at a tick, while time is suspended. */
  Schema.TaggedStruct('Seek', { tick: Schema.Int }),
  /** Goes back to the state at a tick and plays on from it, the time after it gone. */
  Schema.TaggedStruct('PlayFrom', { tick: Schema.Int }),
  /** Shows the host's clients the state as it is now again. */
  Schema.TaggedStruct('Live', {}),
  /** Writes what happened after the state at `from`, up to the state at `to`, as the source of a story test called `title`, telling the game `game.name` exports from the module `game.from`. */
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
  /** Gives an entity demands, by its demand components' names, each value as it travels. */
  Schema.TaggedStruct('Demand', {
    entity: Schema.Int,
    values: Schema.Record(Schema.String, Schema.Unknown),
  }),
  /** Takes an action as from the player of an entity, tagged with the action it is. */
  Schema.TaggedStruct('Act', { entity: Schema.Int, action: Schema.Unknown }),
  /** The steps after the state at `from`, up to the state at `to`, in which something happened, as data: what `Steps` describes. */
  Schema.TaggedStruct('Steps', { from: Schema.Int, to: Schema.Int }),
]);
export type Request = typeof Request.Type;

/** A request that cannot be answered, and why. */
export class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

/** What `Steps` is answered with. */
export const Steps = Schema.Array(Log.Step);

export interface Inspector {
  /** Answers `request` with plain data. */
  readonly answer: (request: typeof Request.Encoded) => Effect.Effect<unknown, Refused>;
  /** Answers a request as it travelled, refusing one that is no request. */
  readonly answerUnknown: (request: unknown) => Effect.Effect<unknown, Refused>;
}

/** The values of `state`, as `game` encodes them, by entity, then by component. */
const byEntity = (game: Game.Game, state: State.State): Record<string, Record<string, unknown>> => {
  const entities: Record<string, Record<string, unknown>> = {};
  for (const component of game.components) {
    for (const [entity, value] of component.encode(state.stores.get(component.name))) {
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
  const eventOf = (event: Rule.Cause) => {
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
      const holding = (state: Record<string, Record<string, unknown>>) =>
        new Map(
          Object.entries(state).flatMap(([entity, values]) =>
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
      const state = yield* rewind
        .stateAt(tick)
        .pipe(Effect.mapError(({ reason }) => refuse(reason)));
      return yield* Effect.fromOption(state).pipe(
        Effect.mapError(() => refuse(`tick ${tick} is not kept: ticks ${oldest} to ${newest} are`)),
      );
    });
  const stateAt = (tick: Option.Option<number>) =>
    Option.match(tick, { onNone: () => host.state, onSome: kept });

  const answer = (request: Request) =>
    Effect.gen(function* () {
      const { game } = yield* rewind.setup;
      switch (request._tag) {
        case 'Describe':
          return describe(game);
        case 'Span':
          return yield* rewind.span;
        case 'State': {
          const state = yield* stateAt(request.tick);
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
          // Asked for one component, an entity that does not hold it is left out.
          const entities = Object.fromEntries(
            Object.entries(byEntity(game, state))
              .filter(([entity]) => wanted(entity))
              .map(([entity, values]): readonly [string, Record<string, unknown>] => [
                entity,
                picked(values),
              ])
              .filter(
                ([, values]) => Option.isNone(request.component) || Object.keys(values).length > 0,
              ),
          );
          return { tick: state.tick, entities };
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
        case 'Steps': {
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
            stretch.value.state,
            stretch.value.entries,
          ).pipe(Effect.mapError(({ reason }) => refuse(reason)));
          return yield* Schema.encodeEffect(Steps)(Log.stepsOf(lines)).pipe(
            Effect.mapError(() => refuse('the steps cannot be told as data')),
          );
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
            stretch.value.state,
            stretch.value.entries,
            { demands: Option.getOrElse(request.demands, () => false) },
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
            stretch.value.state,
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
        case 'Suspend':
          return yield* host.suspend;
        case 'Resume':
          return yield* host.resume;
        case 'Step':
          return yield* host.step(request.count);
        case 'Seek':
          return yield* host.show(yield* kept(request.tick));
        case 'PlayFrom':
          yield* kept(request.tick);
          return yield* rewind
            .playFrom(request.tick)
            .pipe(Effect.mapError(({ reason }) => refuse(reason)));
        case 'Live':
          return yield* host.show(yield* host.state);
        case 'Join':
          return { entity: yield* host.join };
        case 'Leave':
          return yield* host.leave(request.entity);
        case 'Demand':
          return yield* host
            .demand(
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

/** Answers the questions `host`'s clients ask by `inspector`, until the scope closes, as a debugger on a page asks them. */
export const answering = (
  host: Host.Host,
  inspector: Inspector,
): Effect.Effect<void, never, Scope.Scope> =>
  host.answering((question) =>
    inspector.answerUnknown(question).pipe(Effect.mapError(({ reason }) => reason)),
  );

/** Asks the host `client` is joined to `request`, by whatever answers beside it. */
export const ask = (
  client: Pick<Client.Client, 'ask'>,
  request: typeof Request.Encoded,
): Effect.Effect<unknown, Client.Unanswered> => client.ask(request);

/** The steps after the state at `from`, up to the state at `to`, in which something happened, as the host `client` is joined to tells them. */
export const steps = (
  client: Pick<Client.Client, 'ask'>,
  stretch: { readonly from: number; readonly to: number },
): Effect.Effect<ReadonlyArray<Log.Step>, Client.Unanswered> =>
  ask(client, { _tag: 'Steps', ...stretch }).pipe(
    Effect.flatMap((answer) =>
      Schema.decodeUnknownEffect(Steps)(answer).pipe(
        Effect.mapError(
          () => new Client.Unanswered({ reason: 'The answer is no steps a page can read.' }),
        ),
      ),
    ),
  );
