import { Option } from 'effect';

/**
 * What a development server says once it is up: what it serves, at which version, and where the tools on this machine reach the game's devtools and its MCP server.
 */

/** The lines of the banner. */
export const lines = (served: {
  readonly name: string;
  readonly version: Option.Option<string>;
  readonly devtools: Option.Option<string>;
  readonly mcp: Option.Option<string>;
}): ReadonlyArray<string> => [
  `${served.name} | ${Option.match(served.version, { onNone: () => 'no version', onSome: (version) => `v${version}` })}`,
  `DevTools: ${Option.getOrElse(served.devtools, () => 'not started')}`,
  `MCP: ${Option.getOrElse(served.mcp, () => 'not served')}`,
];
