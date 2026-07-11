/**
 * A tiny, in-memory DOM mock — just enough of the Web API surface that the
 * kanabun DOM runtime touches. It lets components be unit-tested in any JS
 * runtime with no jsdom/happy-dom (kanabun ships zero dependencies, and so
 * does this package). Install it with `installDOM()` in a test's setup, or
 * let `renderTest` install it on demand.
 *
 * It is deliberately not spec-complete; extend it as the runtime grows.
 */

type Listener = (event: MockEvent) => void;

export class MockEvent {
  type: string;
  target: MockNode | null = null;
  defaultPrevented = false;
  constructor(type: string) {
    this.type = type;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class Style {
  private props = new Map<string, string>();
  setProperty(name: string, value: string): void {
    if (value === "") this.props.delete(name);
    else this.props.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? "";
  }
  get cssText(): string {
    return [...this.props].map(([k, v]) => `${k}: ${v};`).join(" ");
  }
}

export class MockNode {
  nodeType: number;
  childNodes: MockNode[] = [];
  parentNode: MockNode | null = null;

  // element-only
  tagName = "";
  readonly attributes = new Map<string, string>();
  readonly style = new Style();
  private readonly listeners = new Map<string, Set<Listener>>();
  // text/comment data
  private _data = "";

  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }

  get firstChild(): MockNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): MockNode | null {
    const parent = this.parentNode;
    if (parent === null) return null;
    const i = parent.childNodes.indexOf(this);
    return parent.childNodes[i + 1] ?? null;
  }

  get data(): string {
    return this._data;
  }
  set data(value: string) {
    this._data = String(value);
  }

  appendChild(child: MockNode): MockNode {
    return this.insertBefore(child, null);
  }

  insertBefore(child: MockNode, ref: MockNode | null): MockNode {
    if (child.parentNode !== null) child.parentNode.removeChild(child);
    if (ref === null) {
      this.childNodes.push(child);
    } else {
      const idx = this.childNodes.indexOf(ref);
      if (idx === -1) throw new Error("insertBefore: reference node is not a child");
      this.childNodes.splice(idx, 0, child);
    }
    child.parentNode = this;
    return child;
  }

  removeChild(child: MockNode): MockNode {
    const idx = this.childNodes.indexOf(child);
    if (idx === -1) throw new Error("removeChild: node is not a child");
    this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  /**
   * Minimal `querySelectorAll`: supports only an attribute-presence selector
   * (`[data-island]`), which is all the islands runtime needs. Walks the subtree
   * in document order and returns matching element nodes.
   */
  querySelectorAll(selector: string): MockNode[] {
    const attr = parseAttrSelector(selector);
    const out: MockNode[] = [];
    const walk = (node: MockNode): void => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.attributes.has(attr)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  /**
   * Test helper: synchronously dispatch an event to this node's listeners.
   * `init` is merged onto the event (e.g. `{ key: "Enter" }`).
   */
  dispatch(type: string, init?: Record<string, unknown>): MockEvent {
    const event = new MockEvent(type);
    if (init) Object.assign(event, init);
    event.target = this;
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }

  get textContent(): string {
    if (this.nodeType !== 1) return this._data;
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    if (this.nodeType !== 1) {
      this._data = String(value);
      return;
    }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value !== "") {
      const text = new MockNode(3);
      text.data = String(value);
      this.appendChild(text);
    }
  }
}

export class MockDocument {
  // `<head>`, used by the scoped-CSS helper to inject `<style>` elements.
  readonly head: MockNode;
  // `<body>`, the default `<Portal>` target.
  readonly body: MockNode;
  constructor() {
    this.head = new MockNode(1);
    this.head.tagName = "HEAD";
    this.body = new MockNode(1);
    this.body.tagName = "BODY";
  }
  createElement(tag: string): MockNode {
    const el = new MockNode(1);
    el.tagName = tag.toUpperCase();
    return el;
  }
  createTextNode(text: string): MockNode {
    const node = new MockNode(3);
    node.data = String(text);
    return node;
  }
  createComment(text: string): MockNode {
    const node = new MockNode(8);
    node.data = String(text);
    return node;
  }
  /** Search the whole document (head + body) — see {@link MockNode.querySelectorAll}. */
  querySelectorAll(selector: string): MockNode[] {
    return [
      ...this.head.querySelectorAll(selector),
      ...this.body.querySelectorAll(selector),
    ];
  }
}

/** Extract the attribute name from a `[name]` presence selector. */
function parseAttrSelector(selector: string): string {
  const match = /^\[([\w-]+)\]$/.exec(selector);
  if (match === null) {
    throw new Error(`MockNode.querySelectorAll: unsupported selector "${selector}"`);
  }
  return match[1]!;
}

/** Serialize a node to HTML. Comment markers are omitted for readability. */
export function serialize(node: MockNode): string {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType === 8) return "";
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attributes]
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  const inner = node.childNodes.map(serialize).join("");
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/** Install the mock as `globalThis.document`; returns a teardown function. */
export function installDOM(): () => void {
  const prev = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = new MockDocument();
  return () => {
    (globalThis as { document?: unknown }).document = prev;
  };
}

/** Create a detached container element (e.g. a render root). */
export function createContainer(tag = "div"): MockNode {
  const el = new MockNode(1);
  el.tagName = tag.toUpperCase();
  return el;
}

/** Cast a MockNode to Element for use with DOM-typed APIs (`render`, `hydrate`). */
export const asEl = (n: MockNode): Element => n as unknown as Element;

/** Cast a MockNode to Node for use with Node-typed APIs. */
export const asNode = (n: MockNode): Node => n as unknown as Node;

/** Cast a value the runtime handed back (Node, Element, unknown) to a MockNode. */
export const asMock = (value: unknown): MockNode => value as MockNode;
