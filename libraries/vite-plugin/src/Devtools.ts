import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bridge, Relay } from '@egonitida/devtools';
import { Server } from '@egonitida/devtools-mcp';
import { Effect, Exit, Option, Schema, Scope } from 'effect';
import { type HotChannelClient, type Plugin, searchForWorkspaceRoot } from 'vite';
import * as Banner from '#src/Banner.ts';
import * as Http from '#src/Http.ts';
import * as Listener from '#src/Listener.ts';

/** What a package says it is, of what the banner shows. */
const Package = Schema.fromJsonString(
  Schema.Struct({ name: Schema.String, version: Schema.optional(Schema.String) }),
);

/** The name and version of the package at `root`, as its `package.json` gives them. */
const packageAt = (root: string) => {
  const read = Option.flatMap(
    Option.liftThrowable(() => readFileSync(join(root, 'package.json'), 'utf8'))(),
    Schema.decodeUnknownOption(Package),
  );
  return {
    name: Option.match(read, { onNone: () => root, onSome: ({ name }) => name }),
    version: Option.flatMap(read, ({ version }) => Option.fromNullishOr(version)),
  };
};

/** The question who is there, as it travels to every host. */
const who = Schema.encodeSync(Bridge.ToHost)({ _tag: 'Who' });

/**
 * The development server as the way to a game's hosts: the hosts, such as the worker each page starts, reach it on its own channel and say hello, and the tools on this machine, such as an MCP server, reach it on a loopback port of its own with the token its record holds. A relay between them hands each request to its host and each answer to whoever asked. The record is kept under the workspace's `node_modules/.egonitida/relays`, where a tool started anywhere in the workspace finds it. The server also serves the MCP server itself over HTTP, on that port to the proxy an agent starts, and at its own path, and once it is up, says in a banner what it serves and where both are reached.
 *
 * It runs only while serving, never in a build or under Vitest.
 */
export const plugin = (): Plugin => ({
  name: 'egonitida:devtools',
  apply: 'serve',
  configureServer: (server) => {
    if (process.env['VITEST'] !== undefined) {
      return;
    }
    const relay = Effect.runSync(Relay.make);
    const scope = Scope.makeUnsafe();
    // A host is known by the connection it reached the server on, the same one every time.
    const hosts = new WeakMap<HotChannelClient, Relay.Peer<Bridge.ToHost>>();
    const hostOn = (client: HotChannelClient) => {
      const known = hosts.get(client);
      if (known !== undefined) {
        return known;
      }
      const peer: Relay.Peer<Bridge.ToHost> = {
        send: (message) =>
          Schema.encodeEffect(Bridge.ToHost)(message).pipe(
            // A message the relay made itself always encodes; one that does not is a bug in it.
            Effect.orDie,
            Effect.flatMap((encoded) =>
              Effect.sync(() =>
                client.send({ type: 'custom', event: Bridge.EVENT, data: encoded }),
              ),
            ),
          ),
      };
      hosts.set(client, peer);
      return peer;
    };
    server.ws.on(Bridge.EVENT, (data: unknown, client: HotChannelClient) => {
      Effect.runFork(relay.fromHost(hostOn(client), data));
    });
    server.ws.on('vite:client:disconnect', (_: unknown, client: HotChannelClient) => {
      Effect.runFork(relay.hostGone(hostOn(client)));
    });
    const workspace = searchForWorkspaceRoot(server.config.root);
    const directory = join(workspace, ...Relay.RECORDS);

    const mcp = Server.web(workspace);
    server.middlewares.use(Server.PATH, Http.mounted(mcp.handler));

    // The banner waits for both what the relay came to and where the server listens, which come in either order.
    const banner = {
      devtools: Option.none<Option.Option<string>>(),
      listening: false,
      said: false,
    };
    const sayBanner = () => {
      if (banner.said || !banner.listening || Option.isNone(banner.devtools)) {
        return;
      }
      banner.said = true;
      const local = Option.fromNullishOr(server.resolvedUrls?.local[0]);
      server.config.logger.info(
        Banner.lines({
          ...packageAt(server.config.root),
          devtools: banner.devtools.value,
          mcp: Option.map(local, (url) => new URL(Server.PATH, url).href),
        }).join('\n'),
      );
    };
    const printUrls = server.printUrls.bind(server);
    server.printUrls = () => {
      printUrls();
      // The command line prints how to ask for help right after the addresses; the banner comes after that, last.
      setImmediate(() => {
        banner.listening = true;
        sayBanner();
      });
    };

    Effect.runFork(
      Listener.listen(relay, {
        directory,
        mcp: { path: Server.PATH, respond: mcp.handler },
      }).pipe(
        Effect.tap(({ url }) =>
          Effect.sync(() => {
            banner.devtools = Option.some(Option.some(url));
            sayBanner();
            // Hosts already running, such as after the server restarted, say hello again.
            server.ws.send(Bridge.EVENT, who);
          }),
        ),
        Effect.catch(({ reason }) =>
          Effect.sync(() => {
            server.config.logger.warn(`EgoNitida devtools relay did not start: ${reason}`);
            banner.devtools = Option.some(Option.none());
            sayBanner();
          }),
        ),
        Scope.provide(scope),
      ),
    );
    server.httpServer?.once('close', () => {
      Effect.runFork(Scope.close(scope, Exit.void));
      void mcp.dispose();
    });
  },
});
