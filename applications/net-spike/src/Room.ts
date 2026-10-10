import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Protocol from '#src/protocol.ts';
import * as Simulation from '#src/simulation.ts';
import { gaps, summarize } from '#src/stats.ts';
import * as Transport from '#src/Transport.ts';

/**
 * One world, stepped by one Durable Object at a fixed rate. It ticks only while someone is connected, so an empty room can hibernate and costs nothing.
 */

interface Attachment {
  readonly playerId: string;
}

// The moments and sizes kept for the stats endpoint; older ones are dropped.
const MAX_SAMPLES = 10_000;

const keepLast = (samples: Array<number>, sample: number) => {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
};

const frame = (channel: Transport.Channel, payload: string) =>
  Transport.encodeFrame({ channel, payload });

export default class Room extends Cloudflare.DurableObject<Room>()(
  'Room',
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    // Alchemy's two phases: this outer Effect binds once, and the inner one it returns builds each instance.
    // oxlint-disable-next-line effecttsgo/return-effect-in-gen
    return Effect.gen(function* () {
      // The timer and the socket handlers run outside any Effect; they reuse the services this instance was built with.
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      const sessions = new Map<string, Cloudflare.WebSocket>();
      const room = {
        world: Simulation.empty,
        pending: [] as Array<Simulation.Input>,
        loop: undefined as ReturnType<typeof setInterval> | undefined,
        tickMoments: [] as Array<number>,
        snapshotBytes: [] as Array<number>,
        wakes: 0,
      };

      // After hibernation the object is built anew: the sockets survive, the world in memory does not.
      for (const socket of yield* state.getWebSockets()) {
        const attachment = socket.deserializeAttachment<Attachment>();
        if (attachment !== null && attachment !== undefined) {
          sessions.set(attachment.playerId, socket);
          room.world = Simulation.join(room.world, attachment.playerId);
        }
      }
      if (sessions.size > 0) {
        room.wakes += 1;
      }

      const broadcast = (text: string) => {
        for (const socket of sessions.values()) {
          run(socket.send(text));
        }
      };

      const tick = () => {
        keepLast(room.tickMoments, Date.now());
        room.world = Simulation.step(room.world, room.pending.splice(0));
        const snapshot = frame(
          'unreliable',
          Protocol.encodeServerUnreliable({
            _tag: 'Snapshot',
            tick: room.world.tick,
            players: room.world.players,
          }),
        );
        keepLast(room.snapshotBytes, snapshot.length);
        broadcast(snapshot);
      };

      const start = () => {
        if (room.loop === undefined && sessions.size > 0) {
          room.loop = setInterval(tick, 1000 / Simulation.STEP_RATE);
        }
      };

      const stop = () => {
        if (room.loop !== undefined && sessions.size === 0) {
          clearInterval(room.loop);
          room.loop = undefined;
        }
      };

      const receive = (playerId: string, socket: Cloudflare.WebSocket, text: string) =>
        Option.flatMap(Transport.decodeFrame(text), (received) =>
          received.channel === 'unreliable'
            ? Protocol.decodeClientUnreliable(received.payload)
            : Option.none(),
        ).pipe(
          Option.map((message) => {
            switch (message._tag) {
              case 'Inputs':
                for (const input of message.inputs) {
                  room.pending.push({ playerId, ...input });
                }
                return;
              case 'Ping':
                run(
                  socket.send(
                    frame(
                      'unreliable',
                      Protocol.encodeServerUnreliable({
                        _tag: 'Pong',
                        sentAt: message.sentAt,
                        tick: room.world.tick,
                      }),
                    ),
                  ),
                );
                return;
            }
          }),
        );

      const stats = () => ({
        players: sessions.size,
        tick: room.world.tick,
        ticking: room.loop !== undefined,
        wakesFromHibernation: room.wakes,
        tickGapMillis: Option.getOrNull(summarize(gaps(room.tickMoments))),
        snapshotBytes: Option.getOrNull(summarize(room.snapshotBytes)),
      });

      return {
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest;
          if (new URL(request.url, 'http://room').pathname.endsWith('/stats')) {
            return yield* HttpServerResponse.json(stats());
          }
          const [response, socket] = yield* Cloudflare.upgrade();
          const playerId = crypto.randomUUID().slice(0, 8);
          socket.serializeAttachment({ playerId } satisfies Attachment);
          sessions.set(playerId, socket);
          room.world = Simulation.join(room.world, playerId);
          yield* socket.send(
            frame(
              'reliable',
              Protocol.encodeServerReliable({
                _tag: 'Welcome',
                playerId,
                stepRate: Simulation.STEP_RATE,
              }),
            ),
          );
          start();
          return response;
        }),
        webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
          Effect.sync(() => {
            const attachment = socket.deserializeAttachment<Attachment>();
            if (attachment === null || attachment === undefined || typeof message !== 'string') {
              return;
            }
            receive(attachment.playerId, socket, message);
            // A message can be what wakes the object from hibernation, with no loop running yet.
            start();
          }),
        webSocketClose: Effect.fn(function* (socket: Cloudflare.WebSocket, code: number) {
          const attachment = socket.deserializeAttachment<Attachment>();
          if (attachment !== null && attachment !== undefined) {
            sessions.delete(attachment.playerId);
            room.world = Simulation.leave(room.world, attachment.playerId);
          }
          stop();
          yield* socket.close(code, 'Left the room.');
        }),
      };
    });
  }),
) {}
