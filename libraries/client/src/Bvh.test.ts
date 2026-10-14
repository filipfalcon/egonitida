import { describe, expect, it } from '@effect/vitest';
import * as Bvh from '#src/Bvh.ts';

/** A stream of numbers from 0 to 1 that is the same for the same seed, so a test sees the same items each run. */
const numbers = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

/** `count` boxes scattered through a cube `spread` across, each up to `size` across. */
const scattered = (count: number, spread: number, size: number, seed = 7) => {
  const next = numbers(seed);
  const boxes = new Float32Array(count * 6);
  for (let item = 0; item < count; item += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const at = next() * spread;
      boxes[item * 6 + axis] = at;
      boxes[item * 6 + 3 + axis] = at + next() * size;
    }
  }
  return boxes;
};

/** Whether the box of node `node` holds the box `inner` of six numbers from `at`. */
const holds = (nodes: Float32Array, node: number, inner: Float32Array, at: number) =>
  [0, 1, 2].every(
    (axis) =>
      (nodes[node * Bvh.NODE + axis] ?? 0) <= (inner[at + axis] ?? 0) &&
      (nodes[node * Bvh.NODE + 4 + axis] ?? 0) >= (inner[at + 3 + axis] ?? 0),
  );

/** The items under node `node`, from its leaves. */
const itemsUnder = (hierarchy: Bvh.Hierarchy, node: number): ReadonlyArray<number> => {
  const { nodes, order } = hierarchy;
  const first = nodes[node * Bvh.NODE + 3] ?? 0;
  const count = nodes[node * Bvh.NODE + 7] ?? 0;
  return count > 0
    ? Array.from(order.slice(first, first + count))
    : [...itemsUnder(hierarchy, first), ...itemsUnder(hierarchy, first + 1)];
};

/** Every node's index, from the root down. */
const nodesOf = (hierarchy: Bvh.Hierarchy) =>
  Array.from({ length: hierarchy.nodes.length / Bvh.NODE }, (_, node) => node);

describe('a bounding volume hierarchy', () => {
  it('holds every item once, at a leaf whose box and every box above it hold the item', () => {
    const boxes = scattered(500, 100, 3);

    const hierarchy = Bvh.build(boxes, 500);

    expect(itemsUnder(hierarchy, 0).toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: 500 }, (_, item) => item),
    );
    for (const node of nodesOf(hierarchy)) {
      for (const item of itemsUnder(hierarchy, node)) {
        expect(holds(hierarchy.nodes, node, boxes, item * 6)).toBe(true);
      }
    }
  });

  it('keeps its leaves small, and lays children after their parent', () => {
    const hierarchy = Bvh.build(scattered(500, 100, 3), 500);

    for (const node of nodesOf(hierarchy)) {
      if (Bvh.isLeaf(hierarchy.nodes, node)) {
        expect(hierarchy.nodes[node * Bvh.NODE + 7]).toBeLessThanOrEqual(Bvh.LEAF);
      } else {
        expect(hierarchy.nodes[node * Bvh.NODE + 3]).toBeGreaterThan(node);
      }
    }
  });

  it('never goes deeper than a shader can walk, however the items lie', () => {
    // Every item in one place: no split separates them.
    const piled = new Float32Array(Array.from({ length: 300 }, () => [0, 0, 0, 1, 1, 1]).flat());
    // Each item twice as far as the one before: the most lopsided a split can be.
    const spread = new Float32Array(
      Array.from({ length: 60 }, (_, item) => [2 ** item, 0, 0, 2 ** item + 1, 1, 1]).flat(),
    );

    expect(Bvh.depthOf(Bvh.build(piled, 300))).toBeLessThanOrEqual(Bvh.DEEPEST + 1);
    expect(Bvh.depthOf(Bvh.build(spread, 60))).toBeLessThanOrEqual(Bvh.DEEPEST + 1);
    expect(itemsUnder(Bvh.build(piled, 300), 0)).toHaveLength(300);
  });

  it('is a root holding nothing over no items, and a leaf over a few', () => {
    const none = Bvh.build(new Float32Array(0), 0);

    expect(none.nodes).toHaveLength(Bvh.NODE);
    expect(Bvh.boxOf(none).min[0]).toBeGreaterThan(Bvh.boxOf(none).max[0]);
    expect(Bvh.isLeaf(Bvh.build(scattered(3, 10, 1), 3).nodes, 0)).toBe(true);
    expect(Bvh.threaded(none)[3]).toBe(-1);
  });

  it('follows its items where they moved when refitted, its shape kept', () => {
    const boxes = scattered(200, 50, 2);
    const hierarchy = Bvh.build(boxes, 200);
    const shape = Array.from({ length: hierarchy.nodes.length / Bvh.NODE }, (_, node) => [
      hierarchy.nodes[node * Bvh.NODE + 3],
      hierarchy.nodes[node * Bvh.NODE + 7],
    ]);
    const moved = boxes.map((value, index) => value + (index % 3 === 1 ? 10 : 0));

    Bvh.refit(hierarchy, moved);

    expect(
      Array.from({ length: hierarchy.nodes.length / Bvh.NODE }, (_, node) => [
        hierarchy.nodes[node * Bvh.NODE + 3],
        hierarchy.nodes[node * Bvh.NODE + 7],
      ]),
    ).toEqual(shape);
    for (const node of nodesOf(hierarchy)) {
      for (const item of itemsUnder(hierarchy, node)) {
        expect(holds(hierarchy.nodes, node, moved, item * 6)).toBe(true);
      }
    }
    expect(Bvh.boxOf(hierarchy).min[1]).toBeGreaterThanOrEqual(10);
  });

  it('boxes each triangle by its corners', () => {
    expect(Array.from(Bvh.trianglesBoxes(new Float32Array([0, 1, 2, 3, -1, 5, 1, 1, 1])))).toEqual([
      0, -1, 1, 3, 1, 5,
    ]);
  });

  it('is threaded for a walk with no stack: depth first, each node naming the one after all it holds', () => {
    const boxes = scattered(300, 60, 2);
    const hierarchy = Bvh.build(boxes, 300);

    const threaded = Bvh.threaded(hierarchy);

    const count = threaded.length / Bvh.THREADED;
    // Walking every node by entering each, as a ray meeting every box would, visits each once, in order.
    const visited: Array<number> = [];
    for (let node = 0; node !== -1 && visited.length <= count;) {
      visited.push(node);
      const leaf = (threaded[node * Bvh.THREADED + 7] ?? 0) > 0;
      node = leaf ? (threaded[node * Bvh.THREADED + 3] ?? -1) : node + 1;
    }
    // Skipping the root's box skips everything.
    const skipped = threaded[3];
    const items = Array.from({ length: count }, (_, node) => node).flatMap((node) => {
      const first = threaded[node * Bvh.THREADED + 8] ?? 0;
      const held = threaded[node * Bvh.THREADED + 7] ?? 0;
      return Array.from({ length: held }, (_, index) => hierarchy.order[first + index] ?? -1);
    });

    expect(visited).toEqual(Array.from({ length: count }, (_, node) => node));
    expect(skipped).toBe(-1);
    expect(items.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 300 }, (_, item) => item));
  });
});
