import { describe, expect, it } from '@effect/vitest';
import { Client, type State } from '@egonitida/core';
import { Transport } from '@egonitida/core/internal';
import { Effect, Option, Stream } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';
import * as Fixtures from '#src/fixtures.ts';
import * as Rewind from '#src/Rewind.ts';

/** A host, with a rewind beside it, and every state it stepped to, by tick. */
const rewound = (options: Rewind.Options) =>
  Effect.gen(function* () {
    const hosted = yield* Fixtures.host(Fixtures.game, true);
    const rewind = yield* Rewind.make(hosted, Fixtures.setup(), options);
    const stepped = new Map<number, State.State>();
    const watching = yield* hosted.watch;
    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Stepped') {
            stepped.set(happening.state.tick, happening.state);
          }
        }),
      ),
      Effect.forkScoped,
    );
    return { hosted, rewind, stepped };
  });

const fingerprint = (state: State.State) => Fingerprint.of(Fixtures.game, state);

describe('a rewind', () => {
  it.effect('comes back to the state the host was at, at any tick it keeps', () =>
    Effect.gen(function* () {
      const { hosted, rewind, stepped } = yield* rewound({ every: 4, keepSeconds: 10 });
      yield* Fixtures.visit(hosted);
      yield* Fixtures.elapse(200);

      const back = yield* Effect.forEach([2, 4, 5, 7, 9], (tick) =>
        Effect.map(rewind.stateAt(tick), Option.map(fingerprint)),
      );

      expect(back).toEqual(
        [2, 4, 5, 7, 9].map((tick) =>
          Option.map(Option.fromNullishOr(stepped.get(tick)), fingerprint),
        ),
      );
    }),
  );

  it.effect('keeps only so far back', () =>
    Effect.gen(function* () {
      const { rewind } = yield* rewound({ every: 3, keepSeconds: 1 });
      yield* Fixtures.elapse(3000);

      const { oldest, newest } = yield* rewind.span;

      expect(newest).toBe(90);
      expect(oldest).toBeGreaterThanOrEqual(newest - 30 - 3);
      expect(oldest).toBeLessThanOrEqual(newest - 30);
      expect(yield* rewind.stateAt(oldest - 1)).toEqual(Option.none());
    }),
  );
});

describe('rewinding from a page', () => {
  const paged = Effect.gen(function* () {
    const { hosted, rewind } = yield* rewound({ every: 5, keepSeconds: 10 });
    yield* Rewind.serve(hosted, rewind);
    const [clientEnd, hostEnd] = yield* Transport.memoryPair;
    yield* hosted.connect(hostEnd);
    const client = yield* Client.connect(clientEnd, { game: Fixtures.game });
    yield* client.send([Fixtures.Stick.of({ move: 1 })]);
    yield* Fixtures.elapse(300);
    return { hosted, client, controls: Rewind.controls(client) };
  });

  it.effect('suspends time and shows the page a past tick, then the live state again', () =>
    Effect.gen(function* () {
      const { hosted, client, controls } = yield* paged;
      const live = yield* hosted.state;

      yield* controls.suspend;
      yield* controls.seek(4);
      yield* Fixtures.elapse(100);
      const shown = (yield* client.state).tick;
      yield* controls.live;
      yield* Fixtures.elapse(10);

      expect(shown).toBe(4);
      expect((yield* hosted.state).tick).toBe(live.tick);
      expect((yield* client.state).tick).toBeGreaterThanOrEqual(live.tick);
    }),
  );

  it.effect('steps back and forth from the tick shown', () =>
    Effect.gen(function* () {
      const { client, controls } = yield* paged;

      yield* controls.suspend;
      yield* controls.seek(6);
      yield* controls.step(-2);
      yield* Fixtures.elapse(10);
      const back = (yield* client.state).tick;
      yield* controls.step(3);
      yield* Fixtures.elapse(10);

      expect(back).toBe(4);
      expect((yield* client.state).tick).toBe(7);
    }),
  );

  it.effect('plays on from the tick shown, the time after it gone', () =>
    Effect.gen(function* () {
      const { hosted, controls } = yield* paged;

      yield* controls.suspend;
      yield* controls.seek(4);
      yield* controls.playFromHere;
      yield* Fixtures.elapse(100);

      expect((yield* hosted.state).tick).toBe(7);
    }),
  );
});
