import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Banner from '#src/Banner.ts';

describe('the banner', () => {
  it('says what is served, at which version, and where its devtools and its MCP server are reached', () => {
    expect(
      Banner.lines({
        name: '@lightocean/editor',
        version: Option.some('0.1.0'),
        devtools: Option.some('ws://127.0.0.1:56190/'),
        mcp: Option.some('http://127.0.0.1:5173/__lightocean/mcp'),
      }),
    ).toEqual([
      '@lightocean/editor | v0.1.0',
      'DevTools: ws://127.0.0.1:56190/',
      'MCP: http://127.0.0.1:5173/__lightocean/mcp',
    ]);
  });

  it('says plainly what is not there', () => {
    expect(
      Banner.lines({
        name: 'game',
        version: Option.none(),
        devtools: Option.none(),
        mcp: Option.none(),
      }),
    ).toEqual(['game | no version', 'DevTools: not started', 'MCP: not served']);
  });
});
