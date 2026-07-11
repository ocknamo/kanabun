import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, render, jsx, Show, For, onCleanup } from "./index";
import {
  installDOM,
  createContainer,
  serialize,
  asEl,
  type MockNode,
  childByTag as byTag,
} from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

/** Find a child element of `parent` by id (skips comment markers). */
function byId(parent: MockNode, id: string): MockNode | undefined {
  return parent.childNodes.find(
    (n) => n.nodeType === 1 && n.getAttribute("id") === id,
  );
}

describe("<Show>", () => {
  test("shows children when truthy, fallback otherwise", () => {
    const when = signal(true);
    const container = createContainer();
    render(
      () =>
        jsx(Show, {
          when: () => when(),
          fallback: jsx("p", { children: "no" }),
          children: jsx("p", { children: "yes" }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>yes</p></div>");
    when.set(false);
    expect(serialize(container)).toBe("<div><p>no</p></div>");
    when.set(true);
    expect(serialize(container)).toBe("<div><p>yes</p></div>");
  });

  test("does not swap children while the condition stays truthy", () => {
    const when = signal(1);
    const container = createContainer();
    render(
      () => jsx(Show, { when: () => when() > 0, children: jsx("p", { children: "hi" }) }),
      asEl(container),
    );
    const first = byTag(container, "p");
    when.set(2); // still > 0 — boolean unchanged, no re-render
    expect(byTag(container, "p")).toBe(first);
    when.set(-1); // now falsy
    expect(byTag(container, "p")).toBeUndefined();
  });

  test("defaults to no fallback (renders nothing)", () => {
    const when = signal(false);
    const container = createContainer();
    render(
      () => jsx(Show, { when: () => when(), children: jsx("p", { children: "x" }) }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>");
  });

  test("eager children stay live while hidden (element child)", () => {
    // A plain element child is created once; hiding detaches it but its
    // reactive scope is NOT disposed — it keeps recomputing while hidden.
    const when = signal(true);
    const value = signal(0);
    let runs = 0;
    const container = createContainer();
    render(
      () =>
        jsx(Show, {
          when: () => when(),
          children: jsx("span", {
            children: () => {
              runs++;
              return value();
            },
          }),
        }),
      asEl(container),
    );
    expect(runs).toBe(1);
    when.set(false); // hide
    value.set(1); // hidden child still reacts
    expect(runs).toBe(2);
  });

  test("function children are disposed while hidden and recreated when shown", () => {
    // Wrapping children in a function defers creation, so hiding disposes the
    // child's reactive scope (and showing recreates it) — Solid-like semantics.
    const when = signal(true);
    const value = signal(0);
    let runs = 0;
    const container = createContainer();
    render(
      () =>
        jsx(Show, {
          when: () => when(),
          children: () =>
            jsx("span", {
              children: () => {
                runs++;
                return value();
              },
            }),
        }),
      asEl(container),
    );
    expect(runs).toBe(1);
    when.set(false); // hide → child scope disposed
    value.set(1); // hidden child must NOT recompute
    expect(runs).toBe(1);
    when.set(true); // show → recreated, reads value() === 1
    expect(runs).toBe(2);
    expect(serialize(container)).toBe("<div><span>1</span></div>");
  });
});

describe("<For>", () => {
  test("renders a list and a fallback when empty", () => {
    const items = signal<number[]>([]);
    const container = createContainer();
    render(
      () =>
        jsx(For, {
          each: () => items(),
          fallback: jsx("p", { children: "empty" }),
          children: (n: number) => jsx("li", { children: String(n) }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>empty</p></div>");
    items.set([1, 2, 3]);
    expect(serialize(container)).toBe("<div><li>1</li><li>2</li><li>3</li></div>");
  });

  test("reuses the same DOM node for an item across reorders (keyed)", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const c = { id: 3 };
    const items = signal([a, b, c]);
    const container = createContainer();
    render(
      () =>
        jsx(For, {
          each: () => items(),
          children: (it: { id: number }) =>
            jsx("li", { id: String(it.id), children: String(it.id) }),
        }),
      asEl(container),
    );
    const beforeNode = byId(container, "2");
    expect(beforeNode).toBeDefined();

    // Reorder: the node for item `b` must be the very same instance.
    items.set([c, a, b]);
    expect(byId(container, "2")).toBe(beforeNode);
    expect(serialize(container)).toBe(
      '<div><li id="3">3</li><li id="1">1</li><li id="2">2</li></div>',
    );
  });

  test("adds and removes items with minimal churn", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const items = signal([a, b]);
    const container = createContainer();
    render(
      () =>
        jsx(For, {
          each: () => items(),
          children: (it: { id: number }) =>
            jsx("li", { id: String(it.id), children: String(it.id) }),
        }),
      asEl(container),
    );
    const nodeA = byId(container, "1");

    const c = { id: 3 };
    items.set([a, c, b]); // insert c in the middle
    expect(byId(container, "1")).toBe(nodeA); // a untouched
    expect(serialize(container)).toBe(
      '<div><li id="1">1</li><li id="3">3</li><li id="2">2</li></div>',
    );

    items.set([a, b]); // remove c
    expect(serialize(container)).toBe(
      '<div><li id="1">1</li><li id="2">2</li></div>',
    );
  });

  test("item content stays reactive in its reused node", () => {
    const item = { id: 1, label: signal("x") };
    const items = signal([item]);
    const container = createContainer();
    render(
      () =>
        jsx(For, {
          each: () => items(),
          children: (it: typeof item) => jsx("span", { children: it.label }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><span>x</span></div>");
    item.label.set("y");
    expect(serialize(container)).toBe("<div><span>y</span></div>");
  });

  test("handles duplicate item references", () => {
    const a = { id: 1 };
    const items = signal([a, a]); // same reference twice
    const container = createContainer();
    render(
      () =>
        jsx(For, {
          each: () => items(),
          children: (it: { id: number }) => jsx("li", { children: String(it.id) }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><li>1</li><li>1</li></div>");
    items.set([a]); // drop one duplicate
    expect(serialize(container)).toBe("<div><li>1</li></div>");
  });

  test("disposes the reactive scope of a removed item", () => {
    const i1 = { id: 1 };
    const i2 = { id: 2 };
    const items = signal([i1, i2]);
    const cleaned: number[] = [];
    const container = createContainer();
    render(
      () =>
        jsx(For, {
          each: () => items(),
          children: (it: { id: number }) => {
            onCleanup(() => cleaned.push(it.id));
            return jsx("li", { children: String(it.id) });
          },
        }),
      asEl(container),
    );
    expect(cleaned).toEqual([]);
    items.set([i2]); // remove i1 → its scope is disposed
    expect(cleaned).toEqual([1]);
  });

  test("render dispose tears down all item scopes", () => {
    const i1 = { id: 1 };
    const i2 = { id: 2 };
    const items = signal([i1, i2]);
    const cleaned: number[] = [];
    const container = createContainer();
    const dispose = render(
      () =>
        jsx(For, {
          each: () => items(),
          children: (it: { id: number }) => {
            onCleanup(() => cleaned.push(it.id));
            return jsx("li", { children: String(it.id) });
          },
        }),
      asEl(container),
    );
    dispose();
    expect(cleaned.sort()).toEqual([1, 2]);
  });
});
