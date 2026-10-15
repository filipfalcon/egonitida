import { Data, Effect, Option, Schema, Semaphore } from 'effect';
import * as Discovery from '#src/Discovery.ts';
import * as Server from '#src/Server.ts';

/**
 * The MCP server an agent starts, as a proxy: it passes what its client asks to the MCP server the newest development server of its workspace serves, and what that answers back, so the tools always run as the development server's code has them now, however long ago the agent started the proxy. While no development server serves one, the tools it has itself answer, as old as the proxy. It reaches a development server started anew on its own, and tells its client the tools may have changed whenever it turns to another.
 */

/** An MCP server over HTTP, as a Fetch application. */
export type Respond = (request: Request) => Promise<Response>;

/** Where the proxy sends what it is asked: the MCP server a development server serves, where it serves it and the token it asks for; or the tools the proxy has itself. */
type Endpoint =
  | { readonly _tag: 'Served'; readonly mcp: string; readonly token: string }
  | { readonly _tag: 'Own' };

/** What an endpoint is known by, the same for the same one. */
const keyOf = (endpoint: Endpoint) => (endpoint._tag === 'Own' ? 'own' : endpoint.mcp);

/** A session the proxy keeps with an endpoint: the id the endpoint gave it, if any, the version of MCP they speak, and what the endpoint said it is. */
interface Session {
  readonly endpoint: Endpoint;
  readonly id: Option.Option<string>;
  readonly version: string;
  readonly greeting: unknown;
}

/** Why an endpoint could not be reached, or answered nothing the proxy could pass on. */
class Unreachable extends Data.TaggedError('Unreachable')<{ readonly reason: string }> {}

/** The proxy: what it does with each message from its client, and its look for the development server to send them to. */
export interface Proxy {
  /** Takes one message from the client, and says to the client what comes of it. */
  readonly receive: (message: unknown) => Effect.Effect<void>;
  /** Looks for the newest development server of the workspace, and turns to it if it is another, telling the client the tools may have changed. */
  readonly look: Effect.Effect<void>;
}

/** A field of `message`, if it is an object with one by `name`. */
const fieldOf = (message: unknown, name: string): Option.Option<unknown> =>
  typeof message === 'object' && message !== null && name in message
    ? Option.some(Reflect.get(message, name))
    : Option.none();

/** A field of `message` that is a string, if it has one by `name`. */
const textOf = (message: unknown, name: string): Option.Option<string> =>
  Option.filter(fieldOf(message, name), (value) => typeof value === 'string');

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The messages an answer over MCP's HTTP carries: none, as when it took a notification; one or a batch, as JSON; or each event of a stream. */
const messagesOf = (response: Response): Promise<ReadonlyArray<unknown>> =>
  response.text().then((text) => {
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      return text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .flatMap((line) => Option.toArray(fromJson(line.slice('data:'.length).trim())));
    }
    return Option.match(fromJson(text), {
      onNone: () => [],
      onSome: (parsed) => (Array.isArray(parsed) ? parsed : [parsed]),
    });
  });

/** The id the proxy initializes its sessions with, its own, never its client's. */
const OPENING = 'egonitida-proxy';

/** The proxy for the workspace `from` is in, its own tools `own`, saying what it has to say to its client by `say`. */
export const make = (options: {
  readonly from: string;
  readonly own: Respond;
  readonly say: (message: unknown) => Effect.Effect<void>;
}): Effect.Effect<Proxy> =>
  Effect.gen(function* () {
    const kept: {
      session: Option.Option<Session>;
      hello: Option.Option<unknown>;
      ready: boolean;
    } = { session: Option.none(), hello: Option.none(), ready: false };
    const turning = yield* Semaphore.make(1);

    /** The newest development server of the workspace that serves the MCP server, or the proxy's own tools. */
    const endpointNow = Effect.map(Discovery.relays(options.from), (relays): Endpoint => {
      const served = relays.findLast(({ mcp }) => mcp !== undefined);
      return served?.mcp === undefined
        ? { _tag: 'Own' }
        : { _tag: 'Served', mcp: served.mcp, token: served.token };
    });

    /** Posts `body` to `endpoint`, in `session` if it is in one, and comes to the response. */
    const post = (
      endpoint: Endpoint,
      body: unknown,
      session: { readonly id: Option.Option<string>; readonly version: string },
    ) =>
      Effect.tryPromise({
        try: () => {
          const headers = new Headers({
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            'mcp-protocol-version': session.version,
          });
          Option.map(session.id, (id) => headers.set('mcp-session-id', id));
          if (endpoint._tag === 'Served') {
            headers.set('authorization', `Bearer ${endpoint.token}`);
          }
          const request = new Request(
            endpoint._tag === 'Served' ? endpoint.mcp : `http://127.0.0.1${Server.PATH}`,
            { method: 'POST', headers, body: JSON.stringify(body) },
          );
          return (endpoint._tag === 'Served' ? fetch(request) : options.own(request)).then(
            async (response) => {
              if (!response.ok) {
                throw new Error(`it answered ${response.status}`);
              }
              return { response, messages: await messagesOf(response) };
            },
          );
        },
        catch: (cause) =>
          new Unreachable({
            reason: `the development server's MCP server at ${keyOf(endpoint)}: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });

    /** A session opened with `endpoint`, as the client opened its own with the proxy. */
    const open = (endpoint: Endpoint, hello: unknown) =>
      Effect.gen(function* () {
        const asked = Option.getOrElse(textOf(hello, 'protocolVersion'), () => '2025-06-18');
        const { response, messages } = yield* post(
          endpoint,
          { jsonrpc: '2.0', id: OPENING, method: 'initialize', params: hello },
          { id: Option.none(), version: asked },
        );
        const greeting = yield* Effect.fromOption(
          Option.firstSomeOf(messages.map((message) => fieldOf(message, 'result'))),
        ).pipe(Effect.mapError(() => new Unreachable({ reason: 'it said nothing it is' })));
        const session: Session = {
          endpoint,
          id: Option.fromNullishOr(response.headers.get('mcp-session-id')),
          version: Option.getOrElse(textOf(greeting, 'protocolVersion'), () => asked),
          greeting,
        };
        yield* post(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
        return session;
      });

    /** The session to send to now: the one kept, while its endpoint is still the newest, or one opened with the newest, the client told when it turned to another. */
    const sessionNow = turning.withPermit(
      Effect.gen(function* () {
        const hello = yield* Effect.fromOption(kept.hello).pipe(
          Effect.mapError(() => new Unreachable({ reason: 'the client has not initialized' })),
        );
        const endpoint = yield* endpointNow;
        const before = kept.session;
        if (Option.isSome(before) && keyOf(before.value.endpoint) === keyOf(endpoint)) {
          return before.value;
        }
        const session = yield* open(endpoint, hello);
        kept.session = Option.some(session);
        if (Option.isSome(before) && kept.ready) {
          yield* options.say({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        }
        return session;
      }),
    );

    /** Sends `message` in the session now, and says to the client whatever it answered. */
    const forward = (message: unknown) =>
      Effect.gen(function* () {
        const session = yield* sessionNow;
        const { messages } = yield* post(session.endpoint, message, session).pipe(
          // A session the endpoint no longer knows, as after it started anew, is forgotten, so the next is opened afresh.
          Effect.tapError(() =>
            Effect.sync(() => {
              kept.session = Option.none();
            }),
          ),
        );
        yield* Effect.forEach(messages, options.say, { discard: true });
      });

    const receive = (message: unknown): Effect.Effect<void> => {
      const method = textOf(message, 'method');
      const id = fieldOf(message, 'id');
      const failed = ({ reason }: Unreachable) =>
        Option.match(id, {
          onNone: () => Effect.void,
          onSome: (asked) =>
            options.say({ jsonrpc: '2.0', id: asked, error: { code: -32603, message: reason } }),
        });
      if (Option.contains(method, 'initialize')) {
        kept.hello = fieldOf(message, 'params');
        kept.session = Option.none();
        return Effect.flatMap(sessionNow, ({ greeting }) =>
          options.say({ jsonrpc: '2.0', id: Option.getOrUndefined(id), result: greeting }),
        ).pipe(Effect.catch(failed));
      }
      if (Option.contains(method, 'notifications/initialized')) {
        return Effect.sync(() => {
          kept.ready = true;
        });
      }
      // Tried once more, with the newest endpoint then, should the one it went to be gone.
      return forward(message).pipe(
        Effect.catch(() => forward(message)),
        Effect.catch(failed),
      );
    };

    return {
      receive,
      // Before the client initialized, there is nothing to turn.
      look: Effect.suspend(() =>
        Option.isNone(kept.hello) ? Effect.void : Effect.asVoid(Effect.ignore(sessionNow)),
      ),
    };
  });
