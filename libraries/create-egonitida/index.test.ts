import { execFileSync } from 'node:child_process';
import { describe, expect, it } from '@effect/vitest';

/** What `npm create egonitida` prints, run as npm runs its command. */
const printed = execFileSync(
  process.execPath,
  [new URL('src/index.ts', import.meta.url).pathname],
  {
    encoding: 'utf8',
  },
);

describe('create-egonitida', () => {
  it('names EgoNitida as egonitida does', () => {
    expect(printed).toContain('A real-time 3D engine built on Effect, Three.js, and Foldkit.');
    expect(printed).not.toContain('released');
  });

  it('lists every official channel', () => {
    for (const link of [
      'https://egonitida.com',
      'https://github.com/egonitida/egonitida',
      'https://npmjs.com/org/egonitida',
      'https://discord.gg/6zsggGTGZf',
      'https://x.com/egonitida',
      'https://instagram.com/egonitida',
      'https://threads.com/@egonitida',
    ]) {
      expect(printed).toContain(link);
    }
  });
});
