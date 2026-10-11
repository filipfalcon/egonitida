import { describe, expect, it } from '@effect/vitest';
import * as Tab from '#src/Tab.ts';

/** A tab's storage, kept in memory. */
const storage = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => {
      kept.set(key, value);
    },
  };
};

describe('a tab', () => {
  it('keeps the id it was first given across reloads of its page, one for each prefix', () => {
    const tab = storage();

    const first = Tab.id('horde', tab);

    expect(first).toMatch(/^horde-/);
    expect(Tab.id('horde', tab)).toBe(first);
    expect(Tab.id('cubes', tab)).not.toBe(first);
    expect(Tab.id('horde', storage())).not.toBe(first);
  });

  it('gives an id of its own each time where nothing can be kept', () => {
    const refusing = {
      getItem: () => {
        throw new Error('storage is blocked');
      },
      setItem: () => {
        throw new Error('storage is blocked');
      },
    };

    expect(Tab.id('horde', refusing)).toMatch(/^horde-/);
  });
});
