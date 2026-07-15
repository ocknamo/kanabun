/**
 * Query helpers over the mock DOM tree. Subtree queries walk in document
 * order (the same semantics the core and router suites relied on).
 *
 * Two tiers, testing-library style: `queryBy*` returns `undefined` on a miss
 * (assert absence, or branch), `getBy*` throws with the serialized tree — on
 * a miss *and* on multiple matches, so `getBy*` asserts a single match while a
 * failed lookup reads as a real failure message (not a `.toBeDefined()` on
 * `undefined`). `queryBy*` returns the *first* match in document order; reach
 * for `queryAllBy*` when several are expected.
 */
import { serialize, type MockNode } from "./dom-mock";

/** Collect `node` and every descendant (all node types), document order. */
export function walk(node: MockNode, out: MockNode[] = []): MockNode[] {
  out.push(node);
  for (const child of node.childNodes) walk(child, out);
  return out;
}

/** All element nodes in the subtree (including `root` itself if an element). */
export function elements(root: MockNode): MockNode[] {
  return walk(root).filter((n) => n.nodeType === 1);
}

/** The first *direct child* element with the given tag name (no descent). */
export function childByTag(parent: MockNode, tag: string): MockNode | undefined {
  return parent.childNodes.find(
    (n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag,
  );
}

/** The first element in the subtree with the given tag name. */
export function queryByTag(root: MockNode, tag: string): MockNode | undefined {
  return elements(root).find((n) => n.tagName.toLowerCase() === tag);
}

/** Every element in the subtree with the given tag name. */
export function queryAllByTag(root: MockNode, tag: string): MockNode[] {
  return elements(root).filter((n) => n.tagName.toLowerCase() === tag);
}

/** The first *direct child* element with the given id (no descent). */
export function childById(parent: MockNode, id: string): MockNode | undefined {
  return parent.childNodes.find(
    (n) => n.nodeType === 1 && n.getAttribute("id") === id,
  );
}

/** The first element in the subtree with the given id. */
export function queryById(root: MockNode, id: string): MockNode | undefined {
  return elements(root).find((n) => n.getAttribute("id") === id);
}

/**
 * Every element in the subtree with the given id. Ids are meant to be unique,
 * but the mock doesn't enforce it — this lets `getById` detect a duplicate.
 */
export function queryAllById(root: MockNode, id: string): MockNode[] {
  return elements(root).filter((n) => n.getAttribute("id") === id);
}

/** Whether the element's `class` attribute contains the given class. */
export function hasClass(node: MockNode, cls: string): boolean {
  return (node.getAttribute("class") ?? "").split(" ").filter(Boolean).includes(cls);
}

/** The first element in the subtree carrying the given class. */
export function queryByClass(root: MockNode, cls: string): MockNode | undefined {
  return elements(root).find((n) => hasClass(n, cls));
}

/** Every element in the subtree carrying the given class. */
export function queryAllByClass(root: MockNode, cls: string): MockNode[] {
  return elements(root).filter((n) => hasClass(n, cls));
}

/**
 * An element's *own* text: its direct text-node children joined, child
 * elements excluded. Text queries match against this (not `textContent`) so
 * the innermost element wins and every wrapping ancestor doesn't also match.
 */
function ownText(node: MockNode): string {
  return node.childNodes
    .filter((n) => n.nodeType === 3)
    .map((n) => n.data)
    .join("");
}

/** Whether the element's own text equals `text` (or matches it, for a RegExp). */
function matchesText(node: MockNode, text: string | RegExp): boolean {
  return typeof text === "string" ? ownText(node) === text : text.test(ownText(node));
}

/**
 * The first element in the subtree whose own text equals `text` (or matches
 * it, for a RegExp). No whitespace normalization — the mock stays literal.
 * Note an empty string matches the first element with *no* own text (one
 * whose children are all elements), so query for actual content.
 */
export function queryByText(
  root: MockNode,
  text: string | RegExp,
): MockNode | undefined {
  return elements(root).find((n) => matchesText(n, text));
}

/** Every element in the subtree whose own text matches (string or RegExp). */
export function queryAllByText(root: MockNode, text: string | RegExp): MockNode[] {
  return elements(root).filter((n) => matchesText(n, text));
}

/**
 * Return the single match, or throw carrying the serialized tree — on a miss
 * *and* on multiple matches, so `getBy*` asserts exactly one. `matches` is the
 * `queryAllBy*` result for the same lookup.
 */
function get(root: MockNode, matches: MockNode[], what: string): MockNode {
  if (matches.length === 0) {
    throw new Error(`Unable to find ${what} in:\n${serialize(root)}`);
  }
  if (matches.length > 1) {
    // "matches for", not "elements matching", so a text query's own "matching"
    // (`… text matching /o/`) doesn't read as "matching … matching".
    throw new Error(
      `Found ${matches.length} matches for ${what} (expected exactly one) in:\n${serialize(root)}`,
    );
  }
  return matches[0]!;
}

/** Like {@link queryByTag}, but throws unless exactly one element matches. */
export function getByTag(root: MockNode, tag: string): MockNode {
  return get(root, queryAllByTag(root, tag), `a <${tag}> element`);
}

/** Like {@link queryByClass}, but throws unless exactly one element matches. */
export function getByClass(root: MockNode, cls: string): MockNode {
  return get(root, queryAllByClass(root, cls), `an element with class "${cls}"`);
}

/** Like {@link queryById}, but throws unless exactly one element matches. */
export function getById(root: MockNode, id: string): MockNode {
  return get(root, queryAllById(root, id), `an element with id "${id}"`);
}

/**
 * Like {@link queryByText}, but throws unless exactly one element matches. An
 * empty string or an all-matching RegExp (`/(?:)/`) can match several elements
 * (those with no own text) — with a single-match contract those throw as
 * duplicates rather than returning the first, so query for real content.
 */
export function getByText(root: MockNode, text: string | RegExp): MockNode {
  const what =
    typeof text === "string"
      ? `an element with text "${text}"`
      : `an element with text matching ${text}`;
  return get(root, queryAllByText(root, text), what);
}

/** The subtree queries, bound to a root — see {@link within}. */
export interface BoundQueries {
  getByTag(tag: string): MockNode;
  getByClass(cls: string): MockNode;
  getById(id: string): MockNode;
  getByText(text: string | RegExp): MockNode;
  queryByTag(tag: string): MockNode | undefined;
  queryAllByTag(tag: string): MockNode[];
  queryByClass(cls: string): MockNode | undefined;
  queryAllByClass(cls: string): MockNode[];
  queryById(id: string): MockNode | undefined;
  queryAllById(id: string): MockNode[];
  queryByText(text: string | RegExp): MockNode | undefined;
  queryAllByText(text: string | RegExp): MockNode[];
}

/**
 * Bind every subtree query to `root`, testing-library style, so call sites
 * drop the container argument. `renderTest` returns these bound to its
 * container; reach for `within(el)` to scope queries to a narrower subtree.
 */
export function within(root: MockNode): BoundQueries {
  return {
    getByTag: (tag) => getByTag(root, tag),
    getByClass: (cls) => getByClass(root, cls),
    getById: (id) => getById(root, id),
    getByText: (text) => getByText(root, text),
    queryByTag: (tag) => queryByTag(root, tag),
    queryAllByTag: (tag) => queryAllByTag(root, tag),
    queryByClass: (cls) => queryByClass(root, cls),
    queryAllByClass: (cls) => queryAllByClass(root, cls),
    queryById: (id) => queryById(root, id),
    queryAllById: (id) => queryAllById(root, id),
    queryByText: (text) => queryByText(root, text),
    queryAllByText: (text) => queryAllByText(root, text),
  };
}
