import { Effect, Option, Result, Schema } from 'effect';
import * as Bridge from '#src/Bridge.ts';

/**
 * Between the hosts of a game, such as the workers of the pages a development server serves, and the tools that ask after them, such as an MCP server: it keeps which hosts said hello, hands each request to the host it is for, the newest unless told which, and hands each answer back to the tool that asked alone, with the id it asked with. Several tools may ask at once, with the same ids.
 *
 * It knows nothing of how either side is reached; whatever runs it gives it a connection to each, and the same connection for the same side every time.
 */

/** What a tool asks a relay: which hosts are there, a request of one of them, a shot of what a page drawing one shows, or a key pressed on that page, the newest unless named. */
export const ToRelay = Schema.Union([
  Schema.TaggedStruct('Hosts', { id: Schema.Int }),
  Schema.TaggedStruct('Ask', {
    id: Schema.Int,
    host: Schema.OptionFromOptionalKey(Schema.String),
    request: Schema.Unknown,
  }),
  /** A shot of what the newest page drawing a host shows, the host named or the newest. */
  Schema.TaggedStruct('Capture', {
    id: Schema.Int,
    host: Schema.OptionFromOptionalKey(Schema.String),
    width: Schema.OptionFromOptionalKey(Schema.Int),
  }),
  /** The key at `key`, a `KeyboardEvent.code`, held for `frames` frames on the newest page drawing a host, the host named or the newest. */
  Schema.TaggedStruct('Press', {
    id: Schema.Int,
    host: Schema.OptionFromOptionalKey(Schema.String),
    key: Schema.String,
    frames: Schema.Int,
  }),
]);
export type ToRelay = typeof ToRelay.Type;

/** What a relay answers a tool, with the id it asked with. */
export const FromRelay = Schema.Union([
  Schema.TaggedStruct('Hosts', {
    id: Schema.Int,
    hosts: Schema.Array(Schema.Struct({ host: Schema.String, name: Schema.String })),
  }),
  Schema.TaggedStruct('Answered', { id: Schema.Int, answer: Schema.Unknown }),
  Schema.TaggedStruct('Unanswered', { id: Schema.Int, reason: Schema.String }),
]);
export type FromRelay = typeof FromRelay.Type;

/** A record of where a relay listens for tools, where its development server serves the MCP server to them if it does, the token they give either, and the process serving them: what a tool reads to reach it. */
export const Record = Schema.Struct({
  url: Schema.String,
  mcp: Schema.optionalKey(Schema.String),
  token: Schema.String,
  pid: Schema.Int,
});
export type Record = typeof Record.Type;

/** Where, under a workspace's root, relays keep their records. */
export const RECORDS = ['node_modules', '.egonitida', 'relays'];

/** A connection to one side, which a relay sends messages to. */
export interface Peer<Message> {
  readonly send: (message: Message) => Effect.Effect<void>;
}

export interface Relay {
  /** Takes what a host sent, as it arrived. */
  readonly fromHost: (host: Peer<Bridge.ToHost>, message: unknown) => Effect.Effect<void>;
  /** Forgets a host or a page whose connection ended, refusing what was asked of it and not yet answered. */
  readonly hostGone: (host: Peer<Bridge.ToHost>) => Effect.Effect<void>;
  /** Takes what a tool sent, as it arrived. */
  readonly fromTool: (tool: Peer<FromRelay>, message: unknown) => Effect.Effect<void>;
  /** Forgets a tool whose connection ended, and drops the answers it was waiting for. */
  readonly toolGone: (tool: Peer<FromRelay>) => Effect.Effect<void>;
}

interface Hosting {
  readonly host: string;
  readonly name: string;
  readonly peer: Peer<Bridge.ToHost>;
}

interface Showing {
  readonly page: string;
  readonly host: string;
  readonly peer: Peer<Bridge.ToHost>;
}

interface Waiting {
  readonly tool: Peer<FromRelay>;
  /** The id the tool asked with. */
  readonly id: number;
  readonly host: string;
  /** Who was asked, a host or a page, whose going away leaves it unanswered. */
  readonly asked: Peer<Bridge.ToHost>;
}

/** A relay with no host and no tool yet. */
export const make: Effect.Effect<Relay> = Effect.sync(() => {
  const known = {
    /** The hosts that said hello, in the order they did. */
    hosts: new Array<Hosting>(),
    /** The pages that said which host they draw, in the order they did. */
    pages: new Array<Showing>(),
    /** What tools wait for, by the id the relay asked with. */
    waiting: new Map<number, Waiting>(),
    nextId: 1,
  };

  const answerTool = (id: number, toTool: (waiting: Waiting) => FromRelay) =>
    Option.match(Option.fromNullishOr(known.waiting.get(id)), {
      onNone: () => Effect.void,
      onSome: (waiting) => {
        known.waiting.delete(id);
        return waiting.tool.send(toTool(waiting));
      },
    });

  const fromHost = (peer: Peer<Bridge.ToHost>, message: Bridge.FromHost) => {
    switch (message._tag) {
      case 'Hello':
        return Effect.sync(() => {
          known.hosts = [
            ...known.hosts.filter(({ host }) => host !== message.host),
            { host: message.host, name: message.name, peer },
          ];
        });
      case 'Showing':
        return Effect.sync(() => {
          known.pages = [
            ...known.pages.filter(({ page }) => page !== message.page),
            { page: message.page, host: message.host, peer },
          ];
        });
      case 'Answered':
        return answerTool(message.id, ({ id }) => ({
          _tag: 'Answered',
          id,
          answer: message.answer,
        }));
      case 'Unanswered':
        return answerTool(message.id, ({ id }) => ({
          _tag: 'Unanswered',
          id,
          reason: message.reason,
        }));
    }
  };

  /** The host a request is for: the one named, or the newest. */
  const hostFor = (named: Option.Option<string>): Result.Result<Hosting, string> => {
    const running = known.hosts.map(({ host }) => host);
    return Option.match(named, {
      onNone: () =>
        Option.match(Option.fromNullishOr(known.hosts.at(-1)), {
          onNone: () =>
            Result.fail('no game is running: open it in a browser with the development server'),
          onSome: Result.succeed,
        }),
      onSome: (name) =>
        Option.match(Option.fromNullishOr(known.hosts.find(({ host }) => host === name)), {
          onNone: () =>
            Result.fail(
              `no host is called ${name}: ${running.join(' and ')} ${running.length === 1 ? 'is' : 'are'} running`,
            ),
          onSome: Result.succeed,
        }),
    });
  };

  const fromTool = (tool: Peer<FromRelay>, message: ToRelay) => {
    if (message._tag === 'Hosts') {
      return tool.send({
        _tag: 'Hosts',
        id: message.id,
        hosts: known.hosts.map(({ host, name }) => ({ host, name })),
      });
    }
    const target = hostFor(message.host);
    if (Result.isFailure(target)) {
      return tool.send({ _tag: 'Unanswered', id: message.id, reason: target.failure });
    }
    const id = known.nextId;
    known.nextId += 1;
    if (message._tag === 'Capture' || message._tag === 'Press') {
      const page = known.pages.findLast(({ host }) => host === target.success.host);
      if (page === undefined) {
        return tool.send({
          _tag: 'Unanswered',
          id: message.id,
          reason: `no page shows ${target.success.host}: open it in a browser with the development server`,
        });
      }
      known.waiting.set(id, { tool, id: message.id, host: target.success.host, asked: page.peer });
      return page.peer.send(
        message._tag === 'Capture'
          ? { _tag: 'Capture', id, page: page.page, width: message.width }
          : { _tag: 'Press', id, page: page.page, key: message.key, frames: message.frames },
      );
    }
    known.waiting.set(id, {
      tool,
      id: message.id,
      host: target.success.host,
      asked: target.success.peer,
    });
    return target.success.peer.send({
      _tag: 'Ask',
      id,
      host: target.success.host,
      request: message.request,
    });
  };

  return {
    fromHost: (peer, message) =>
      Option.match(Schema.decodeUnknownOption(Bridge.FromHost)(message), {
        onNone: () => Effect.void,
        onSome: (decoded) => fromHost(peer, decoded),
      }),
    hostGone: (peer) =>
      Effect.suspend(() => {
        known.hosts = known.hosts.filter((hosting) => hosting.peer !== peer);
        known.pages = known.pages.filter((showing) => showing.peer !== peer);
        const unanswered = [...known.waiting].filter(([, { asked }]) => asked === peer);
        return Effect.forEach(
          unanswered,
          ([id, { host }]) =>
            answerTool(id, (waiting) => ({
              _tag: 'Unanswered',
              id: waiting.id,
              reason: `${host} went away before it answered`,
            })),
          { discard: true },
        );
      }),
    fromTool: (tool, message) =>
      Option.match(Schema.decodeUnknownOption(ToRelay)(message), {
        onNone: () => Effect.void,
        onSome: (decoded) => Effect.suspend(() => fromTool(tool, decoded)),
      }),
    toolGone: (tool) =>
      Effect.sync(() => {
        for (const [id, waiting] of known.waiting) {
          if (waiting.tool === tool) {
            known.waiting.delete(id);
          }
        }
      }),
  };
});
