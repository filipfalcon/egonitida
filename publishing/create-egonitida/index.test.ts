import { execFileSync } from 'node:child_process';
import { describe, expect, it } from '@effect/vitest';

/** What `npm create egonitida` prints, run as npm runs its command. */
const printed = execFileSync(process.execPath, [new URL('index.js', import.meta.url).pathname], {
  encoding: 'utf8',
});

describe('create-egonitida', () => {
  it('says EgoNitida is not published yet, and where it is', () => {
    expect(printed).toContain('not published yet');
    expect(printed).toContain('https://github.com/filipfalcon/egonitida');
  });
});
