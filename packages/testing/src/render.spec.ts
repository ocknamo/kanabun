import { describe, expect, test } from "bun:test";
import { jsx, signal } from "@kanabun/core";
import { MockDocument, createContainer, installDOM } from "./dom-mock";
import { renderTest } from "./render";

/** Run `fn` with `globalThis.document` guaranteed absent, then restore it. */
function withoutDocument(fn: () => void): void {
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  delete g.document;
  try {
    fn();
  } finally {
    if (prev !== undefined) g.document = prev;
    else delete g.document;
  }
}

describe("renderTest", () => {
  test("auto-installs a document when none exists and restores it on dispose", () => {
    withoutDocument(() => {
      const g = globalThis as { document?: unknown };
      const count = signal(0);
      const result = renderTest(() => jsx("span", { children: count }));
      expect(g.document).toBeInstanceOf(MockDocument);
      expect(result.html()).toBe("<div><span>0</span></div>");
      count.set(1); // the render is live — reactive updates land in html()
      expect(result.html()).toBe("<div><span>1</span></div>");
      result.dispose();
      expect(g.document).toBeUndefined();
    });
  });

  test("reuses a caller-installed document and leaves it alone on dispose", () => {
    withoutDocument(() => {
      const g = globalThis as { document?: unknown };
      const teardown = installDOM();
      const installed = g.document;
      const result = renderTest(() => jsx("p", { children: "hi" }));
      expect(g.document).toBe(installed);
      result.dispose();
      expect(g.document).toBe(installed); // still there — caller owns it
      teardown();
    });
  });

  test("renders into a provided container", () => {
    withoutDocument(() => {
      const container = createContainer("section");
      const result = renderTest(() => jsx("em", { children: "x" }), { container });
      expect(result.container).toBe(container);
      expect(result.html()).toBe("<section><em>x</em></section>");
      result.dispose();
    });
  });

  test("returns container-bound queries", () => {
    withoutDocument(() => {
      const result = renderTest(() => jsx("button", { children: "go" }));
      expect(result.getByText("go")).toBe(result.getByTag("button"));
      expect(result.queryByTag("ul")).toBeUndefined();
      expect(() => result.getByTag("ul")).toThrow("Unable to find a <ul> element");
      result.dispose();
    });
  });

  test("dispose is idempotent and tears the tree down", () => {
    withoutDocument(() => {
      const g = globalThis as { document?: unknown };
      const result = renderTest(() => jsx("span", { children: "gone" }));
      result.dispose();
      expect(result.html()).toBe("<div></div>");
      result.dispose(); // second call must not throw or double-restore
      expect(g.document).toBeUndefined();
    });
  });
});
