import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  signal,
  jsx,
  render,
  renderToString,
  Island,
  registerIsland,
  hydrateIslands,
  defineIslands,
  hydrateIslandsLazy,
} from "./index";
import {
  installDOM,
  createContainer,
  asEl,
  type MockNode,
  tick,
} from "@kanabun/testing";
import { setDev, setWarnHandler, __resetDev } from "./dev";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  __resetDev();
});

const docBody = (): MockNode =>
  (globalThis as unknown as { document: { body: MockNode } }).document.body;

// A small interactive island: renders `count: N` and increments on click.
function Counter(props: { start?: number }): unknown {
  const count = signal(props.start ?? 0);
  return jsx("button", {
    type: "button",
    onClick: () => count.update((n) => n + 1),
    children: ["count: ", count],
  });
}

const firstElement = (node: MockNode): MockNode =>
  node.childNodes.find((n) => n.nodeType === 1)!;

describe("<Island> (server boundary)", () => {
  test("wraps the registered component in a data-island/data-props div", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    render(() => jsx(Island, { name: "Counter", props: { start: 3 } }), asEl(container));

    const div = firstElement(container);
    expect(div.tagName.toLowerCase()).toBe("div");
    expect(div.getAttribute("data-island")).toBe("Counter");
    expect(div.getAttribute("data-props")).toBe('{"start":3}');
    // The component rendered into it (so first paint / SEO are unchanged).
    expect(div.textContent).toBe("count: 3");
  });

  test("defaults props to an empty object", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    render(() => jsx(Island, { name: "Counter" }), asEl(container));

    const div = firstElement(container);
    expect(div.getAttribute("data-props")).toBe("{}");
    expect(div.textContent).toBe("count: 0");
  });

  test("serializes to escaped markup under renderToString", () => {
    registerIsland("Counter", Counter);
    const { html } = renderToString(() =>
      jsx(Island, { name: "Counter", props: { start: 5 } }),
    );
    expect(html).toContain('data-island="Counter"');
    // The JSON props live in an attribute, so the quotes are HTML-escaped.
    expect(html).toContain('data-props="{&quot;start&quot;:5}"');
    expect(html).toContain("count: 5");
  });

  test("throws when the name is not registered", () => {
    expect(() =>
      render(() => jsx(Island, { name: "Missing" }), asEl(createContainer())),
    ).toThrow(/no island registered as "Missing"/);
  });
});

describe("hydrateIslands", () => {
  // Build server-style markup (a [data-island] wrapper) without going through
  // the client, then hydrate it — mirroring SSR HTML the browser parsed.
  function serverIsland(
    name: string,
    props: Record<string, unknown> | null,
  ): MockNode {
    const div = createContainer();
    div.setAttribute("data-island", name);
    if (props !== null) div.setAttribute("data-props", JSON.stringify(props));
    // Static server markup (what `count: N` would have serialized to).
    const text = (globalThis as unknown as { document: { createTextNode(s: string): MockNode } })
      .document.createTextNode("count: 0");
    div.appendChild(text);
    return div;
  }

  test("hydrates each island and makes it interactive", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    container.appendChild(serverIsland("Counter", { start: 0 }));

    hydrateIslands({ root: asEl(container) });

    const div = firstElement(container);
    const button = firstElement(div);
    expect(button.textContent).toBe("count: 0");
    button.dispatch("click");
    expect(button.textContent).toBe("count: 1");
  });

  test("reads props from data-props", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    container.appendChild(serverIsland("Counter", { start: 7 }));

    hydrateIslands({ root: asEl(container) });
    expect(firstElement(firstElement(container)).textContent).toBe("count: 7");
  });

  test("defaults to empty props when data-props is absent", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    container.appendChild(serverIsland("Counter", null));

    hydrateIslands({ root: asEl(container) });
    expect(firstElement(firstElement(container)).textContent).toBe("count: 0");
  });

  test("hydrates multiple islands and the disposer tears them all down", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    container.appendChild(serverIsland("Counter", { start: 1 }));
    container.appendChild(serverIsland("Counter", { start: 2 }));

    const dispose = hydrateIslands({ root: asEl(container) });
    const [a, b] = container.childNodes;
    expect(firstElement(a!).textContent).toBe("count: 1");
    expect(firstElement(b!).textContent).toBe("count: 2");

    dispose();
    expect(a!.textContent).toBe("");
    expect(b!.textContent).toBe("");
  });

  test("scans the whole document when no root is given", () => {
    registerIsland("Counter", Counter);
    docBody().appendChild(serverIsland("Counter", { start: 9 }));

    hydrateIslands();
    expect(firstElement(firstElement(docBody())).textContent).toBe("count: 9");
  });

  test("resolves from an explicit registry option", () => {
    const container = createContainer();
    container.appendChild(serverIsland("Widget", { start: 4 }));

    // "Widget" is intentionally absent from the module registry.
    hydrateIslands({ root: asEl(container), registry: { Widget: Counter } });
    expect(firstElement(firstElement(container)).textContent).toBe("count: 4");
  });

  test("throws when an island's name is not registered", () => {
    const container = createContainer();
    container.appendChild(serverIsland("Unknown", {}));
    expect(() => hydrateIslands({ root: asEl(container) })).toThrow(
      /no island registered as "Unknown"/,
    );
  });

  test("skips a nested island (and warns in dev)", () => {
    registerIsland("Counter", Counter);
    const container = createContainer();
    const outer = serverIsland("Counter", { start: 0 });
    outer.appendChild(serverIsland("Counter", { start: 5 }));
    container.appendChild(outer);

    const messages: string[] = [];
    setDev(true);
    setWarnHandler((m) => messages.push(m));

    hydrateIslands({ root: asEl(container) });

    // The outer island hydrated (its subtree, including the inner markup, was
    // re-rendered), and the nested one was skipped with a dev warning.
    expect(firstElement(outer).textContent).toBe("count: 0");
    expect(messages.some((m) => /nested <Island>/.test(m))).toBe(true);
  });
});

describe("defineIslands (typed registry)", () => {
  test("renders and hydrates against the declared map", () => {
    const { Island: TypedIsland, hydrateIslands: hydrate } = defineIslands({ Counter });

    // Server-style render through the typed boundary.
    const container = createContainer();
    render(() => TypedIsland({ name: "Counter", props: { start: 2 } }), asEl(container));
    const div = firstElement(container);
    expect(div.getAttribute("data-island")).toBe("Counter");
    expect(div.getAttribute("data-props")).toBe('{"start":2}');

    // Client-style hydrate (bound to the same map, no `registry` needed).
    hydrate({ root: asEl(container) });
    const button = firstElement(div);
    expect(button.textContent).toBe("count: 2");
    button.dispatch("click");
    expect(button.textContent).toBe("count: 3");
  });

  test("defaults props to an empty object", () => {
    const { Island: TypedIsland } = defineIslands({ Counter });
    const container = createContainer();
    render(() => TypedIsland({ name: "Counter" }), asEl(container));
    expect(firstElement(container).getAttribute("data-props")).toBe("{}");
  });

  // Compile-time assertions (checked by `bunx tsc`; each `@ts-expect-error` must
  // mark a real error). The runtime body just needs to be valid.
  test("checks the name and props at compile time", () => {
    const { Island: TypedIsland } = defineIslands({ Counter });
    type Boundary = Parameters<typeof TypedIsland>[0];

    const ok: Boundary = { name: "Counter", props: { start: 1 } };
    // @ts-expect-error — "Typo" is not a key of the declared map
    const badName: Boundary = { name: "Typo" };
    // @ts-expect-error — `start` must be a number
    const badProps: Boundary = { name: "Counter", props: { start: "x" } };

    expect([ok, badName, badProps]).toHaveLength(3);
  });
});

describe("hydrateIslandsLazy", () => {
  // Re-use the server-style markup builder.
  function serverIsland(name: string, props: Record<string, unknown>): MockNode {
    const div = createContainer();
    div.setAttribute("data-island", name);
    div.setAttribute("data-props", JSON.stringify(props));
    return div;
  }

  test("loads only the present islands' chunks and hydrates them", async () => {
    const container = createContainer();
    container.appendChild(serverIsland("Counter", { start: 3 }));

    const loaded: string[] = [];
    const dispose = hydrateIslandsLazy(
      {
        Counter: () => {
          loaded.push("Counter");
          return Promise.resolve({ default: Counter });
        },
        // Registered but absent from the page — must never be fetched.
        Absent: () => {
          loaded.push("Absent");
          return Promise.resolve(Counter);
        },
      },
      { root: asEl(container) },
    );
    await tick();

    expect(loaded).toEqual(["Counter"]); // selective: "Absent" not loaded
    const button = firstElement(firstElement(container));
    expect(button.textContent).toBe("count: 3");
    button.dispatch("click");
    expect(button.textContent).toBe("count: 4");

    dispose();
    expect(firstElement(container).textContent).toBe("");
  });

  test("accepts a loader that resolves the component directly", async () => {
    const container = createContainer();
    container.appendChild(serverIsland("Counter", { start: 1 }));
    hydrateIslandsLazy(
      { Counter: () => Promise.resolve(Counter) },
      { root: asEl(container) },
    );
    await tick();
    expect(firstElement(firstElement(container)).textContent).toBe("count: 1");
  });

  test("skips an island with no loader, warning in dev", async () => {
    const container = createContainer();
    container.appendChild(serverIsland("Counter", {}));

    const messages: string[] = [];
    setDev(true);
    setWarnHandler((m) => messages.push(m));

    hydrateIslandsLazy({}, { root: asEl(container) });
    await tick();

    expect(messages.some((m) => /no loader for island "Counter"/.test(m))).toBe(true);
    // Nothing mounted: the server markup (empty) is untouched.
    expect(firstElement(container).childNodes.length).toBe(0);
  });

  test("does not mount an island that resolves after disposal", async () => {
    const container = createContainer();
    container.appendChild(serverIsland("Counter", { start: 0 }));

    let resolve!: (c: typeof Counter) => void;
    const pending = new Promise<typeof Counter>((r) => (resolve = r));
    const dispose = hydrateIslandsLazy(
      { Counter: () => pending },
      { root: asEl(container) },
    );

    dispose(); // disposed before the chunk resolves
    resolve(Counter);
    await tick();

    // The late resolution is ignored — the container stays as server markup.
    expect(firstElement(container).childNodes.length).toBe(0);
  });
});
