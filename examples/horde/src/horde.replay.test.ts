import { expect, it } from '@effect/vitest';
import { Client, Host, Story, State } from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { Log, Recording, Replay, Transcript } from '@lightocean/devtools';
import { Effect, Option, Result } from 'effect';
import { TestClock } from 'effect/testing';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

const setup = { game: Game.game, join: Survivor.join, leave: State.despawn };

/** How long a test that plays twenty seconds of the horde may take, beside every other test running at once. */
const PLAYING = 30_000;

/** Twenty seconds of a survivor circling the arena, turning and firing as the horde comes, recorded. */
const played = Effect.gen(function* () {
  const host = yield* Host.make({ ...setup, state: Game.state, mayHold: false });
  const recorder = yield* Recording.record(host, Game.game);
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game: Game.game });
  for (let tenth = 0; tenth < 200; tenth += 1) {
    const angle = tenth / 20;
    yield* client.send([
      Survivor.Stick.of({ x: Math.cos(angle), z: Math.sin(angle), aim: angle * 3 }),
    ]);
    if (tenth % 3 === 0) {
      yield* client.act(Survivor.PulledTrigger, {});
    }
    for (let millis = 0; millis < 100; millis += 10) {
      yield* TestClock.adjust('10 millis');
      yield* Effect.yieldNow;
    }
  }
  return yield* recorder.recording;
});

it.effect(
  'replays as it was played',
  () =>
    Effect.gen(function* () {
      const recording = yield* played;

      expect(recording.entries.length).toBeGreaterThan(1000);
      expect(yield* Replay.check(setup, recording)).toEqual(Option.none());
    }),
  PLAYING,
);

it.effect(
  'logs every shot a survivor fires, and every kill it makes',
  () =>
    Effect.gen(function* () {
      const text = Log.format(yield* Log.of(setup, yield* played));

      expect(text).toContain('  Horde: on PulledTrigger {"player":1}\n    set LastShot of 1');
      expect(text).toContain('    emitted Killed {"survivor":1}');
    }),
  PLAYING,
);

it.effect(
  'is told as a story that holds, from what was played',
  () =>
    Effect.gen(function* () {
      const recording = yield* played;
      const { taken } = yield* Replay.steps(setup, recording);
      // A stretch after the survivor joined, as the horde rises, shambles, and falls to shots.
      const [start, end] = Option.getOrThrow(
        Option.all([Option.fromNullishOr(taken[300]), Option.fromNullishOr(taken[900])]),
      );
      const lines = Transcript.of(
        setup,
        start.state,
        taken.slice(301, 901).map(({ entry }) => entry),
        end.state,
      );

      expect(Result.isSuccess(lines)).toBe(true);
      expect(() =>
        Story.story(Game.game, ...Transcript.steps(Result.getOrThrow(lines))),
      ).not.toThrow();
    }),
  PLAYING,
);
