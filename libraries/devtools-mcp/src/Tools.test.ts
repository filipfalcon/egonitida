import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Relay } from '@lightocean/devtools';
import { Effect } from 'effect';
import { PIXEL, served } from '#src/fixtures.ts';
import * as Tools from '#src/Tools.ts';

/** A workspace with a relay running in it, and the tools as an agent started inside it has them. */
const workspace = Effect.gen(function* () {
  const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'lightocean-tools-')));
  const inside = join(root, 'examples', 'counting');
  yield* Effect.promise(() => mkdir(inside, { recursive: true }));
  yield* served(['counting'], join(root, ...Relay.RECORDS));
  return Tools.implementations(inside);
});

describe('the tools', () => {
  it.live('find the relay of the workspace, and answer with what the host answered', () =>
    Effect.gen(function* () {
      const tools = yield* workspace;

      const hosts = yield* tools.lightocean_hosts();
      yield* tools.lightocean_step({ count: 2 });
      const state = yield* tools.lightocean_state({ component: 'Count' });

      expect(hosts).toEqual([{ host: 'counting', name: 'counting' }]);
      expect(state).toEqual({ tick: 2, entities: { 0: { Count: { value: 2 } } } });
    }),
  );

  it.live('say why they could not', () =>
    Effect.gen(function* () {
      const tools = yield* workspace;

      const refused = yield* tools
        .lightocean_state({ tick: 99 })
        .pipe(Effect.match({ onFailure: ({ reason }) => reason, onSuccess: () => 'answered' }));

      expect(refused).toBe('tick 99 is not kept: ticks 0 to 0 are');
    }),
  );

  it.live('play the game as players they join', () =>
    Effect.gen(function* () {
      const tools = yield* workspace;

      const joined = yield* tools.lightocean_join({});
      const state = yield* tools.lightocean_state({});

      expect(joined).toEqual({ entity: 1 });
      expect(state).toMatchObject({ entities: { 1: { Count: { value: 0 } } } });
    }),
  );

  it('are every request an inspector answers, and the hosts running', () => {
    expect(Object.keys(Tools.toolkit.tools).toSorted()).toEqual(
      [
        'lightocean_act',
        'lightocean_step',
        'lightocean_compare',
        'lightocean_describe',
        'lightocean_suspend',
        'lightocean_hosts',
        'lightocean_demand',
        'lightocean_join',
        'lightocean_leave',
        'lightocean_live',
        'lightocean_log',
        'lightocean_play_from',
        'lightocean_resume',
        'lightocean_seek',
        'lightocean_span',
        'lightocean_story',
        'lightocean_state',
      ].toSorted(),
    );
  });

  it.live('show what a page draws, as an image', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'lightocean-tools-')));
      yield* served(['counting'], join(root, ...Relay.RECORDS));

      const shown = yield* Tools.screenshot(root)({ width: 64 });
      const refused = yield* Tools.screenshot(root)({ host: 'nowhere' });

      expect(shown.isError).not.toBe(true);
      expect(shown.content).toMatchObject([
        { type: 'image', mimeType: 'image/png', data: Buffer.from(PIXEL, 'base64') },
        { type: 'text', text: 'a shot 64 by 1 pixels' },
      ]);
      expect(refused).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('no host is called nowhere') }],
      });
    }),
  );
});
