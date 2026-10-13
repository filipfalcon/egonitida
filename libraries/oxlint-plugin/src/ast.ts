import type { RuleTester } from 'oxlint/plugins-dev';

/**
 * What the rules are written against, read off the rule tester's own types, since Oxlint gives them no names of their own.
 */

export type Rule = Parameters<RuleTester['run']>[1];
export type Context = Parameters<NonNullable<Rule['create']>>[0];
export type Visitor = ReturnType<NonNullable<Rule['create']>>;
export type CallExpression = Parameters<NonNullable<Visitor['CallExpression']>>[0];
export type NewExpression = Parameters<NonNullable<Visitor['NewExpression']>>[0];
export type ImportDeclaration = Parameters<NonNullable<Visitor['ImportDeclaration']>>[0];
export type Node = CallExpression['parent'];

/** `Object.property`, for a call such as `System.make(…)` or `Math.random()`; nothing for any other callee. */
export const calleeName = (call: CallExpression | NewExpression): string | undefined => {
  const callee = call.callee;
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier'
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return undefined;
};

/** The parts of the engine whose functions run every step or every frame: which call makes them, and which of their functions it is. */
export const PARTS: ReadonlyArray<readonly [callee: string, property: string]> = [
  ['System.make', 'run'],
  ['Rule.on', 'run'],
  ['View.each', 'draw'],
  ['View.whole', 'draw'],
  ['View.follow', 'of'],
];

/** A part's function, run every step or every frame, that something sits in: which call made the part, which of its functions it is, and the function. */
export interface PartFunction {
  readonly callee: string;
  readonly key: string;
  readonly function_: Node;
}

/** The part's function, of `parts`, those run every step or every frame unless told, that `node` sits in, if any: `System.make`'s `run`, say. */
export const enclosingPartFunction = (
  node: Node,
  parts: ReadonlyArray<readonly [callee: string, property: string]> = PARTS,
): PartFunction | undefined => {
  for (let at: Node | null = node; at !== null; at = at.parent) {
    if (at.type !== 'ArrowFunctionExpression' && at.type !== 'FunctionExpression') continue;
    const property = at.parent;
    if (property?.type !== 'Property' || property.key.type !== 'Identifier') continue;
    const call = property.parent?.parent;
    if (call?.type !== 'CallExpression') continue;
    const callee = calleeName(call);
    const key = property.key.name;
    if (
      callee !== undefined &&
      parts.some(([name, function_]) => name === callee && function_ === key)
    ) {
      return { callee, key, function_: at };
    }
  }
  return undefined;
};

/** Which part's function, run every step or every frame, `node` sits in, if any, as a message names it. */
export const enclosingPart = (
  node: Node,
  parts: ReadonlyArray<readonly [callee: string, property: string]> = PARTS,
): string | undefined => {
  const part = enclosingPartFunction(node, parts);
  return part === undefined ? undefined : `${part.callee}'s \`${part.key}\``;
};

/** Whether `node` is `ancestor` or sits within it. */
export const within = (node: Node | null, ancestor: Node): boolean => {
  for (let at: Node | null = node; at !== null; at = at.parent) {
    if (at === ancestor) return true;
  }
  return false;
};

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';

/** Whether anything within `node`, it included, is such that `found` says so. */
export const contains = (node: Node, found: (node: Node) => boolean): boolean =>
  found(node) ||
  Object.entries(node).some(
    ([key, value]) =>
      key !== 'parent' &&
      (Array.isArray(value)
        ? value.some((item) => isNode(item) && contains(item, found))
        : isNode(value) && contains(value, found)),
  );
