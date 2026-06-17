/**
 * kanabun — DOM runtime
 * ------------------------------------------------------------------
 * Turns the values produced by the JSX runtime into real DOM and wires the
 * reactive bits with fine-grained `effect`s — no virtual DOM, no diffing.
 *
 * The reactive-expression convention (no compiler, so it must be explicit):
 *
 *   - A child or attribute value that is a **function** is reactive: it is
 *     wrapped in an `effect` and re-applied when its dependencies change.
 *         <span>{count}</span>           // reactive (count is an accessor)
 *         <span>{() => count() * 2}</span>// reactive (thunk)
 *         <span>{count()}</span>          // STATIC — read once at build time
 *   - Props named `on*` are always event listeners, never reactive thunks.
 *
 * Only Web APIs are used. The `document` is resolved lazily so importing this
 * module never requires a DOM; tests install a mock on `globalThis.document`.
 */
import { effect, createRoot } from "./reactive";
import type { Disposer } from "./reactive";

/** Props passed to an intrinsic element (or component). */
export type Props = Record<string, unknown> & { children?: unknown };

export function doc(): Document {
  const d = (globalThis as { document?: Document }).document;
  if (!d) {
    throw new Error(
      "kanabun: no `document` is available — the DOM runtime needs a browser " +
        "(or a DOM mock on globalThis.document).",
    );
  }
  return d;
}

// Duck-typed Node check that does not rely on a global `Node` constructor
// (which may be absent outside a browser).
function isNode(value: unknown): value is Node {
  return (
    value != null && typeof (value as { nodeType?: unknown }).nodeType === "number"
  );
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

// ── Element creation ─────────────────────────────────────────────
export function createElement(tag: string, props: Props | null): Element {
  const el = doc().createElement(tag);
  if (props !== null) {
    for (const key in props) {
      if (key === "children" || key === "ref") continue;
      applyProp(el, key, props[key]);
    }
    if (props.ref !== undefined) applyRef(props.ref, el);
    if ("children" in props) insert(el, props.children);
  }
  return el;
}

function applyRef(ref: unknown, el: Element): void {
  if (typeof ref === "function") (ref as (e: Element) => void)(el);
  else if (ref !== null && typeof ref === "object") {
    (ref as { current: unknown }).current = el;
  }
}

function applyProp(el: Element, key: string, value: unknown): void {
  // Events: on* is always a listener.
  if (key.length > 2 && key[0] === "o" && key[1] === "n") {
    el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    return;
  }
  if (key === "style" && value !== null && typeof value === "object") {
    applyStyle(el as HTMLElement, value as Record<string, unknown>);
    return;
  }
  // A function value is a reactive binding; anything else is set once.
  if (typeof value === "function") {
    effect(() => setAttr(el, key, (value as () => unknown)()));
  } else {
    setAttr(el, key, value);
  }
}

function applyStyle(el: HTMLElement, styles: Record<string, unknown>): void {
  for (const prop in styles) {
    const value = styles[prop];
    if (typeof value === "function") {
      effect(() => setStyle(el, prop, (value as () => unknown)()));
    } else {
      setStyle(el, prop, value);
    }
  }
}

function setStyle(el: HTMLElement, prop: string, value: unknown): void {
  el.style.setProperty(prop, value == null ? "" : String(value));
}

function setAttr(el: Element, key: string, value: unknown): void {
  // Form properties don't reflect reliably through setAttribute.
  if (key === "value" || key === "checked" || key === "selected") {
    (el as unknown as Record<string, unknown>)[key] = value;
    return;
  }
  if (key === "className") key = "class";
  if (value == null || value === false) {
    el.removeAttribute(key);
  } else if (value === true) {
    el.setAttribute(key, "");
  } else {
    el.setAttribute(key, String(value));
  }
}

// ── Children insertion ───────────────────────────────────────────
/** Nodes currently rendered for a dynamic slot (for replace-on-update). */
type Rendered = Node[] | null;

/**
 * Insert `value` into `parent` before `before` (or appended). A function value
 * becomes a reactive slot, anchored by a comment marker so it keeps its place
 * among siblings while its content is replaced on each update.
 */
export function insert(parent: Node, value: unknown, before: Node | null = null): void {
  // Arrays are inserted item-by-item so a function *inside* the array (e.g.
  // `<p>count is {count}</p>` → ["count is ", count]) stays reactive rather
  // than being flattened and read once.
  if (Array.isArray(value)) {
    for (const item of value) insert(parent, item, before);
    return;
  }
  if (typeof value === "function") {
    const marker = parent.insertBefore(doc().createComment(""), before);
    let current: Rendered = null;
    effect(() => {
      current = reconcile(parent, (value as () => unknown)(), current, marker);
    });
    return;
  }
  reconcile(parent, value, null, before);
}

function reconcile(
  parent: Node,
  value: unknown,
  current: Rendered,
  before: Node | null,
): Rendered {
  // Fast path: a single text node whose text just changes.
  if (
    current !== null &&
    current.length === 1 &&
    isText(current[0]!) &&
    (typeof value === "string" || typeof value === "number")
  ) {
    (current[0] as Text).data = String(value);
    return current;
  }
  const next = normalize(value);
  reconcileNodes(parent, current ?? [], next, before);
  return next.length > 0 ? next : null;
}

/**
 * Sync the DOM children in `[..before)` from `current` to `next`, keyed by node
 * identity: nodes present in both keep their DOM node (only moved if out of
 * order), missing ones are removed, new ones inserted. Combined with `<For>`'s
 * stable per-item node identity, this is the keyed list update.
 *
 * Positioning walks back-to-front, anchoring each node before the already-
 * placed suffix, so a node is only touched when it's genuinely misplaced.
 */
export function reconcileNodes(
  parent: Node,
  current: Node[],
  next: Node[],
  before: Node | null,
): void {
  if (current.length > 0) {
    const keep = new Set(next);
    for (const node of current) {
      if (!keep.has(node) && node.parentNode === parent) parent.removeChild(node);
    }
  }
  let ref = before;
  for (let i = next.length - 1; i >= 0; i--) {
    const node = next[i]!;
    if (node.parentNode !== parent || node.nextSibling !== ref) {
      parent.insertBefore(node, ref);
    }
    ref = node;
  }
}

/** Flatten a child value into a list of DOM nodes (text for primitives). */
function normalize(value: unknown): Node[] {
  const out: Node[] = [];
  appendNormalized(out, value);
  return out;
}

function appendNormalized(out: Node[], value: unknown): void {
  if (value == null || value === false || value === true || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendNormalized(out, item);
    return;
  }
  if (isNode(value)) {
    out.push(value);
    return;
  }
  if (typeof value === "function") {
    appendNormalized(out, (value as () => unknown)());
    return;
  }
  out.push(doc().createTextNode(String(value)));
}

// ── Mounting ─────────────────────────────────────────────────────
/**
 * Render `code` into `container`. `code` is a thunk returning the view, e.g.
 * `render(() => <App />, document.getElementById("app")!)`. Returns a disposer
 * that stops all reactivity created during the render and clears the container.
 */
export function render(code: () => unknown, container: Element): Disposer {
  let dispose!: Disposer;
  createRoot((d) => {
    dispose = d;
    insert(container, code());
  });
  return () => {
    dispose();
    container.textContent = "";
  };
}

/**
 * Mount the client app over server-rendered markup. Pair with
 * {@link ../server!renderToString}: the server HTML paints first (fast first
 * paint, SEO), then `hydrate` makes it interactive.
 *
 * It clears the container's server markup and mounts the live reactive tree in
 * its place. Because the page already painted identical bytes, there is no
 * visual flash. What this deliberately does **not** do is adopt the existing
 * server nodes (reuse them in place, only attaching listeners/effects): with a
 * runtime JSX that builds DOM *eagerly and bottom-up* — children before their
 * parent, with no positional cursor and no compiler-emitted hydration markers —
 * a child element is created before anything knows where in the server tree it
 * belongs, so there is nothing to anchor node-level adoption to. True adoption
 * needs markers or a compiler; that is out of scope by the founding "no
 * compiler" constraint. See `docs/decisions.md` → "SSR, hydration & SSG".
 *
 * Returns a disposer that tears down reactivity and clears the container, like
 * {@link render}.
 */
export function hydrate(code: () => unknown, container: Element): Disposer {
  container.textContent = "";
  return render(code, container);
}
