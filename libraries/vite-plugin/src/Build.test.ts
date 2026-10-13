import { describe, expect, it } from '@effect/vitest';
import * as Build from '#src/Build.ts';

/** A module imported by `importers`. */
const module = (...importers: ReadonlyArray<Build.Imported>): Build.Imported => ({
  importers: new Set(importers),
});

describe('Build.runBy', () => {
  const worker = module();
  const game = module(worker);
  const rules = module(game);
  const page = module();
  const view = module(page);

  it('is whether a change reaches the importer of the build, however deep', () => {
    expect(Build.runBy(rules, new Set([worker]))).toBe(true);
    expect(Build.runBy(worker, new Set([worker]))).toBe(true);
  });

  it('is not, for a change only the page runs', () => {
    expect(Build.runBy(view, new Set([worker]))).toBe(false);
  });

  it('ends on a cycle of imports', () => {
    const first: { importers: Set<Build.Imported> } = { importers: new Set() };
    const second = module(first);
    first.importers.add(second);
    expect(Build.runBy(first, new Set([worker]))).toBe(false);
  });
});

describe('Build.sourceOf', () => {
  it('is a module exporting the build by its id', () => {
    expect(Build.sourceOf('a1')).toContain('export const build = "a1";');
  });
});
