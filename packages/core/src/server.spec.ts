import { describe, expect, test, afterEach } from "bun:test";
import { signal, onMount, jsx, renderToString, css } from "./index";
import { flushStyles } from "./css";

// `renderToString` installs and restores its own document; these tests must run
// with no ambient one, mimicking a server. Guard against leaks between tests.
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("renderToString", () => {
  test("renders a plain element with no head styles", () => {
    const { html, head } = renderToString(() => jsx("div", { children: "hi" }));
    expect(html).toBe("<div>hi</div>");
    expect(head).toBe("");
  });

  test("escapes interpolated text", () => {
    const { html } = renderToString(() =>
      jsx("p", { children: "<script>&" }),
    );
    expect(html).toBe("<p>&lt;script&gt;&amp;</p>");
  });

  test("reads a reactive child once (no subscription, no re-render)", () => {
    const count = signal(5);
    const { html } = renderToString(() =>
      jsx("p", { children: ["n=", count] }),
    );
    // A reactive slot's content sits before its trailing comment-marker anchor.
    expect(html).toBe("<p>n=5<!----></p>");
    // The reactive graph was torn down: a later write is inert (no throw).
    expect(() => count.set(6)).not.toThrow();
  });

  test("restores the previous document afterwards", () => {
    const sentinel = { sentinel: true };
    (globalThis as { document?: unknown }).document = sentinel;
    renderToString(() => jsx("div", { children: "x" }));
    expect((globalThis as { document?: unknown }).document).toBe(sentinel);
  });

  test("does not run onMount on the server", async () => {
    let mounted = false;
    function App() {
      onMount(() => {
        mounted = true;
      });
      return jsx("div", { children: "x" });
    }
    renderToString(() => jsx(App, {}));
    await Promise.resolve();
    await Promise.resolve();
    expect(mounted).toBe(false);
  });

  test("collects scoped-css styles emitted during the render into head", () => {
    function Box() {
      const cls = css`color: rebeccapurple;`;
      return jsx("div", { class: cls, children: "x" });
    }
    const { html, head } = renderToString(() => jsx(Box, {}));
    expect(html).toMatch(/^<div class="k-[a-z0-9]+">x<\/div>$/);
    expect(head).toMatch(/^<style data-k="[a-z0-9]+">\.k-[a-z0-9]+\{color: rebeccapurple;\}<\/style>$/);
  });
});

describe("import-time styles (flushStyles / pending)", () => {
  test("css with no document defers, then is replayed into a render's head", () => {
    // No ambient document: this mimics a module-level `css` at server import.
    delete (globalThis as { document?: unknown }).document;
    const cls = css`outline: 3px dotted teal;`; // unique body → its own hash
    expect(cls).toMatch(/^k-[a-z0-9]+$/);
    const { head } = renderToString(() => jsx("div", { class: cls }));
    expect(head).toContain(`<style data-k="${cls.slice(2)}">`);
    expect(head).toContain("outline: 3px dotted teal;");
  });

  test("flushStyles is a no-op when no document is present", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => flushStyles()).not.toThrow();
  });
});
