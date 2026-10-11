import { join } from 'node:path';
import { Bridge, Relay } from '@lightocean/devtools';
import { Effect, Exit, Schema, Scope } from 'effect';
import { type HotChannelClient, type Plugin, searchForWorkspaceRoot } from 'vite';
import * as Listener from '#src/Listener.ts';

/** The question who is there, as it travels to every host. */
const who = Schema.encodeSync(Bridge.ToHost)({ _tag: 'Who' });

/**
 * The development server as the way to a game's hosts: the hosts, such as the worker each page starts, reach it on its own channel and say hello, and the tools on this machine, such as an MCP server, reach it on a loopback port of its own with the token its record holds. A relay between them hands each request to its host and each answer to whoever asked. The record is kept under the workspace's `node_modules/.lightocean`, where a tool started anywhere in the workspace finds it.
 *
 * It runs only while serving, never in a build or under Vitest.
 */
export const plugin = (): Plugin => ({
  name: 'lightocean:devtools',
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
    const directory = join(
      searchForWorkspaceRoot(server.config.root),
      'node_modules',
      '.lightocean',
    );
    Effect.runFork(
      Listener.listen(relay, { directory }).pipe(
        Effect.tap(({ url }) =>
          Effect.sync(() => {
            server.config.logger.info(`  LightOcean devtools relay at ${url}`);
            // Hosts already running, such as after the server restarted, say hello again.
            server.ws.send(Bridge.EVENT, who);
          }),
        ),
        Effect.catch(({ reason }) =>
          Effect.sync(() =>
            server.config.logger.warn(`LightOcean devtools relay did not start: ${reason}`),
          ),
        ),
        Scope.provide(scope),
      ),
    );
    server.httpServer?.once('close', () => {
      Effect.runFork(Scope.close(scope, Exit.void));
    });
  },
});
