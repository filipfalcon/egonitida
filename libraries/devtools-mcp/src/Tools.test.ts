import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Relay } from '@lightocean/devtools';
import { Effect } from 'effect';
import { served } from '#src/fixtures.ts';
import * as Tools from '#src/Tools.ts';

/** A workspace with a relay running in it, and the tools as an agent started inside it has them. */
const workspace = Effect.gen(function* () {
  const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'lightocean-tools-')));
  const inside = join(root, 'examples', 'counting');
  yield* Effect.promise(() => mkdir(inside, { recursive: true }));
  yield* served(['counting'], join(root, ...Relay.RECORDS));
  return Tools.handlers(inside);
});

describe('the tools', () => {
  it.live('find the relay of the workspace, and answer with what the host answered', () =>
    Effect.gen(function* () {
      const tools = yield* workspace;

      const hosts = yield* tools.lightocean_hosts();
      yield* tools.lightocean_advance({ steps: 2 });
      const world = yield* tools.lightocean_world({ component: 'Count' });

      expect(hosts).toEqual([{ host: expect.stringMatching(/^counting-/), name: 'counting' }]);
      expect(world).toEqual({ tick: 2, entities: { 0: { Count: { value: 2 } } } });
    }),
  );

  it.live('say why they could not', () =>
    Effect.gen(function* () {
      const tools = yield* workspace;

      const refused = yield* tools
        .lightocean_world({ tick: 99 })
        .pipe(Effect.match({ onFailure: ({ reason }) => reason, onSuccess: () => 'answered' }));

      expect(refused).toBe('tick 99 is not kept: ticks 0 to 0 are');
    }),
  );

  it('are every request an inspector answers, and the hosts running', () => {
    expect(Object.keys(Tools.toolkit.tools).toSorted()).toEqual(
      [
        'lightocean_advance',
        'lightocean_compare',
        'lightocean_describe',
        'lightocean_hold',
        'lightocean_hosts',
        'lightocean_live',
        'lightocean_log',
        'lightocean_play_from',
        'lightocean_release',
        'lightocean_seek',
        'lightocean_span',
        'lightocean_world',
      ].toSorted(),
    );
  });
});
