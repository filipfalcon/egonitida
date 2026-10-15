import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@effect/vitest';

/** What `npx egonitida` prints, run as npm runs its command. */
const printed = execFileSync(
  process.execPath,
  [new URL('src/index.ts', import.meta.url).pathname],
  {
    encoding: 'utf8',
  },
);

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));

describe('egonitida', () => {
  it('names EgoNitida at the version published', () => {
    expect(printed).toContain(`EgoNitida ${version}`);
  });

  it('lists every official channel', () => {
    for (const link of [
      'https://egonitida.com',
      'https://github.com/egonitida/egonitida',
      'https://npmjs.com/org/egonitida',
      'https://x.com/egonitida',
      'https://www.instagram.com/egonitida',
      'https://www.threads.net/@egonitida',
    ]) {
      expect(printed).toContain(link);
    }
  });
});
