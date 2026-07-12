/**
 * Query helpers over the mock DOM tree. Subtree queries walk in document
 * order (the same semantics the core and router suites relied on).
 */
import { type MockNode } from "./dom-mock";

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
