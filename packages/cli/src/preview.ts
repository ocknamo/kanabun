/**
 * `kanabun preview` — build the SSG output (`generate`) and serve it
 * statically. The preview a static deploy would give you, without hand-rolling
 * the temp dir + `Bun.serve` + path-containment plumbing per project. Unlike
 * `serve` (which renders per request), the pages here are prebuilt `.html`
 * files and just served.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generate } from "./generate";
import { defaultPort, serveFile, type SSRServer } from "./serve";

export interface PreviewOptions {
  /** Entry module that exports an `SSGConfig` (same entry `generate` takes). */
  entry: string;
  /**
   * Directory to build into (and serve from). Defaults to a fresh temp dir,
   * so a preview never clobbers a real `dist`.
   */
  outdir?: string;
  /** Port to listen on. Defaults like {@link ServeOptions.port} (`$PORT` or 3000). */
  port?: number;
  /** Minify the client bundle. Defaults to `true`. */
  minify?: boolean;
  /** Public base path (the `--base` flag). See `SSGConfig.base`. */
  base?: string;
}

export interface PreviewServer extends SSRServer {
  /** The directory the site was built into (and is served from). */
  outdir: string;
}

/**
 * Prerender the SSG entry and serve the result as static files (`/` and other
 * directory paths fall back to their `index.html`). Throws when the build
 * fails — a preview with nothing to serve should not start.
 */
export async function preview(options: PreviewOptions): Promise<PreviewServer> {
  const outdir = resolve(
    options.outdir ?? (await mkdtemp(join(tmpdir(), "kanabun-preview-"))),
  );
  const result = await generate({
    entry: options.entry,
    outdir,
    minify: options.minify,
    base: options.base,
  });
  if (!result.success) {
    throw new Error(`kanabun: SSG build failed:\n${result.logs.join("\n")}`);
  }

  const server = Bun.serve({
    port: options.port ?? defaultPort(process.env.PORT),
    async fetch(req): Promise<Response> {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url).pathname);
      } catch {
        return new Response("Not found", { status: 404 });
      }
      if (pathname.endsWith("/")) pathname += "index.html";
      return serveFile(outdir, pathname);
    },
  });
  return {
    url: server.url.href,
    port: server.port ?? 0,
    outdir,
    stop: () => server.stop(true),
  };
}
