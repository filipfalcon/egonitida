import type { Inspect } from '@nitida/devtools';
import { Effect, Schema } from 'effect';
import { McpSchema, Tool, Toolkit } from 'effect/ai';
import * as Ask from '#src/Ask.ts';
import * as Discovery from '#src/Discovery.ts';

/**
 * What an agent can do with a running game, as MCP tools: list the hosts running, read what the game is made of, read the state at any tick kept, compare two ticks, read the log between them; suspend, step, show, and resume time, or play on from a past tick; play the game, as one player or many; and write what happened as a story test. Each tool asks the newest host unless it names one, and answers in JSON, or says why it could not.
 */

const host = Schema.optionalKey(Schema.String).annotate({
  description: 'The host to ask, as nitida_hosts lists it; the newest if left out.',
});
const tick = Schema.Int.annotate({ description: 'A tick of the state, within the span kept.' });
const entity = Schema.Int.annotate({
  description: 'An entity of the state, as nitida_state lists it.',
});

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

/** A tool that plays the game: it acts on the game, as a player would. */
const playing = <Name extends string, C extends Config, R>(tool: Tool.Tool<Name, C, R>) =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false);

export const toolkit = Toolkit.make(
  reading(
    Tool.make('nitida_hosts', {
      description:
        'Lists the hosts of games running under the development servers of this workspace, the newest last: each is a page of a game open in a browser.',
      success: Schema.Unknown,
      failure: Failure,
      failureMode: 'return',
    }),
  ),
  reading(
    asking(
      'nitida_describe',
      'Describes the game: its domains; its components, each with its schema, owner, network role, and the systems and rules that read, write, and spawn it; its actions and events, with what emits and handles each; and its commands.',
      {},
    ),
  ),
  reading(
    asking(
      'nitida_span',
      'Tells the ticks of the state that are kept: the oldest, the newest, and every tick between at which the host took up a new build of the game, with the build. The ticks before a reload were played by an earlier build: they can be read, logged, and seeked, but not played on from or told as a story.',
      {},
    ),
  ),
  reading(
    asking(
      'nitida_state',
      'Reads the state at a tick, entity by entity, each with the values of its components; the state as it is now if no tick is given. Narrows to one entity or one component if asked.',
      {
        tick: Schema.optionalKey(tick),
        entity: Schema.optionalKey(Schema.Int),
        component: Schema.optionalKey(Schema.String),
      },
    ),
  ),
  reading(
    asking(
      'nitida_compare',
      'Compares the state at two ticks, component by component: the entities that gained it, lost it, or hold another value of it, with both values.',
      { from: tick, to: tick },
    ),
  ),
  reading(
    asking(
      'nitida_log',
      'Reads the log of what happened after the state at one tick, up to the state at another: joins and leaves, the actions each step took, and what each system and rule did, and for what. The demands are left out unless asked for.',
      { from: tick, to: tick, demands: Schema.optionalKey(Schema.Boolean) },
    ),
  ),
  reading(
    asking(
      'nitida_story',
      "Writes what happened after the state at one tick, up to the state at another, as the source of a story test: the state at the first tick, the input of every step, and every value that came of them, by name. Save it as a *.story.test.ts file in the game's package. A stretch in which a player joined or left cannot be told; start after it, or end before. Nor can one played by an earlier build than the one running now, or across a reload: the story is told by the code at hand.",
      {
        from: tick,
        to: tick,
        title: Schema.String.annotate({ description: 'What the story tells, as a test is named.' }),
        gameFrom: Schema.String.annotate({
          description: "The module the game is imported from in the test, such as '#src/game.ts'.",
        }),
        gameName: Schema.String.annotate({
          description: 'The name the module exports the game under, such as game.',
        }),
      },
    ),
  ),
  steering(
    asking(
      'nitida_suspend',
      'Suspends time: the game stands still, stepping only when told to, until it is resumed.',
      {},
    ),
    true,
  ),
  steering(asking('nitida_resume', 'Resumes time: the game runs again.', {}), true),
  steering(
    asking('nitida_step', 'Takes so many steps at once, as suspended time is stepped through.', {
      count: Schema.Int,
    }),
    false,
  ),
  steering(
    asking(
      'nitida_seek',
      "Shows the page the state at a past tick, while time is suspended, without changing the host's state.",
      { tick },
    ),
    true,
  ),
  asking(
    'nitida_play_from',
    'Goes back to the state at a past tick and plays on from it; what came after it is gone.',
    { tick },
  )
    .annotate(Tool.Destructive, true)
    .annotate(Tool.OpenWorld, false),
  steering(
    asking('nitida_live', 'Shows the page the state as it is now again, after seeking.', {}),
    true,
  ),
  playing(
    asking(
      'nitida_join',
      "Joins a player with no page, as the game's own join makes one, and tells its entity: several may join, to play the same state as many players.",
      {},
    ),
  ),
  playing(asking('nitida_leave', 'Lets go of the player of an entity.', { entity })),
  playing(
    asking(
      'nitida_demand',
      'Gives an entity demands for the next step, what its player is doing with their controls: values of demand components by name, as nitida_describe gives their schemas. They go in after what a page sends.',
      { entity, values: Schema.Record(Schema.String, Schema.Unknown) },
    ),
  ),
  playing(
    asking(
      'nitida_act',
      'Takes an action as from the player of an entity, at the next step: the action tagged with its name, with its fields but the player, as nitida_describe gives its schema.',
      { entity, action: Schema.Unknown },
    ),
  ),
);

/** How every tool is carried out, finding the relays from the workspace `from` is in on every call. */
export const implementations = (from: string) => {
  const ask = (request: typeof Inspect.Request.Encoded, named: string | undefined) =>
    Discovery.relays(from).pipe(
      Effect.flatMap((relays) => Ask.request(relays, request, named)),
      Effect.mapError(({ reason }) => ({ reason })),
    );
  return toolkit.of({
    nitida_hosts: () =>
      Discovery.relays(from).pipe(
        Effect.flatMap(Ask.hosts),
        Effect.map((running) => running.map(({ host, name }) => ({ host, name }))),
        Effect.mapError(({ reason }) => ({ reason })),
      ),
    nitida_describe: ({ host }) => ask({ _tag: 'Describe' }, host),
    nitida_span: ({ host }) => ask({ _tag: 'Span' }, host),
    nitida_state: ({ host, ...asked }) => ask({ _tag: 'State', ...asked }, host),
    nitida_compare: ({ host, ...asked }) => ask({ _tag: 'Compare', ...asked }, host),
    nitida_log: ({ host, ...asked }) => ask({ _tag: 'Log', ...asked }, host),
    nitida_story: ({ host, gameFrom, gameName, ...asked }) =>
      ask({ _tag: 'Story', ...asked, game: { from: gameFrom, name: gameName } }, host),
    nitida_suspend: ({ host }) => ask({ _tag: 'Suspend' }, host),
    nitida_resume: ({ host }) => ask({ _tag: 'Resume' }, host),
    nitida_step: ({ host, count }) => ask({ _tag: 'Step', count }, host),
    nitida_seek: ({ host, tick: at }) => ask({ _tag: 'Seek', tick: at }, host),
    nitida_play_from: ({ host, tick: at }) => ask({ _tag: 'PlayFrom', tick: at }, host),
    nitida_live: ({ host }) => ask({ _tag: 'Live' }, host),
    nitida_join: ({ host }) => ask({ _tag: 'Join' }, host),
    nitida_leave: ({ host, ...asked }) => ask({ _tag: 'Leave', ...asked }, host),
    nitida_demand: ({ host, ...asked }) => ask({ _tag: 'Demand', ...asked }, host),
    nitida_act: ({ host, ...asked }) => ask({ _tag: 'Act', ...asked }, host),
  });
};

// SCREENSHOT
// A tool of its own, since it answers with an image, which a toolkit's tools, answering in JSON, cannot.

const ScreenshotParameters = Schema.Struct({
  host: Schema.optionalKey(Schema.String),
  width: Schema.optionalKey(Schema.Int),
});

/** The tool that shows an agent what a page draws now, as a person sees it. */
export const screenshotTool = new McpSchema.Tool({
  name: 'nitida_screenshot',
  description:
    'Shows what the newest page drawing a host shows now, as an image, as a person sees it: to check how something looks, rather than asking. Seek to a past tick first to see the past. It needs the page open in a browser.',
  inputSchema: {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description:
          'The host whose page to show, as nitida_hosts lists it; the newest if left out.',
      },
      width: {
        type: 'integer',
        description: 'The most pixels across the image may be; as the page draws if left out.',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

/** What the screenshot tool answers, finding the relays from the workspace `from` is in on every call. */
export const screenshot =
  (from: string) =>
  (payload: unknown): Effect.Effect<McpSchema.CallToolResult> =>
    Schema.decodeUnknownEffect(ScreenshotParameters)(payload).pipe(
      Effect.mapError(({ message }) => new Ask.Failed({ reason: message })),
      Effect.flatMap((asked) =>
        Effect.flatMap(Discovery.relays(from), (relays) => Ask.capture(relays, asked)),
      ),
      Effect.match({
        onSuccess: (shot) =>
          new McpSchema.CallToolResult({
            content: [
              { type: 'image', data: Buffer.from(shot.png, 'base64'), mimeType: 'image/png' },
              { type: 'text', text: `a shot ${shot.width} by ${shot.height} pixels` },
            ],
          }),
        onFailure: ({ reason }) =>
          new McpSchema.CallToolResult({
            isError: true,
            content: [{ type: 'text', text: reason }],
          }),
      }),
    );
