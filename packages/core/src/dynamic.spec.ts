import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, render, jsx, onCleanup, Dynamic } from "./index";
import {
  installDOM,
  createContainer,
  serialize,
  asEl,
  type MockNode,
} from "./dom-mock";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

function byTag(parent: MockNode, tag: string): MockNode | undefined {
  return parent.childNodes.find(
    (n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag,
  );
}

describe("<Dynamic>", () => {
  test("renders a static tag name with forwarded props and children", () => {
    const container = createContainer();
    render(
      () => jsx(Dynamic, { component: "h1", id: "t", children: "Hello" }),
      asEl(container),
    );
    expect(serialize(container)).toBe('<div><h1 id="t">Hello</h1></div>');
  });

  test("renders a component, forwarding the remaining props", () => {
    const Box = (props: { label: string }) =>
      jsx("p", { children: props.label });
    const container = createContainer();
    render(
      () => jsx(Dynamic, { component: () => Box, label: "hi" }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>hi</p></div>");
  });

  test("swaps the host reactively when an accessor component changes", () => {
    const tag = signal<"h1" | "h2">("h1");
    const container = createContainer();
    render(
      () => jsx(Dynamic, { component: () => tag(), children: "x" }),
      asEl(container),
    );
    expect(byTag(container, "h1")).toBeDefined();
    tag.set("h2");
    expect(byTag(container, "h1")).toBeUndefined();
    expect(byTag(container, "h2")).toBeDefined();
  });

  test("renders nothing for a nullish component", () => {
    const comp = signal<string | null>(null);
    const container = createContainer();
    render(
      () => jsx(Dynamic, { component: () => comp(), children: "x" }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>");
    comp.set("span");
    expect(byTag(container, "span")).toBeDefined();
  });

  test("disposes the previous host's scope on swap", () => {
    const tag = signal<"a" | "b">("a");
    let disposed = 0;
    const A = () => {
      onCleanup(() => disposed++);
      return jsx("p", { children: "A" });
    };
    const B = () => jsx("p", { children: "B" });
    const container = createContainer();
    render(
      () => jsx(Dynamic, { component: () => (tag() === "a" ? A : B) }),
      asEl(container),
    );
    expect(disposed).toBe(0);
    tag.set("b");
    expect(disposed).toBe(1);
  });
});
