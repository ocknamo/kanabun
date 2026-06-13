/**
 * `kanabun dev` — a zero-config dev server on top of Bun's built-in HTTP server.
 *
 * It serves an HTML entry, bundles referenced TS/TSX modules on the fly with
 * `Bun.build`, and does a **full reload** on file changes over a WebSocket
 * (stateful HMR is deliberately deferred — see docs/decisions.md). All Bun/Node
 * APIs are confined to this CLI layer.
 */
import { watch } from "node:fs";
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

const LIVE_RELOAD_SNIPPET = `
<script>
  (() => {
    const ws = new WebSocket(\`ws://\${location.host}${LIVE_RELOAD_PATH}\`);
    ws.onmessage = (e) => { if (e.data === "reload") location.reload(); };
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
  const root = resolve(options.root);
  return async (req: Request): Promise<Response> => {
    const pathname = decodeURIComponent(new URL(req.url).pathname);

    if (pathname === "/" || pathname === "/index.html") {
      const html = await Bun.file(htmlPath).text();
      const injected = html.includes("</body>")
        ? html.replace("</body>", `${LIVE_RELOAD_SNIPPET}\n</body>`)
        : html + LIVE_RELOAD_SNIPPET;
      return new Response(injected, {
        headers: { "content-type": CONTENT_TYPES[".html"]! },
      });
    }

    const filePath = join(root, pathname);
    // Reject path traversal: `..` (incl. `%2e%2e%2f`, which `decodeURIComponent`
    // turns back into `../`) must not escape the served root.
    const resolved = resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      return new Response("Not found", { status: 404 });
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
    return new Response("Not found", { status: 404 });
  };
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

  const watcher = watch(root, { recursive: true }, () => {
    for (const ws of clients) ws.send("reload");
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
