import type { Inspect } from '@lightocean/devtools';
import { Effect, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/ai';
import * as Ask from '#src/Ask.ts';
import * as Discovery from '#src/Discovery.ts';

/**
 * What an agent can do with a running game, as MCP tools: list the hosts running, read what the game is made of, read the world at any tick kept, compare two ticks, read the log between them, and hold, step, show, and play on from time. Each tool asks the newest host unless it names one, and answers in JSON, or says why it could not.
 */

const host = Schema.optionalKey(Schema.String).annotate({
  description: 'The host to ask, as lightocean_hosts lists it; the newest if left out.',
});
const tick = Schema.Int.annotate({ description: 'A tick of the world, within the span kept.' });

/** Why a tool could not do what it was asked. */
const Failure = Schema.Struct({ reason: Schema.String });

/** A tool that asks a host one thing, answering in JSON or saying why it could not. */
const asking = <const Name extends string, const Fields extends Schema.Struct.Fields>(
  name: Name,
  description: string,
  fields: Fields,
) =>
  Tool.make(name, {
    description,
    parameters: Schema.Struct({ ...fields, host }),
    success: Schema.Unknown,
    failure: Failure,
    failureMode: 'return',
  });

/** The shape of every tool's configuration. */
type Config = {
  readonly parameters: Schema.Constraint;
  readonly success: Schema.Constraint;
  readonly failure: Schema.Constraint;
  readonly failureMode: Tool.FailureMode;
};

/** A tool that only reads: an agent may call it freely. */
const reading = <Name extends string, C extends Config, R>(tool: Tool.Tool<Name, C, R>) =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false);

/** A tool that changes how time runs, but loses nothing: calling it again changes nothing more, if `idempotent`. */
const steering = <Name extends string, C extends Config, R>(
  tool: Tool.Tool<Name, C, R>,
  idempotent: boolean,
) =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, idempotent)
    .annotate(Tool.OpenWorld, false);

export const toolkit = Toolkit.make(
  reading(
    Tool.make('lightocean_hosts', {
      description:
        'Lists the hosts of games running under the development servers of this workspace, the newest last: each is a page of a game open in a browser.',
      success: Schema.Unknown,
      failure: Failure,
      failureMode: 'return',
    }),
  ),
  reading(
    asking(
      'lightocean_describe',
      'Describes the game: its domains; its components, each with its schema, owner, network role, and the systems and rules that read, write, and spawn it; its actions and events, with what emits and handles each; and its commands.',
      {},
    ),
  ),
  reading(
    asking(
      'lightocean_span',
      'Tells the ticks of the world that are kept: the oldest and the newest.',
      {},
    ),
  ),
  reading(
    asking(
      'lightocean_world',
      'Reads the world at a tick, entity by entity, each with the values of its components; the world as it is now if no tick is given. Narrows to one entity or one component if asked.',
      {
        tick: Schema.optionalKey(tick),
        entity: Schema.optionalKey(Schema.Int),
        component: Schema.optionalKey(Schema.String),
      },
    ),
  ),
  reading(
    asking(
      'lightocean_compare',
      'Compares the world at two ticks, component by component: the entities that gained it, lost it, or hold another value of it, with both values.',
      { from: tick, to: tick },
    ),
  ),
  reading(
    asking(
      'lightocean_log',
      'Reads the log of what happened after the world at one tick, up to the world at another: joins and leaves, the actions each step took, and what each system and rule did, and for what. Input is left out unless asked for.',
      { from: tick, to: tick, inputs: Schema.optionalKey(Schema.Boolean) },
    ),
  ),
  steering(
    asking('lightocean_hold', 'Holds time: the world stands until it is released.', {}),
    true,
  ),
  steering(asking('lightocean_release', 'Lets time run again.', {}), true),
  steering(
    asking('lightocean_advance', 'Takes so many steps at once, as held time is stepped through.', {
      steps: Schema.Int,
    }),
    false,
  ),
  steering(
    asking(
      'lightocean_seek',
      "Shows the page the world at a past tick, while time is held, without changing the host's world.",
      { tick },
    ),
    true,
  ),
  asking(
    'lightocean_play_from',
    'Goes back to the world at a past tick and plays on from it; what came after it is gone.',
    { tick },
  )
    .annotate(Tool.Destructive, true)
    .annotate(Tool.OpenWorld, false),
  steering(
    asking('lightocean_live', 'Shows the page the world as it is now again, after seeking.', {}),
    true,
  ),
);

/** The handlers of every tool, finding the relays from the workspace `from` is in on every call. */
export const handlers = (from: string) => {
  const ask = (request: typeof Inspect.Request.Encoded, named: string | undefined) =>
    Discovery.relays(from).pipe(
      Effect.flatMap((relays) => Ask.request(relays, request, named)),
      Effect.mapError(({ reason }) => ({ reason })),
    );
  return toolkit.of({
    lightocean_hosts: () =>
      Discovery.relays(from).pipe(
        Effect.flatMap(Ask.hosts),
        Effect.map((running) => running.map(({ host, name }) => ({ host, name }))),
        Effect.mapError(({ reason }) => ({ reason })),
      ),
    lightocean_describe: ({ host }) => ask({ _tag: 'Describe' }, host),
    lightocean_span: ({ host }) => ask({ _tag: 'Span' }, host),
    lightocean_world: ({ host, ...asked }) => ask({ _tag: 'World', ...asked }, host),
    lightocean_compare: ({ host, ...asked }) => ask({ _tag: 'Compare', ...asked }, host),
    lightocean_log: ({ host, ...asked }) => ask({ _tag: 'Log', ...asked }, host),
    lightocean_hold: ({ host }) => ask({ _tag: 'Hold' }, host),
    lightocean_release: ({ host }) => ask({ _tag: 'Release' }, host),
    lightocean_advance: ({ host, steps }) => ask({ _tag: 'Advance', steps }, host),
    lightocean_seek: ({ host, tick: at }) => ask({ _tag: 'Seek', tick: at }, host),
    lightocean_play_from: ({ host, tick: at }) => ask({ _tag: 'PlayFrom', tick: at }, host),
    lightocean_live: ({ host }) => ask({ _tag: 'Live' }, host),
  });
};
