import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, render, hydrate, jsx, Fragment, insert, Show, For } from "./index";
import { jsxDEV } from "./jsx-dev-runtime";
import {
  installDOM,
  createContainer,
  serialize,
  asEl,
  asNode,
  asMock as el,
} from "@kanabun/testing";
import { setDev, setWarnHandler, __resetDev } from "./dev";

// The runtime resolves `globalThis.document` lazily, so install the mock first.
let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

describe("static rendering", () => {
  test("element with text", () => {
    expect(serialize(el(jsx("div", { children: "hi" })))).toBe("<div>hi</div>");
  });

  test("attributes", () => {
    const a = el(jsx("a", { href: "/x", children: "link" }));
    expect(serialize(a)).toBe('<a href="/x">link</a>');
  });

  test("className maps to class", () => {
    expect(serialize(el(jsx("div", { className: "box", children: "" })))).toBe(
      '<div class="box"></div>',
    );
  });

  test("boolean attribute present/absent", () => {
    expect(serialize(el(jsx("input", { disabled: true })))).toBe(
      '<input disabled=""></input>',
    );
    expect(serialize(el(jsx("input", { disabled: false })))).toBe("<input></input>");
  });

  test("value is set as a property, not an attribute", () => {
    const input = el(jsx("input", { value: "hello" }));
    expect((input as unknown as { value: string }).value).toBe("hello");
    expect(input.getAttribute("value")).toBeNull();
  });

  test("nested elements and multiple children", () => {
    const tree = el(
      jsx("ul", {
        children: [jsx("li", { children: "a" }), jsx("li", { children: "b" })],
      }),
    );
    expect(serialize(tree)).toBe("<ul><li>a</li><li>b</li></ul>");
  });
});

describe("components", () => {
  test("run once and return their view", () => {
    let runs = 0;
    function Item(props: { label: string }) {
      runs++;
      return jsx("span", { children: props.label });
    }
    const node = el(jsx(Item as never, { label: "hi" }));
    expect(runs).toBe(1);
    expect(serialize(node)).toBe("<span>hi</span>");
  });

  test("Fragment returns its children", () => {
    const container = createContainer();
    insert(asNode(container), jsx(Fragment as never, { children: ["a", "b"] }));
    expect(serialize(container)).toBe("<div>ab</div>");
  });

  test("jsxDEV (dev transform entry) delegates to jsx", () => {
    const node = el(jsxDEV("div", { children: "dev" }, undefined, false));
    expect(serialize(node)).toBe("<div>dev</div>");
  });
});

describe("reactivity convention", () => {
  test("a function child is reactive", () => {
    const count = signal(0);
    const node = el(jsx("button", { type: "button", children: ["count is ", count] }));
    expect(serialize(node)).toBe('<button type="button">count is 0</button>');
    count.set(1);
    expect(serialize(node)).toBe('<button type="button">count is 1</button>');
  });

  test("a reactive text child reuses the same Text node across updates", () => {
    const count = signal(0);
    const span = el(jsx("span", { children: count }));
    const text = span.firstChild!;
    expect(text.nodeType).toBe(3);
    expect(text.data).toBe("0");
    count.set(1);
    expect(span.firstChild).toBe(text); // same Text node, mutated in place
    expect(text.data).toBe("1");
  });

  test("a called accessor {count()} is static (read once)", () => {
    const count = signal(0);
    const node = el(jsx("span", { children: count() }));
    expect(serialize(node)).toBe("<span>0</span>");
    count.set(5);
    expect(serialize(node)).toBe("<span>0</span>"); // unchanged — it was static
  });

  test("a function attribute is reactive", () => {
    const cls = signal("a");
    const node = el(jsx("div", { class: () => cls(), children: "x" }));
    expect(serialize(node)).toBe('<div class="a">x</div>');
    cls.set("b");
    expect(serialize(node)).toBe('<div class="b">x</div>');
  });

  test("a reactive style property updates", () => {
    const color = signal("red");
    const node = el(jsx("div", { style: { color: () => color() } }));
    expect(node.style.getPropertyValue("color")).toBe("red");
    color.set("blue");
    expect(node.style.getPropertyValue("color")).toBe("blue");
  });

  test("a static style object is applied once", () => {
    const node = el(jsx("div", { style: { color: "red", "font-weight": "bold" } }));
    expect(node.style.getPropertyValue("color")).toBe("red");
    expect(node.style.getPropertyValue("font-weight")).toBe("bold");
  });
});

describe("reactive list (precursor to <For>)", () => {
  test("a reactive child returning an array re-renders on change", () => {
    const items = signal(["a", "b"]);
    const container = createContainer();
    render(
      () =>
        jsx("ul", {
          children: () => items().map((t) => jsx("li", { children: t })),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><ul><li>a</li><li>b</li></ul></div>");
    items.set(["x"]);
    expect(serialize(container)).toBe("<div><ul><li>x</li></ul></div>");
  });

  test("a thunk nested inside a reactive array is evaluated", () => {
    const container = createContainer();
    render(() => jsx("p", { children: () => ["a", () => "b"] }), asEl(container));
    expect(serialize(container)).toBe("<div><p>ab</p></div>");
  });

  test("a reactive slot returning another thunk insulates the inner deps", () => {
    // The outer thunk reads `outer`, the inner thunk it returns reads `inner`.
    // Each function level gets its own slot, so writing `inner` must NOT re-run
    // the outer (which would rebuild the subtree). We prove the outer ran once.
    const outer = signal("L");
    const inner = signal(0);
    let outerRuns = 0;
    const container = createContainer();
    render(
      () =>
        jsx("p", {
          children: () => {
            outerRuns++;
            outer(); // subscribe the outer slot to `outer` only
            return () => `n${inner()}`;
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>n0</p></div>");
    expect(outerRuns).toBe(1);

    inner.set(1); // inner-only change — outer slot must not re-run
    expect(serialize(container)).toBe("<div><p>n1</p></div>");
    expect(outerRuns).toBe(1);

    outer.set("R"); // outer change re-runs the outer (and re-creates the inner slot)
    expect(serialize(container)).toBe("<div><p>n1</p></div>");
    expect(outerRuns).toBe(2);
  });
});

describe("events", () => {
  test("onClick handler fires and drives reactive content", () => {
    const count = signal(0);
    const node = el(
      jsx("button", {
        onClick: () => count.update((n) => n + 1),
        children: count,
      }),
    );
    expect(node.textContent).toBe("0");
    node.dispatch("click");
    expect(node.textContent).toBe("1");
    node.dispatch("click");
    expect(node.textContent).toBe("2");
  });
});

describe("conditional content (reactive child swap)", () => {
  test("toggling a node in and out", () => {
    const show = signal(true);
    const container = createContainer();
    render(
      () => jsx("div", { children: () => (show() ? jsx("p", { children: "yes" }) : null) }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><div><p>yes</p></div></div>");
    show.set(false);
    expect(serialize(container)).toBe("<div><div></div></div>");
    show.set(true);
    expect(serialize(container)).toBe("<div><div><p>yes</p></div></div>");
  });
});

// A fragment (an array) produced by a *reactive* slot used to have its function
// members read inline by `normalize`, inside the slot's own effect — so the
// members' dependencies were collected by the slot and every change rebuilt the
// whole fragment (and whatever produced it). Each member now gets its own slot.
describe("fragment with reactive members", () => {
  test("a member's dependency does not re-run the slot that produced it", () => {
    const outer = signal("a");
    const inner = signal(false);
    const container = createContainer();
    let builds = 0;
    render(
      () =>
        jsx("div", {
          children: () => {
            outer();
            builds++;
            return jsx(Fragment, {
              children: [
                jsx("h1", { children: "page" }),
                jsx(Show, { when: inner, children: jsx("p", { children: "detail" }) }),
              ],
            });
          },
        }),
      asEl(container),
    );
    expect(builds).toBe(1);
    expect(serialize(container)).toBe("<div><div><h1>page</h1></div></div>");

    inner.set(true); // only the <Show> member re-runs
    expect(builds).toBe(1);
    expect(serialize(container)).toBe("<div><div><h1>page</h1><p>detail</p></div></div>");

    outer.set("b"); // the slot's own dependency still rebuilds it
    expect(builds).toBe(2);
    expect(serialize(container)).toBe("<div><div><h1>page</h1><p>detail</p></div></div>");
  });

  test("members keep their order and update in place", () => {
    const n = signal(1);
    const container = createContainer();
    render(
      () => jsx("div", { children: () => ["a", () => n(), "c"] }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><div>a1c</div></div>");
    n.set(2);
    expect(serialize(container)).toBe("<div><div>a2c</div></div>");
  });

  test("a member nested in an inner array is isolated too", () => {
    const n = signal(1);
    const container = createContainer();
    let builds = 0;
    render(
      () =>
        jsx("div", {
          children: () => {
            builds++;
            return [[() => n()], "!"];
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><div>1!</div></div>");
    n.set(2);
    expect(builds).toBe(1);
    expect(serialize(container)).toBe("<div><div>2!</div></div>");
  });

  test("leaving the fragment removes every node (and marker) it rendered", () => {
    const mode = signal("fragment");
    const inner = signal("x");
    const container = createContainer();
    render(
      () =>
        jsx("div", {
          children: () =>
            mode() === "fragment"
              ? ["a", () => inner(), jsx("p", { children: "b" })]
              : jsx("span", { children: "plain" }),
        }),
      asEl(container),
    );
    const host = container.childNodes[0]!;
    // "a", the member's marker + text, <p>, the fragment's start marker, and
    // the slot's own marker.
    expect(host.childNodes.length).toBe(6);

    mode.set("plain");
    expect(serialize(container)).toBe("<div><div><span>plain</span></div></div>");
    // Only the replacement and the slot marker survive: nothing leaked.
    expect(host.childNodes.length).toBe(2);
    // The abandoned member is disposed — writing its signal changes nothing.
    inner.set("y");
    expect(serialize(container)).toBe("<div><div><span>plain</span></div></div>");
    expect(host.childNodes.length).toBe(2);
  });

  test("a <For> inside a fragment keeps its keyed node identity", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const list = signal([a, b]);
    const container = createContainer();
    render(
      () =>
        jsx("div", {
          children: () => [
            jsx("h1", { children: "list" }),
            jsx(For, {
              each: list,
              children: (item: { id: string }) => jsx("li", { children: item.id }),
            }),
          ],
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><div><h1>list</h1><li>a</li><li>b</li></div></div>");
    const host = container.childNodes[0]!;
    const first = host.childNodes.filter((n) => n.nodeType === 1)[1]!;
    list.set([b, a]);
    expect(serialize(container)).toBe("<div><div><h1>list</h1><li>b</li><li>a</li></div></div>");
    // The node built for `a` was reused (moved), not rebuilt.
    expect(host.childNodes.filter((n) => n.nodeType === 1)[2]).toBe(first);
  });
});

describe("refs", () => {
  test("function ref and object ref receive the element", () => {
    let viaFn: unknown = null;
    const node = jsx("div", {
      ref: (e: unknown) => {
        viaFn = e;
      },
    });
    expect(viaFn).toBe(node);

    const refObj: { current: unknown } = { current: null };
    const node2 = jsx("div", { ref: refObj });
    expect(refObj.current).toBe(node2);
  });
});

describe("children normalization", () => {
  test("0 renders as text; false/null/undefined/true render nothing", () => {
    expect(serialize(el(jsx("p", { children: 0 })))).toBe("<p>0</p>");
    expect(
      serialize(el(jsx("p", { children: [false, null, undefined, true, "x"] }))),
    ).toBe("<p>x</p>");
  });
});

describe("missing DOM", () => {
  test("throws a helpful error when no document is available", () => {
    teardown(); // remove the mock installed in beforeEach
    expect(() => jsx("div", { children: "x" })).toThrow(/document/);
    teardown = installDOM(); // restore for afterEach
  });
});

describe("render + dispose", () => {
  test("mounts into a container, updates, then disposes cleanly", () => {
    const count = signal(0);
    const container = createContainer();
    const dispose = render(
      () =>
        jsx("button", {
          onClick: () => count.update((n) => n + 1),
          children: count,
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><button>0</button></div>");

    el(container.firstChild).dispatch("click");
    expect(serialize(container)).toBe("<div><button>1</button></div>");

    dispose();
    expect(serialize(container)).toBe("<div></div>"); // container cleared

    // Reactivity is torn down: further writes do nothing (and don't throw).
    expect(() => count.set(99)).not.toThrow();
  });
});

describe("hydrate", () => {
  test("clears server markup, mounts the interactive tree, then disposes", () => {
    const count = signal(0);
    const container = createContainer();
    // Simulate server-rendered markup already in the container.
    const serverMarkup = createContainer("button");
    serverMarkup.textContent = "0";
    container.appendChild(serverMarkup);
    expect(serialize(container)).toBe("<div><button>0</button></div>");

    const dispose = hydrate(
      () =>
        jsx("button", {
          onClick: () => count.update((n) => n + 1),
          children: count,
        }),
      asEl(container),
    );

    // Server markup is replaced by the live tree (no duplication).
    expect(serialize(container)).toBe("<div><button>0</button></div>");
    // The mounted tree is interactive (the server one was not).
    el(container.firstChild).dispatch("click");
    expect(serialize(container)).toBe("<div><button>1</button></div>");

    dispose();
    expect(serialize(container)).toBe("<div></div>");
  });
});

describe("raw-text child dev warning (S7)", () => {
  afterEach(() => __resetDev());

  function warningsFor(tag: string, children: unknown): string[] {
    const messages: string[] = [];
    setDev(true);
    setWarnHandler((m) => messages.push(m));
    jsx(tag, { children });
    return messages;
  }

  test("warns when a child is placed inside <script> or <style>", () => {
    for (const tag of ["script", "style", "SCRIPT"]) {
      const messages = warningsFor(tag, "alert(1)");
      __resetDev(); // reset dedupe between tags
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain(`<${tag.toLowerCase()}>`);
      expect(messages[0]).toContain("raw text");
    }
  });

  test("does not warn for ordinary elements or empty raw-text children", () => {
    expect(warningsFor("div", "hi")).toEqual([]);
    __resetDev();
    expect(warningsFor("style", "")).toEqual([]);
    __resetDev();
    expect(warningsFor("script", null)).toEqual([]);
    __resetDev();
    expect(warningsFor("style", [])).toEqual([]);
  });

  test("is silent when dev mode is off", () => {
    const messages: string[] = [];
    setWarnHandler((m) => messages.push(m));
    jsx("script", { children: "alert(1)" });
    expect(messages).toEqual([]);
  });
});
