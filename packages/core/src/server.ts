/**
 * kanabun — server rendering (`renderToString`)
 * ------------------------------------------------------------------
 * Renders a view to an HTML string with **no real DOM**, for SSR (run per
 * request) or SSG (run at build time — same primitive, different timing; see
 * `docs/decisions.md` → "SSR, hydration & SSG").
 *
 * The JSX runtime builds DOM eagerly via `doc()` (which reads
 * `globalThis.document`), so rather than a second render path we install a
 * serializable {@link ServerDocument} for the duration of the render, build the
 * tree through the normal runtime, serialize it, then dispose and restore. The
 * reactive graph is torn down immediately: nothing re-runs, and `onMount`
 * (deferred to a microtask) is skipped because its owner is already disposed —
 * lifecycle effects belong to the client.
 *
 * Standard JS only — no Bun/Node APIs — so this stays in `packages/core`. The
 * caller (a server handler, or the CLI's prerender step) owns the surrounding
 * HTML document and writing files.
 */
import { createRoot } from "./reactive";
import { insert } from "./dom";
import { flushStyles } from "./css";
import { ServerDocument, serialize } from "./server-dom";

/** The pieces a caller needs to assemble an HTML document. */
export interface RenderToStringResult {
  /** The serialized app markup (to place in `<body>` / a mount container). */
  html: string;
  /**
   * The `<style>` tags collected from the scoped-`css` helper during the
   * render (to place in `<head>`). Each carries a `data-k` hash so the client
   * dedupes against it on hydration instead of injecting a duplicate.
   */
  head: string;
}

/**
 * Render `code` (a thunk returning the view) to HTML strings.
 *
 * @example
 *   const { html, head } = renderToString(() => <App />);
 *   const page = `<!doctype html><html><head>${head}</head>` +
 *                `<body><div id="app">${html}</div>...</body></html>`;
 */
export function renderToString(code: () => unknown): RenderToStringResult {
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  const sdoc = new ServerDocument();
  g.document = sdoc;
  try {
    // Replay styles registered before this document existed (import-time css).
    flushStyles();
    let html = "";
    createRoot((dispose) => {
      try {
        const root = sdoc.createElement("div");
        insert(root as unknown as Node, code());
        html = root.childNodes.map(serialize).join("");
      } finally {
        // Always tear the root down — even if `code()` throws — so a render
        // called from within an owner context can't leak the scope on error.
        dispose();
      }
    });
    const head = sdoc.head.childNodes.map(serialize).join("");
    return { html, head };
  } finally {
    g.document = prev;
  }
}
