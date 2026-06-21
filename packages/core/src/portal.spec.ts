import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, render, jsx, onMount, Portal, renderToString } from "./index";
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

const body = (): MockNode =>
  (globalThis as unknown as { document: { body: MockNode } }).document.body;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function byTag(parent: MockNode, tag: string): MockNode | undefined {
  return parent.childNodes.find(
    (n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag,
  );
}

describe("<Portal>", () => {
  test("teleports children into document.body and renders nothing in place", () => {
    const container = createContainer();
    render(
      () => jsx(Portal, { children: jsx("div", { id: "modal", children: "hi" }) }),
      asEl(container),
    );
    // Nothing in the original tree (the portal placeholder is empty)…
    expect(byTag(container, "div")).toBeUndefined();
    // …but the content is in <body>.
    expect(serialize(body())).toContain('<div id="modal">hi</div>');
  });

  test("renders into a custom mount target", () => {
    const layer = createContainer("section");
    const container = createContainer();
    render(
      () =>
        jsx(Portal, {
          mount: asEl(layer),
          children: jsx("span", { children: "tip" }),
        }),
      asEl(container),
    );
    expect(serialize(layer)).toContain("<span>tip</span>");
    expect(serialize(body())).not.toContain("tip");
  });

  test("keeps the portaled content reactive", () => {
    const text = signal("a");
    const layer = createContainer("section");
    render(
      () =>
        jsx(Portal, {
          mount: asEl(layer),
          children: jsx("p", { children: () => text() }),
        }),
      asEl(createContainer()),
    );
    expect(serialize(layer)).toContain("<p>a</p>");
    text.set("b");
    expect(serialize(layer)).toContain("<p>b</p>");
  });

  test("removes the portaled nodes when the owner disposes", () => {
    const layer = createContainer("section");
    const dispose = render(
      () =>
        jsx(Portal, {
          mount: asEl(layer),
          children: jsx("p", { children: "x" }),
        }),
      asEl(createContainer()),
    );
    expect(layer.childNodes.length).toBeGreaterThan(0);
    dispose();
    // Markers and content are gone.
    expect(layer.childNodes.length).toBe(0);
  });

  test("removes nodes a reactive child added after mount", () => {
    const show = signal(false);
    const layer = createContainer("section");
    const dispose = render(
      () =>
        jsx(Portal, {
          mount: asEl(layer),
          children: () => (show() ? jsx("b", { children: "on" }) : null),
        }),
      asEl(createContainer()),
    );
    show.set(true);
    expect(byTag(layer, "b")).toBeDefined();
    dispose();
    expect(layer.childNodes.length).toBe(0);
  });

  test("renders under renderToString without throwing (client concern, not serialized)", () => {
    const { html } = renderToString(() =>
      jsx(Portal, { children: jsx("div", { id: "m", children: "x" }) }),
    );
    // The portal teleports into the server document's <body>, which isn't part
    // of the returned markup — only the empty placeholder marker is.
    expect(html).toBe("<!---->");
  });

  test("fires onMount for portaled content", async () => {
    let mounted = false;
    const layer = createContainer("section");
    const Child = () => {
      onMount(() => {
        mounted = true;
      });
      return jsx("p", { children: "x" });
    };
    render(
      () => jsx(Portal, { mount: asEl(layer), children: jsx(Child, {}) }),
      asEl(createContainer()),
    );
    expect(mounted).toBe(false);
    await tick();
    expect(mounted).toBe(true);
  });
});
