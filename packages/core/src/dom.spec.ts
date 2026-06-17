import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, render, hydrate, jsx, Fragment, insert } from "./index";
import { jsxDEV } from "./jsx-dev-runtime";
import {
  installDOM,
  createContainer,
  serialize,
  type MockNode,
} from "./dom-mock";

// The runtime resolves `globalThis.document` lazily, so install the mock first.
let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

// Helpers to bridge the mock types to the DOM types the API expects.
const asEl = (n: MockNode) => n as unknown as Element;
const asNode = (n: MockNode) => n as unknown as Node;
const el = (v: unknown) => v as unknown as MockNode;

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
