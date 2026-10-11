import { expect, it } from '@effect/vitest';
import { Client, Host, Story, World } from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { Log, Recording, Replay, Transcript } from '@lightocean/devtools';
import { Effect, Option, Result } from 'effect';
import { TestClock } from 'effect/testing';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

const setup = { game: Game.game, join: Survivor.join, leave: World.despawn };

/** Twenty seconds of a survivor circling the arena, turning and firing as the horde comes, recorded. */
const played = Effect.gen(function* () {
  const host = yield* Host.make({ ...setup, world: Game.world, mayHold: false });
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

it.effect('replays as it was played', () =>
  Effect.gen(function* () {
    const recording = yield* played;

    expect(recording.entries.length).toBeGreaterThan(1000);
    expect(yield* Replay.check(setup, recording)).toEqual(Option.none());
  }),
);

it.effect('logs every shot a survivor fires, and every kill it makes', () =>
  Effect.gen(function* () {
    const text = Log.format(yield* Log.of(setup, yield* played));

    expect(text).toContain('  Horde: on PulledTrigger {"player":1}\n    set LastShot of 1');
    expect(text).toContain('    emitted Killed {"survivor":1}');
  }),
);

it.effect('is told as a story that holds, from what was played', () =>
  Effect.gen(function* () {
    const recording = yield* played;
    const { taken } = yield* Replay.steps(setup, recording);
    // A stretch after the survivor joined, as the horde rises, shambles, and falls to shots.
    const [start, end] = Option.getOrThrow(
      Option.all([Option.fromNullishOr(taken[300]), Option.fromNullishOr(taken[900])]),
    );
    const lines = Transcript.of(
      setup,
      start.world,
      taken.slice(301, 901).map(({ entry }) => entry),
      end.world,
    );

    expect(Result.isSuccess(lines)).toBe(true);
    expect(() =>
      Story.story(Game.game, ...Transcript.steps(Result.getOrThrow(lines))),
    ).not.toThrow();
  }),
);
