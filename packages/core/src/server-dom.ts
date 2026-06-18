/**
 * kanabun — server DOM (for `renderToString`)
 * ------------------------------------------------------------------
 * A tiny, serializable stand-in for the browser DOM, used by
 * {@link ./server!renderToString} so the *eager* JSX runtime (which builds
 * nodes via `doc().createElement`) can run where there is no real `document`
 * — a Bun/Node server, or a build-time prerender.
 *
 * It is **not** the test mock (`dom-mock.ts`): unlike the mock, this is shipped
 * runtime code, so it (a) HTML-escapes text and attribute values (the mock does
 * not — it would emit XSS), (b) knows void elements (`<br>` has no close tag),
 * and (c) treats `<style>`/`<script>` as raw-text (their body is CSS/JS, not
 * escaped HTML). It implements only the surface the DOM runtime and the scoped
 * `css` helper touch. Standard JS only — no Bun/Node APIs — so it keeps
 * `packages/core` runtime-independent.
 */

// Elements that are self-closing and have no children in HTML.
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Elements whose text content is raw (not HTML), so it must not be escaped.
const RAWTEXT = new Set(["style", "script"]);

// A conservative HTML/XML attribute-name production. The real DOM's
// `setAttribute` throws `InvalidCharacterError` on names outside this set; we
// mirror that so the server can't be coerced into emitting an attribute name
// that closes the tag (e.g. `x><img onerror=...>`) — an SSR XSS sink, since
// `serialize` emits the name verbatim. Matching real-DOM behaviour also removes
// the client/server asymmetry that hid the bug.
const VALID_ATTR_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Inline-style bag, mirroring the sliver of `CSSStyleDeclaration` we use. */
class Style {
  // An explicit (rather than synthesized) constructor: coverage tools can mark
  // a real one as covered, where an implicit one reads as a never-hit function.
  private readonly props: Map<string, string>;
  constructor() {
    this.props = new Map();
  }
  setProperty(name: string, value: string): void {
    if (value === "") this.props.delete(name);
    else this.props.set(name, value);
  }
  get cssText(): string {
    let out = "";
    for (const [k, v] of this.props) out += `${out ? " " : ""}${k}: ${v};`;
    return out;
  }
}

/**
 * A DOM-ish node. One shape for elements / text / comments (matching how the
 * runtime duck-types on `nodeType`), so the runtime's `isNode`/`isText` checks
 * and tree mutations work unchanged.
 */
export class ServerNode {
  nodeType: number;
  childNodes: ServerNode[] = [];
  parentNode: ServerNode | null = null;

  tagName = ""; // element-only
  readonly attributes = new Map<string, string>();
  readonly style = new Style();
  private _data = ""; // text/comment

  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }

  get firstChild(): ServerNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): ServerNode | null {
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

  // Form properties are assigned as properties (not attributes) by the runtime
  // (`setAttr` special-cases them); reflect them into attributes so they
  // serialize. `value` always reflects; `checked`/`selected` are boolean.
  set value(v: unknown) {
    this.attributes.set("value", String(v));
  }
  set checked(v: unknown) {
    if (v) this.attributes.set("checked", "");
    else this.attributes.delete("checked");
  }
  set selected(v: unknown) {
    if (v) this.attributes.set("selected", "");
    else this.attributes.delete("selected");
  }

  appendChild(child: ServerNode): ServerNode {
    return this.insertBefore(child, null);
  }

  insertBefore(child: ServerNode, ref: ServerNode | null): ServerNode {
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

  removeChild(child: ServerNode): ServerNode {
    const idx = this.childNodes.indexOf(child);
    if (idx === -1) throw new Error("removeChild: node is not a child");
    this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    // Reject invalid names like the real DOM (fail-safe), so an attacker-
    // controlled spread key can't inject markup during SSR serialization.
    if (!VALID_ATTR_NAME.test(name)) {
      throw new Error(`InvalidCharacterError: invalid attribute name "${name}"`);
    }
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  // Events never fire during a server render, so listeners are dropped. (A
  // statement, not an empty body, so coverage can see the call land here.)
  addEventListener(_type?: string, _listener?: unknown): void {
    void _type;
  }

  get textContent(): string {
    if (this.nodeType !== 1) return this._data;
    let out = "";
    for (const c of this.childNodes) out += c.textContent;
    return out;
  }
  set textContent(value: string) {
    if (this.nodeType !== 1) {
      this._data = String(value);
      return;
    }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value !== "") {
      const text = new ServerNode(3);
      text.data = String(value);
      this.appendChild(text);
    }
  }
}

/** The minimal `document` the runtime and `css` helper resolve via `doc()`. */
export class ServerDocument {
  // `<head>`, where the scoped-CSS helper injects `<style>` elements.
  readonly head: ServerNode;
  constructor() {
    this.head = new ServerNode(1);
    this.head.tagName = "HEAD";
  }
  createElement(tag: string): ServerNode {
    const el = new ServerNode(1);
    el.tagName = tag.toUpperCase();
    return el;
  }
  createTextNode(text: string): ServerNode {
    const node = new ServerNode(3);
    node.data = String(text);
    return node;
  }
  createComment(text: string): ServerNode {
    const node = new ServerNode(8);
    node.data = String(text);
    return node;
  }
}

/** Serialize a node (and its subtree) to an HTML string. */
export function serialize(node: ServerNode): string {
  if (node.nodeType === 3) return escapeText(node.data);
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  const tag = node.tagName.toLowerCase();
  let attrs = "";
  for (const [k, v] of node.attributes) attrs += ` ${k}="${escapeAttr(v)}"`;
  const styleText = node.style.cssText;
  if (styleText && !node.attributes.has("style")) {
    attrs += ` style="${escapeAttr(styleText)}"`;
  }
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  let inner = "";
  if (RAWTEXT.has(tag)) {
    // Raw-text bodies (CSS/JS) are emitted verbatim, never HTML-escaped — the
    // browser parses them as raw text, so escaping would corrupt them. In
    // practice these come from the `css` helper (developer-authored CSS); never
    // interpolate untrusted input into a `<style>`/`<script>` body (it would be
    // emitted unescaped). Use a normal element for user data — that path escapes.
    for (const c of node.childNodes) if (c.nodeType === 3) inner += c.data;
  } else {
    for (const c of node.childNodes) inner += serialize(c);
  }
  return `<${tag}${attrs}>${inner}</${tag}>`;
}
