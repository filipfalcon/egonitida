import { Option } from 'effect';

/**
 * A bounding volume hierarchy: boxes nested in boxes, each holding a few items at its leaves, so a ray tests only the boxes it passes through rather than every item. It is built over the items' boxes alone, so one builder serves triangles and whole objects alike, and refitted, its shape kept and its boxes grown to where the items moved, when they move but stay together, such as a body's triangles as its bones bend it.
 *
 * Its nodes lie flat in one array, as a shader reads them: eight numbers each, the box's least corner and a number, then its greatest corner and another. A node with a count is a leaf, holding that many items from the first it names in `order`; one with none holds two children, the first at the index it names and the second just after it. Children always lie after their parent, so a refit walks the nodes from the last to the first.
 */

/** How many numbers each node takes. */
export const NODE = 8;

/** The most items a leaf holds, unless it cannot be split. */
export const LEAF = 4;

/** The deepest a hierarchy goes, so a shader walking it keeps a stack of known size: a leaf this deep holds whatever is left. */
export const DEEPEST = 24;

/** The bins a split is weighed in along an axis: enough to find a good split, few enough to weigh quickly. */
const BINS = 12;

/** A hierarchy built over some items: its nodes, and the order its leaves name the items in. */
export interface Hierarchy {
  readonly nodes: Float32Array;
  readonly order: Uint32Array;
}

/** A box, by its least and greatest corners. */
export interface Box {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** The area of the surface of a box whose sides run `x`, `y`, and `z`: how likely a ray through its parent is to pass through it. */
const area = (x: number, y: number, z: number) =>
  x < 0 || y < 0 || z < 0 ? 0 : 2 * (x * y + y * z + z * x);

/** Grows the box at `at` in `into` to hold the box at `from` in `boxes`. */
const grow = (into: Float64Array, at: number, boxes: Float32Array, from: number) => {
  for (let axis = 0; axis < 3; axis += 1) {
    into[at + axis] = Math.min(into[at + axis] ?? Infinity, boxes[from + axis] ?? Infinity);
    into[at + 3 + axis] = Math.max(
      into[at + 3 + axis] ?? -Infinity,
      boxes[from + 3 + axis] ?? -Infinity,
    );
  }
};

/** An empty box, which any box grown into it fills. */
const empty = (into: Float64Array, at: number) => {
  for (let axis = 0; axis < 3; axis += 1) {
    into[at + axis] = Infinity;
    into[at + 3 + axis] = -Infinity;
  }
};

/** The area of the box at `at` in `boxes`. */
const areaAt = (boxes: Float64Array, at: number) =>
  area(
    (boxes[at + 3] ?? 0) - (boxes[at] ?? 0),
    (boxes[at + 4] ?? 0) - (boxes[at + 1] ?? 0),
    (boxes[at + 5] ?? 0) - (boxes[at + 2] ?? 0),
  );

/** The middle of item `item`'s box along `axis`. */
const middle = (boxes: Float32Array, item: number, axis: number) =>
  ((boxes[item * 6 + axis] ?? 0) + (boxes[item * 6 + 3 + axis] ?? 0)) / 2;

/** Where the items from `first` to before `end` of `order` are best split, weighing each split by the areas of the boxes either side and the items in them: its axis and the middle it splits along, or none where no split is cheaper than a leaf. */
const bestSplit = (
  boxes: Float32Array,
  order: Uint32Array,
  first: number,
  end: number,
  parentArea: number,
): Option.Option<{ readonly axis: number; readonly at: number }> => {
  const count = end - first;
  const best = { cost: count, axis: -1, at: 0 };
  const bins = new Float64Array(BINS * 6);
  const counts = new Uint32Array(BINS);
  const left = new Float64Array(6);
  const leftAreas = new Float64Array(BINS);
  const leftCounts = new Uint32Array(BINS);
  for (let axis = 0; axis < 3; axis += 1) {
    let low = Infinity;
    let high = -Infinity;
    for (let index = first; index < end; index += 1) {
      const centre = middle(boxes, order[index] ?? 0, axis);
      low = Math.min(low, centre);
      high = Math.max(high, centre);
    }
    if (high - low <= 0) {
      continue;
    }
    const scale = BINS / (high - low);
    for (let bin = 0; bin < BINS; bin += 1) {
      empty(bins, bin * 6);
    }
    counts.fill(0);
    for (let index = first; index < end; index += 1) {
      const item = order[index] ?? 0;
      const bin = Math.min(Math.floor((middle(boxes, item, axis) - low) * scale), BINS - 1);
      counts[bin] = (counts[bin] ?? 0) + 1;
      grow(bins, bin * 6, boxes, item * 6);
    }
    // Swept from the left, the boxes and counts before each split; from the right, weighed against them.
    empty(left, 0);
    let leftCount = 0;
    for (let bin = 0; bin < BINS - 1; bin += 1) {
      growFrom(left, bins, bin * 6);
      leftCount += counts[bin] ?? 0;
      leftAreas[bin] = areaAt(left, 0);
      leftCounts[bin] = leftCount;
    }
    const right = new Float64Array(6);
    empty(right, 0);
    let rightCount = 0;
    for (let bin = BINS - 1; bin > 0; bin -= 1) {
      growFrom(right, bins, bin * 6);
      rightCount += counts[bin] ?? 0;
      const before = leftCounts[bin - 1] ?? 0;
      if (before === 0 || rightCount === 0) {
        continue;
      }
      const cost =
        0.5 +
        ((leftAreas[bin - 1] ?? 0) * before + areaAt(right, 0) * rightCount) /
          Math.max(parentArea, Number.MIN_VALUE);
      if (cost < best.cost) {
        best.cost = cost;
        best.axis = axis;
        best.at = low + bin / scale;
      }
    }
  }
  return best.axis === -1 ? Option.none() : Option.some({ axis: best.axis, at: best.at });
};

/** Grows the box at `at` in `into` to hold the box at `from` in `boxes`, both kept in doubles. */
const growFrom = (into: Float64Array, boxes: Float64Array, from: number) => {
  for (let axis = 0; axis < 3; axis += 1) {
    into[axis] = Math.min(into[axis] ?? Infinity, boxes[from + axis] ?? Infinity);
    into[3 + axis] = Math.max(into[3 + axis] ?? -Infinity, boxes[from + 3 + axis] ?? -Infinity);
  }
};

/** Moves the items from `first` to before `end` of `order` whose middles along `axis` lie below `at` before the rest, and gives where the rest begin. */
const partition = (
  boxes: Float32Array,
  order: Uint32Array,
  first: number,
  end: number,
  axis: number,
  at: number,
) => {
  let low = first;
  let high = end - 1;
  while (low <= high) {
    const item = order[low] ?? 0;
    if (middle(boxes, item, axis) < at) {
      low += 1;
    } else {
      order[low] = order[high] ?? 0;
      order[high] = item;
      high -= 1;
    }
  }
  return low;
};

/** Writes into `nodes` at node `node` the box holding the items from `first` to before `end` of `order`. */
const bound = (
  nodes: Float32Array,
  node: number,
  boxes: Float32Array,
  order: Uint32Array,
  first: number,
  end: number,
) => {
  const box = new Float64Array(6);
  empty(box, 0);
  for (let index = first; index < end; index += 1) {
    grow(box, 0, boxes, (order[index] ?? 0) * 6);
  }
  const at = node * NODE;
  nodes[at] = box[0] ?? 0;
  nodes[at + 1] = box[1] ?? 0;
  nodes[at + 2] = box[2] ?? 0;
  nodes[at + 4] = box[3] ?? 0;
  nodes[at + 5] = box[4] ?? 0;
  nodes[at + 6] = box[5] ?? 0;
  return areaAt(box, 0);
};

/**
 * A hierarchy over `count` items, whose boxes lie in `boxes`, six numbers each, the least corner and then the greatest: split where the boxes either side are smallest for the items in them, until a leaf holds a few, or splitting makes it no cheaper to pass through, or it is as deep as a hierarchy goes. No items make a root whose box holds nothing, its least corner past its greatest, which nothing walks.
 */
export const build = (boxes: Float32Array, count: number): Hierarchy => {
  const order = Uint32Array.from({ length: count }, (_, index) => index);
  // A binary tree over `count` leaves has fewer than twice as many nodes.
  const nodes = new Float32Array(Math.max(2 * count - 1, 1) * NODE);
  const pending: Array<{
    readonly node: number;
    readonly first: number;
    readonly end: number;
    readonly depth: number;
  }> = [{ node: 0, first: 0, end: count, depth: 0 }];
  let used = 1;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, first, end, depth } = next;
    const parentArea = bound(nodes, node, boxes, order, first, end);
    const leaf = () => {
      nodes[node * NODE + 3] = first;
      nodes[node * NODE + 7] = end - first;
    };
    if (end - first <= LEAF || depth >= DEEPEST) {
      leaf();
      continue;
    }
    const split = bestSplit(boxes, order, first, end, parentArea);
    if (Option.isNone(split)) {
      leaf();
      continue;
    }
    const between = partition(boxes, order, first, end, split.value.axis, split.value.at);
    if (between === first || between === end) {
      leaf();
      continue;
    }
    const children = used;
    used += 2;
    nodes[node * NODE + 3] = children;
    nodes[node * NODE + 7] = 0;
    pending.push(
      { node: children, first, end: between, depth: depth + 1 },
      { node: children + 1, first: between, end, depth: depth + 1 },
    );
  }
  return { nodes: nodes.slice(0, used * NODE), order };
};

/** Whether node `node` of `nodes` is a leaf. */
export const isLeaf = (nodes: Float32Array, node: number): boolean =>
  (nodes[node * NODE + 7] ?? 0) > 0;

/**
 * Grows the boxes of `hierarchy` to hold the items where their boxes, in `boxes`, are now, its shape kept: for items that moved but stay together, such as a body's triangles as its bones bend it, which a refit follows far more cheaply than a build.
 */
export const refit = (hierarchy: Hierarchy, boxes: Float32Array): void => {
  const { nodes, order } = hierarchy;
  for (let node = nodes.length / NODE - 1; node >= 0; node -= 1) {
    const at = node * NODE;
    const first = nodes[at + 3] ?? 0;
    const count = nodes[at + 7] ?? 0;
    if (count > 0) {
      bound(nodes, node, boxes, order, first, first + count);
      continue;
    }
    const left = first * NODE;
    const right = (first + 1) * NODE;
    for (let axis = 0; axis < 3; axis += 1) {
      nodes[at + axis] = Math.min(nodes[left + axis] ?? 0, nodes[right + axis] ?? 0);
      nodes[at + 4 + axis] = Math.max(nodes[left + 4 + axis] ?? 0, nodes[right + 4 + axis] ?? 0);
    }
  }
};

/** The box of the whole hierarchy: its root's. */
export const boxOf = (hierarchy: Hierarchy): Box => ({
  min: [hierarchy.nodes[0] ?? 0, hierarchy.nodes[1] ?? 0, hierarchy.nodes[2] ?? 0],
  max: [hierarchy.nodes[4] ?? 0, hierarchy.nodes[5] ?? 0, hierarchy.nodes[6] ?? 0],
});

/** How deep `hierarchy` goes: a root alone is one deep. */
export const depthOf = (hierarchy: Hierarchy): number => {
  const walk = (node: number): number =>
    isLeaf(hierarchy.nodes, node)
      ? 1
      : 1 +
        Math.max(
          walk(hierarchy.nodes[node * NODE + 3] ?? 0),
          walk((hierarchy.nodes[node * NODE + 3] ?? 0) + 1),
        );
  return hierarchy.order.length === 0 ? 1 : walk(0);
};

/** The boxes of the triangles of `positions`, three corners of three numbers each a triangle, six numbers a box. */
export const trianglesBoxes = (positions: Float32Array): Float32Array => {
  const count = positions.length / 9;
  const boxes = new Float32Array(count * 6);
  for (let triangle = 0; triangle < count; triangle += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const a = positions[triangle * 9 + axis] ?? 0;
      const b = positions[triangle * 9 + 3 + axis] ?? 0;
      const c = positions[triangle * 9 + 6 + axis] ?? 0;
      boxes[triangle * 6 + axis] = Math.min(a, b, c);
      boxes[triangle * 6 + 3 + axis] = Math.max(a, b, c);
    }
  }
  return boxes;
};

/** How many numbers each node of a threaded hierarchy takes: its least corner and the node after all it holds, its greatest corner and how many items it holds at a leaf, and the first of them. */
export const THREADED = 12;

/**
 * `hierarchy` laid out for a walk with no stack, as a shader walks it best: its nodes depth first, each naming, after its least corner, the node that follows everything it holds, -1 after the last. A walk enters a node whose box the ray meets by going on to the next, its first child, or testing its items if it is a leaf and then going to the node it names; it passes a node whose box the ray misses by going to the node it names.
 */
export const threaded = (hierarchy: Hierarchy): Float32Array => {
  const { nodes } = hierarchy;
  const count = nodes.length / NODE;
  const out = new Float32Array(count * THREADED);
  // A hierarchy over nothing is its root alone, holding nothing, which nothing walks into.
  if (hierarchy.order.length === 0) {
    out.set([
      nodes[0] ?? 0,
      nodes[1] ?? 0,
      nodes[2] ?? 0,
      -1,
      nodes[4] ?? 0,
      nodes[5] ?? 0,
      nodes[6] ?? 0,
    ]);
    return out;
  }
  const sizes = new Uint32Array(count);
  // Children lie after their parents, so walking back counts each subtree before its parent's.
  for (let node = count - 1; node >= 0; node -= 1) {
    const at = node * NODE;
    const first = nodes[at + 3] ?? 0;
    sizes[node] = isLeaf(nodes, node) ? 1 : 1 + (sizes[first] ?? 0) + (sizes[first + 1] ?? 0);
  }
  const pending: Array<{ readonly node: number; readonly place: number; readonly after: number }> =
    [{ node: 0, place: 0, after: -1 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, place, after } = next;
    const from = node * NODE;
    const to = place * THREADED;
    out[to] = nodes[from] ?? 0;
    out[to + 1] = nodes[from + 1] ?? 0;
    out[to + 2] = nodes[from + 2] ?? 0;
    out[to + 3] = after;
    out[to + 4] = nodes[from + 4] ?? 0;
    out[to + 5] = nodes[from + 5] ?? 0;
    out[to + 6] = nodes[from + 6] ?? 0;
    if (isLeaf(nodes, node)) {
      out[to + 7] = nodes[from + 7] ?? 0;
      out[to + 8] = nodes[from + 3] ?? 0;
      continue;
    }
    const left = nodes[from + 3] ?? 0;
    const leftPlace = place + 1;
    const rightPlace = leftPlace + (sizes[left] ?? 0);
    pending.push(
      { node: left, place: leftPlace, after: rightPlace },
      { node: left + 1, place: rightPlace, after },
    );
  }
  return out;
};
