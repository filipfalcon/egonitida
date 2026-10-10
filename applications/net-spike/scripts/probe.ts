import { Console, Effect, Option, Schedule, Stream } from 'effect';
import * as Protocol from '#src/protocol.ts';
import * as Simulation from '#src/simulation.ts';
import { gaps, summarize } from '#src/stats.ts';
import * as WebSocketTransport from '#src/WebSocketTransport.ts';

/**
 * Connects a few clients to a room, plays for a while, and reports what the network did: round trips, how evenly snapshots arrived, how many were missing or stale, and how the room itself ticked.
 *
 *   node scripts/probe.ts [url] [clients] [seconds]
 */

const [url = 'ws://localhost:5390/rooms/probe', clientCount = '2', durationSeconds = '20'] =
  process.argv.slice(2);

const INPUT_RATE = 60;
const PING_EVERY_MILLIS = 250;

const playClient = (index: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { connection, droppedUnreliable } = yield* WebSocketTransport.connect(url);
      const record = {
        playerId: '',
        snapshotArrivals: [] as Array<number>,
        roundTrips: [] as Array<number>,
        firstTick: 0,
        lastTick: 0,
        outOfOrder: 0,
      };

      yield* connection.frames.pipe(
        Stream.runForEach((frame) =>
          Effect.sync(() => {
            const now = performance.now();
            if (frame.channel === 'reliable') {
              Option.map(Protocol.decodeServerReliable(frame.payload), (welcome) => {
                record.playerId = welcome.playerId;
              });
              return;
            }
            Option.map(Protocol.decodeServerUnreliable(frame.payload), (message) => {
              if (message._tag === 'Pong') {
                record.roundTrips.push(now - message.sentAt);
                return;
              }
              // A snapshot no newer than the last one is useless to a client that must survive reordering.
              if (message.tick <= record.lastTick) {
                record.outOfOrder += 1;
                return;
              }
              if (record.firstTick === 0) {
                record.firstTick = message.tick;
              }
              record.lastTick = message.tick;
              record.snapshotArrivals.push(now);
            });
          }),
        ),
        Effect.forkScoped,
      );

      const inputs = { seq: 0, history: [] as Array<{ seq: number; move: Simulation.Vector2 }> };
      const sendInputs = Effect.suspend(() => {
        inputs.seq += 1;
        const angle = (inputs.seq / INPUT_RATE) * Math.PI + index;
        inputs.history = [
          { seq: inputs.seq, move: [Math.cos(angle), Math.sin(angle)] as const },
          ...inputs.history,
        ].slice(0, Protocol.MAX_REPEATED_INPUTS);
        return connection.send({
          channel: 'unreliable',
          payload: Protocol.encodeClientUnreliable({ _tag: 'Inputs', inputs: inputs.history }),
        });
      });
      const ping = Effect.suspend(() =>
        connection.send({
          channel: 'unreliable',
          payload: Protocol.encodeClientUnreliable({ _tag: 'Ping', sentAt: performance.now() }),
        }),
      );

      yield* Effect.all(
        [
          sendInputs.pipe(Effect.repeat(Schedule.fixed(`${1000 / INPUT_RATE} millis`))),
          ping.pipe(Effect.repeat(Schedule.fixed(`${PING_EVERY_MILLIS} millis`))),
        ],
        { concurrency: 'unbounded' },
      ).pipe(Effect.timeoutOption(`${Number(durationSeconds)} seconds`));

      return {
        client: index,
        playerId: record.playerId,
        // The world's own clock: how far it moved while this client watched, against what real time called for.
        stepsWatched: record.lastTick - record.firstTick,
        stepsExpected: Math.round(Number(durationSeconds) * Simulation.STEP_RATE),
        snapshotsReceived: record.snapshotArrivals.length,
        snapshotsOutOfOrder: record.outOfOrder,
        unreliableDroppedAsStale: droppedUnreliable(),
        roundTripMillis: Option.getOrNull(summarize(record.roundTrips)),
        snapshotGapMillis: Option.getOrNull(summarize(gaps(record.snapshotArrivals))),
      };
    }),
  );

const roomStats = Effect.tryPromise(() =>
  fetch(`${url.replace(/^ws/, 'http')}/stats`).then((response) => response.json()),
).pipe(Effect.orElseSucceed(() => 'The room did not answer.'));

const program = Effect.gen(function* () {
  yield* Console.log(`Probing ${url} with ${clientCount} clients for ${durationSeconds} s…`);
  const clients = yield* Effect.forEach(
    Array.from({ length: Number(clientCount) }, (_, index) => index),
    playClient,
    { concurrency: 'unbounded' },
  );
  // Asked while the clients are still connected would be fairer; asked afterwards, it reports the whole run.
  const room = yield* roomStats;
  yield* Console.log(JSON.stringify({ clients, room }, null, 2));
});

Effect.runPromise(program).catch((error: unknown) => {
  process.exitCode = 1;
  return Effect.runPromise(Console.error(error));
});
