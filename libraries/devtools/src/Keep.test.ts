import { describe, expect, it } from '@effect/vitest';
import { State } from '@nitida/core';
import { Transport } from '@nitida/core/internal';
import { Effect, Option } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Keep from '#src/Keep.ts';

describe('a state kept across reloads of the page', () => {
  it.effect('is the state the host was at when last kept, read back by the game', () =>
    Effect.gen(function* () {
      const store = Keep.memory();
      const hosted = yield* Fixtures.host();
      yield* Keep.serve(store, hosted, Fixtures.game, { key: 'tab-1', everyMillis: 50 });
      yield* Fixtures.visit(hosted);
      yield* hosted.suspend;
      yield* Fixtures.elapse(100);
      const now = yield* hosted.state;

      const kept = yield* Keep.load(store, Fixtures.game, 'tab-1');

      expect(Option.map(kept, ({ state }) => state.tick)).toEqual(Option.some(now.tick));
      expect(yield* Keep.load(store, Fixtures.game, 'tab-2')).toEqual(Option.none());
    }),
  );

  it.effect('is not taken up by a game that cannot read it, which starts afresh', () =>
    Effect.gen(function* () {
      const store = Keep.memory();
      yield* store.set('tab-1', { tick: 'soon' });

      expect(yield* Keep.load(store, Fixtures.game, 'tab-1')).toEqual(Option.none());
    }),
  );

  it.effect('keeps the state the host plays, as the build it takes up encodes it', () =>
    Effect.gen(function* () {
      const store = Keep.memory();
      const hosted = yield* Fixtures.host();
      yield* Keep.serve(store, hosted, Fixtures.game, { key: 'tab-1', everyMillis: 50 });
      yield* hosted.reload(Fixtures.setup(Fixtures.brisk));
      yield* Fixtures.elapse(100);

      const kept = yield* Keep.load(store, Fixtures.brisk, 'tab-1');

      expect(Option.map(kept, ({ state }) => State.entities(state))).toEqual(Option.some([]));
      expect(Option.map(kept, ({ state }) => state.tick > 0)).toEqual(Option.some(true));
    }),
  );

  it.effect(
    'keeps which players joined through a client and are still there, and none joined beside',
    () =>
      Effect.gen(function* () {
        const store = Keep.memory();
        const hosted = yield* Fixtures.host();
        yield* Keep.serve(store, hosted, Fixtures.game, { key: 'tab-1', everyMillis: 50 });
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        const player = yield* hosted.connect(hostEnd);
        void clientEnd;
        yield* hosted.join;
        yield* Fixtures.elapse(100);

        const kept = yield* Keep.load(store, Fixtures.game, 'tab-1');

        expect(Option.map(kept, ({ players }) => players)).toEqual(Option.some([player]));
      }),
  );
});
