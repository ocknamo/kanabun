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

// On a "css:<path>" message, re-fetch only the matching stylesheet link
// (cache-busted) so style edits apply without a reload and app state survives;
// the old link is removed once the replacement loads, avoiding a flash. A
// "reload" message (any non-CSS change) does a full reload. If no stylesheet
// matches the changed path, fall back to a reload so the edit is never missed.
const LIVE_RELOAD_SNIPPET = `
<script>
  (() => {
    const swapCss = (path) => {
      let found = false;
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const url = new URL(link.href, location.href);
        if (url.pathname !== path) continue;
        found = true;
        url.searchParams.set("k-hmr", Date.now());
        const next = link.cloneNode();
        next.href = url.href;
        next.addEventListener("load", () => link.remove());
        next.addEventListener("error", () => link.remove());
        link.parentNode.insertBefore(next, link.nextSibling);
      }
      if (!found) location.reload();
    };
    const ws = new WebSocket(\`ws://\${location.host}${LIVE_RELOAD_PATH}\`);
    ws.onmessage = (e) => {
      const data = String(e.data);
      if (data === "reload") location.reload();
      else if (data.slice(0, 4) === "css:") swapCss(data.slice(4));
    };
    ws.onclose = () => setTimeout(() => location.reload(), 1000);
  })();
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

    if (pathname === "/" || pathname === "/index.html") {
      const html = await Bun.file(htmlPath).text();
      const prelude = `${DEV_FLAG_SNIPPET}${LIVE_RELOAD_SNIPPET}`;
      const injected = html.includes("</body>")
        ? html.replace("</body>", `${prelude}\n</body>`)
        : html + prelude;
      return new Response(injected, {
        headers: { "content-type": CONTENT_TYPES[".html"]! },
      });
    }

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
