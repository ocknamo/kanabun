/**
 * `kanabun dev` — a zero-config dev server on top of Bun's built-in HTTP server.
 *
 * It serves an HTML entry, bundles referenced TS/TSX modules on the fly with
 * `Bun.build`, and pushes an update over a WebSocket on file change. A change to
 * a `.css` file is **hot-swapped** (the matching `<link rel="stylesheet">` is
 * re-fetched in place, preserving all app state); any other change is a **full
 * reload**. Component-level HMR with state preservation is out of reach without
 * a compiler (see docs/decisions.md). All Bun/Node APIs are confined to this
 * CLI layer.
 */
import { realpathSync, watch } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import { errorMessages } from "./errors";

const LIVE_RELOAD_PATH = "/__kanabun_livereload";
const MODULE_RE = /\.(tsx|ts|jsx|js)$/;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Enables @kanabun/core's dev-time warnings in the served page. A classic
// inline script, so it runs before the deferred app module bundle and the two
// share `globalThis`.
const DEV_FLAG_SNIPPET = `
<script>globalThis.__KANABUN_DEV__ = true;</script>`;

// Minimal structural shapes of the browser objects `swapCss` touches, so the
// function can be a real (unit-tested) function here without pulling in the DOM
// lib — it runs in the browser via `.toString()` (below), and in tests against
// hand-rolled mocks.
interface SwapLink {
  href: string;
  nextSibling: unknown;
  parentNode: { insertBefore(node: SwapLink, ref: unknown): void } | null;
  cloneNode(): SwapLink;
  addEventListener(type: "load" | "error", listener: () => void): void;
  remove(): void;
}
interface SwapDoc {
  querySelectorAll(selector: string): Iterable<SwapLink>;
}
interface SwapLoc {
  href: string;
  reload(): void;
}

/**
 * Client-side CSS hot-swap: re-fetch every `<link rel="stylesheet">` whose URL
 * **pathname** matches `path` (a fresh cache-busting query forces the refetch),
 * removing each old link once its replacement loads so there's no flash. App
 * state survives because nothing else re-executes. If no stylesheet matches
 * (e.g. the `.css` is imported through a JS module, or served under a `<base>` /
 * sub-path so pathnames differ), fall back to a full reload so the edit is never
 * silently dropped. The match is a case-sensitive exact pathname compare; the
 * server keeps the changed file's original casing (see {@link changeMessage}).
 *
 * Defined as a real function (not inline source) so it's unit-tested; it is
 * serialised into the dev page via `swapCss.toString()` in {@link LIVE_RELOAD_SNIPPET},
 * where `document`/`location` are passed as the browser globals.
 */
export function swapCss(doc: SwapDoc, loc: SwapLoc, path: string): void {
  let found = false;
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const url = new URL(link.href, loc.href);
    if (url.pathname !== path) continue;
    found = true;
    url.searchParams.set("k-hmr", String(Date.now()));
    const next = link.cloneNode();
    next.href = url.href;
    next.addEventListener("load", () => link.remove());
    next.addEventListener("error", () => link.remove());
    link.parentNode!.insertBefore(next, link.nextSibling);
  }
  if (!found) loc.reload();
}

// A "css:<path>" message hot-swaps via swapCss (state preserved); a "reload"
// message (any non-CSS change) does a full reload.
const LIVE_RELOAD_SNIPPET = `
<script>
  ${swapCss.toString()}
  (() => {
    const ws = new WebSocket(\`ws://\${location.host}${LIVE_RELOAD_PATH}\`);
    ws.onmessage = (e) => {
      const data = String(e.data);
      if (data === "reload") location.reload();
      else if (data.slice(0, 4) === "css:") swapCss(document, location, data.slice(4));
    };
    ws.onclose = () => setTimeout(() => location.reload(), 1000);
  })();
</script>`;

// Minimal structural shapes the dev overlay touches in the browser, so it can be
// a real (unit-tested) function here without pulling in the DOM lib — it runs in
// the browser via `.toString()` (below), and in tests against hand-rolled mocks.
interface OverlayStyle {
  cssText: string;
  display: string;
}
interface OverlayEl {
  style: OverlayStyle;
  textContent: string;
  appendChild(child: OverlayEl): void;
  addEventListener(type: string, listener: () => void): void;
}
interface OverlayWindow {
  document: { createElement(tag: string): OverlayEl; body: OverlayEl };
  console: {
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  addEventListener(
    type: "error" | "unhandledrejection",
    listener: (event: unknown) => void,
  ): void;
}

/**
 * Client-side dev overlay: surfaces problems on-screen instead of only in the
 * console. It is the **consumer** of the dev-warning seam — core routes its
 * `setDev`-gated warnings through a sink that defaults to `console.warn`, so by
 * tapping `console.warn` (and `console.error`) the overlay sees every dev
 * warning with no change to runtime-independent core. On top of that it listens
 * for **uncaught** errors and unhandled promise rejections on `window`. The
 * original `console` methods are still called, so nothing is swallowed.
 *
 * The panel is built lazily on the first message (so a clean page shows nothing)
 * and pinned to the bottom of the viewport with a running error/warning count
 * and a dismiss button. Defined as a real function (not inline source) so it's
 * unit-tested; it is serialised into the dev page via `devOverlay.toString()` in
 * {@link OVERLAY_SNIPPET}, where `window` is passed as the browser global.
 */
export function devOverlay(win: OverlayWindow): void {
  const doc = win.document;
  let panel: OverlayEl | null = null;
  let list: OverlayEl | null = null;
  let title: OverlayEl | null = null;
  let errors = 0;
  let warnings = 0;

  const format = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack ?? v.message;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  const ensurePanel = (): void => {
    if (panel) {
      panel.style.display = "block";
      return;
    }
    panel = doc.createElement("div");
    panel.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
      "max-height:50vh;overflow:auto;font:12px/1.5 ui-monospace,monospace;" +
      "background:#1b1b1f;color:#eee;border-top:2px solid #e5484d;" +
      "box-shadow:0 -4px 16px rgba(0,0,0,.4);padding:8px 12px";
    const header = doc.createElement("div");
    header.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;" +
      "font-weight:bold;margin-bottom:6px";
    title = doc.createElement("span");
    const close = doc.createElement("button");
    close.textContent = "✕";
    close.style.cssText =
      "background:none;border:none;color:#eee;cursor:pointer;font-size:14px";
    close.addEventListener("click", () => {
      if (panel) panel.style.display = "none";
    });
    header.appendChild(title);
    header.appendChild(close);
    list = doc.createElement("div");
    panel.appendChild(header);
    panel.appendChild(list);
    doc.body.appendChild(panel);
  };

  const push = (kind: "error" | "warning", message: string): void => {
    ensurePanel();
    if (kind === "error") errors++;
    else warnings++;
    if (title) {
      title.textContent =
        "kanabun dev — " + errors + " error(s), " + warnings + " warning(s)";
    }
    const entry = doc.createElement("div");
    entry.style.cssText =
      "white-space:pre-wrap;padding:4px 0;border-top:1px solid #333;" +
      (kind === "error" ? "color:#ff9ea0" : "color:#ffd479");
    entry.textContent = message;
    if (list) list.appendChild(entry);
  };

  const origError = win.console.error;
  const origWarn = win.console.warn;
  win.console.error = (...args: unknown[]): void => {
    push("error", args.map(format).join(" "));
    origError.apply(win.console, args);
  };
  win.console.warn = (...args: unknown[]): void => {
    push("warning", args.map(format).join(" "));
    origWarn.apply(win.console, args);
  };
  win.addEventListener("error", (event: unknown): void => {
    const e = event as { message?: string; error?: unknown };
    push("error", format(e.error ?? e.message ?? event));
  });
  win.addEventListener("unhandledrejection", (event: unknown): void => {
    const e = event as { reason?: unknown };
    push("error", "Unhandled rejection: " + format(e.reason ?? event));
  });
}

// Installs the overlay before the deferred app module runs, so it captures even
// the earliest warnings/errors. A classic inline script (shares `globalThis`).
const OVERLAY_SNIPPET = `
<script>
  ${devOverlay.toString()}
  devOverlay(window);
</script>`;

export interface DevHandlerOptions {
  /** Absolute path to the HTML entry. */
  htmlPath: string;
  /** Absolute directory other assets/modules are resolved against. */
  root: string;
}

/**
 * The HTTP request handler, separated from the server so it can be tested
 * directly: HTML gets the live-reload snippet injected, module requests are
 * bundled for the browser, other paths are served as static files (or 404).
 */
export function createDevHandler(
  options: DevHandlerOptions,
): (req: Request) => Promise<Response> {
  const { htmlPath } = options;
  // Canonical served root (symlinks resolved) so containment checks are sound.
  const root = realpathSync(resolve(options.root));
  const notFound = (): Response => new Response("Not found", { status: 404 });
  const escapesRoot = (p: string): boolean => p !== root && !p.startsWith(root + sep);

  // Serve the HTML entry with the dev preludes injected. A `<base href="/">` is
  // added (when absent, and the entry has a `<head>`) so a page served under a
  // client route like `/users/2` resolves its relative `<script src="./main.tsx">`
  // and asset URLs against the server root rather than the route's directory —
  // otherwise the SPA fallback below would serve HTML whose module never loads.
  const serveHtml = async (): Promise<Response> => {
    let html = await Bun.file(htmlPath).text();
    // Insert right after the opening `<head>` (any attributes, any case); a no-op
    // when the entry has no head or already declares its own `<base>`.
    if (!/<base\b/i.test(html)) {
      html = html.replace(/<head\b[^>]*>/i, (head) => `${head}\n    <base href="/" />`);
    }
    const prelude = `${DEV_FLAG_SNIPPET}${OVERLAY_SNIPPET}${LIVE_RELOAD_SNIPPET}`;
    const injected = html.includes("</body>")
      ? html.replace("</body>", `${prelude}\n</body>`)
      : html + prelude;
    return new Response(injected, {
      headers: { "content-type": CONTENT_TYPES[".html"]! },
    });
  };

  return async (req: Request): Promise<Response> => {
    // A malformed percent-escape (`/%ZZ`, a lone `%`) makes decodeURIComponent
    // throw a URIError; treat such a request as a 404 rather than letting it
    // bubble out of the handler.
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return notFound();
    }

    if (pathname === "/" || pathname === "/index.html") return serveHtml();

    const filePath = join(root, pathname);
    // Two containment checks must both pass:
    //  1. lexical — blocks `..` (incl. `%2e%2e%2f`, which decodeURIComponent
    //     turns back into `../`).
    //  2. real path — blocks a symlink *inside* root pointing outside it
    //     (which would otherwise be followed by Bun.file / Bun.build).
    if (escapesRoot(resolve(filePath))) return notFound();
    try {
      if (escapesRoot(await realpath(filePath))) return notFound();
    } catch {
      // Target doesn't exist: fall through (module → build error, static → 404).
    }

    if (MODULE_RE.test(pathname)) {
      const errorScript = (message: string): Response =>
        new Response(
          `console.error(${JSON.stringify("kanabun build error:\n" + message)});`,
          { headers: { "content-type": CONTENT_TYPES[".js"]! } },
        );
      try {
        const result = await Bun.build({ entrypoints: [filePath], target: "browser" });
        if (!result.success) return errorScript(result.logs.map(String).join("\n"));
        const js = await result.outputs[0]!.text();
        return new Response(js, { headers: { "content-type": CONTENT_TYPES[".js"]! } });
      } catch (error) {
        return errorScript(errorMessages(error).join("\n"));
      }
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      const type = CONTENT_TYPES[extname(pathname)];
      return new Response(file, type ? { headers: { "content-type": type } } : {});
    }
    // SPA fallback: a navigation request (no file extension) that matched no
    // static file is a client-side route — serve the HTML entry so the in-page
    // router can render it, making deep links and refreshes work. A request for
    // a missing asset (one with an extension, e.g. `.png`) still 404s.
    if (extname(pathname) === "") return serveHtml();
    return notFound();
  };
}

/**
 * Decide the WebSocket message for a changed file: a targeted `css:<url-path>`
 * hot-swap for `.css` files (the client re-fetches just that stylesheet, so app
 * state is preserved), otherwise a full `reload`. `filename` is the watcher's
 * path relative to the served root (OS separators are normalised to `/`); a
 * missing filename falls back to a reload. Exported for testing.
 */
export function changeMessage(filename: string | null | undefined): string {
  if (typeof filename === "string" && filename.toLowerCase().endsWith(".css")) {
    return "css:/" + filename.split(sep).join("/");
  }
  return "reload";
}

export interface DevOptions {
  /** HTML entry. Defaults to `index.html`. */
  entry?: string;
  /** Port to listen on. Defaults to 3000; use 0 for an ephemeral port. */
  port?: number;
}

export interface DevServer {
  url: string;
  port: number;
  /** Stop the server and the file watcher. */
  stop: () => void;
}

/** Start the dev server. Returns its URL/port and a `stop()` function. */
export function dev(options: DevOptions = {}): DevServer {
  const htmlPath = resolve(options.entry ?? "index.html");
  const root = dirname(htmlPath);
  const handler = createDevHandler({ htmlPath, root });
  const clients = new Set<ServerWebSocket<unknown>>();

  const server = Bun.serve({
    port: options.port ?? 3000,
    async fetch(req, srv): Promise<Response | undefined> {
      if (new URL(req.url).pathname === LIVE_RELOAD_PATH) {
        return srv.upgrade(req)
          ? undefined
          : new Response("expected websocket", { status: 400 });
      }
      return handler(req);
    },
    websocket: {
      open: (ws) => {
        clients.add(ws);
      },
      close: (ws) => {
        clients.delete(ws);
      },
      message: () => {},
    },
  });

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const message = changeMessage(filename);
    for (const ws of clients) ws.send(message);
  });

  return {
    url: server.url.href,
    port: server.port ?? 0,
    stop: () => {
      watcher.close();
      server.stop(true);
    },
  };
}
