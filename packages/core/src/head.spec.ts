import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, render, jsx, Head, Title, renderToString } from "./index";
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

const head = (): MockNode =>
  (globalThis as unknown as { document: { head: MockNode } }).document.head;

function byTag(parent: MockNode, tag: string): MockNode | undefined {
  return parent.childNodes.find(
    (n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag,
  );
}

describe("<Head>", () => {
  test("appends children to <head> and nothing in place", () => {
    const container = createContainer();
    render(
      () =>
        jsx(Head, {
          children: jsx("meta", { name: "description", content: "hi" }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>");
    const meta = byTag(head(), "meta");
    expect(meta?.getAttribute("content")).toBe("hi");
  });

  test("keeps head content reactive", () => {
    const desc = signal("a");
    render(
      () =>
        jsx(Head, {
          children: jsx("meta", { name: "d", content: () => desc() }),
        }),
      asEl(createContainer()),
    );
    expect(byTag(head(), "meta")?.getAttribute("content")).toBe("a");
    desc.set("b");
    expect(byTag(head(), "meta")?.getAttribute("content")).toBe("b");
  });

  test("removes its head nodes when the owner disposes", () => {
    const dispose = render(
      () => jsx(Head, { children: jsx("link", { rel: "canonical", href: "/x" }) }),
      asEl(createContainer()),
    );
    expect(byTag(head(), "link")).toBeDefined();
    dispose();
    expect(byTag(head(), "link")).toBeUndefined();
  });
});

describe("<Title>", () => {
  test("sets the document title via a <title> in <head>", () => {
    render(() => jsx(Title, { children: "My Page" }), asEl(createContainer()));
    expect(byTag(head(), "title")?.textContent).toBe("My Page");
  });

  test("updates a reactive title in place", () => {
    const t = signal("one");
    render(
      () => jsx(Title, { children: () => t() }),
      asEl(createContainer()),
    );
    expect(byTag(head(), "title")?.textContent).toBe("one");
    t.set("two");
    expect(byTag(head(), "title")?.textContent).toBe("two");
  });

  test("is serialized into the head during SSR", () => {
    const { head: headHtml, html } = renderToString(() =>
      jsx(Title, { children: "SSR Title" }),
    );
    expect(headHtml).toContain("<title>SSR Title</title>");
    // The body slot holds only the reactive placeholder marker (no element).
    expect(html).toBe("<!---->");
  });
});
