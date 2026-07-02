/**
 * `kanabun serve` — an SSR server over core's `renderToString`.
 *
 * SSR is the same render `kanabun generate` runs at build time, executed per
 * request instead (see `docs/decisions.md` → "SSR, hydration & SSG"). The
 * config mirrors {@link SSGConfig} — `{ render(path), client?, title?,
 * document?, base? }` — so the CLI, not the app, owns the Bun/Node plumbing
 * (`Bun.serve`, `Bun.build`, the HTML document, path containment) that every
 * SSR entry used to hand-roll. An `islands` map swaps the single client bundle
 * for per-island chunks built with {@link buildIslands}, served alongside the
 * pages.
 *
 * The Bun APIs make this the CLI layer; the render itself reuses core's
 * runtime-independent primitive — no new rendering path.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { renderToString } from "@kanabun/core";
import { defaultDocument, type DocumentContext } from "./document";
import { errorMessages } from "./errors";
import { buildIslands } from "./islands";
import { normalizeBase, resolveWithin } from "./paths";

/** The shape a `serve` entry module default-exports (or exports directly). */
export interface SSRConfig {
  /** Returns the view to render for a given path (same convention as SSG). */
  render: (path: string) => unknown;
  /**
   * Optional client entry to bundle for hydration, resolved relative to
   * {@link ServeOptions.dir}. Bundled once at startup and served next to the
   * pages; the document references it so the markup becomes interactive.
   */
  client?: string;
  /**
   * Optional islands map (name → entry module, resolved like `client`) for
   * per-island code splitting instead of one `client` bundle: the chunks are
   * built once with `buildIslands` and only the islands present on a page are
   * fetched. Mutually exclusive with `client`.
   */
  islands?: Record<string, string>;
  /** `<title>` for the default document template. Defaults to `"kanabun"`. */
  title?: string;
  /**
   * Public base path the site is served from (e.g. `"/repo/"`). Prefixes the
   * client/bootstrap `<script>` src. Defaults to `"/"`. A `base` passed in
   * {@link ServeOptions} (the `--base` flag) overrides this.
   */
  base?: string;
  /** Custom HTML document template; overrides the built-in one. */
  document?: (ctx: DocumentContext) => string;
}

export interface ServeOptions {
  /**
   * Port to listen on; 0 picks an ephemeral port. Defaults to the `PORT`
   * environment variable, or 3000 — so example/deploy entries never read
   * `process.env` themselves.
   */
  port?: number;
  /** Minify the client/island bundles. Defaults to `true`. */
  minify?: boolean;
  /** Public base path (overrides the config's `base`). See {@link SSRConfig.base}. */
  base?: string;
  /**
   * Directory that relative `client`/`islands` entries resolve against —
   * typically the config file's directory (`kanabun serve` passes it) or
   * `import.meta.dir` when calling the API directly. Defaults to the cwd.
   */
  dir?: string;
}

export interface SSRServer {
  url: string;
  port: number;
  /** Stop the server. */
  stop: () => void;
}

const HTML = { "content-type": "text/html; charset=utf-8" };
const JS = { "content-type": "text/javascript; charset=utf-8" };

/**
 * Serve `pathname` from under `root` as a static file: 403 when the path
 * escapes the root, 404 when it doesn't exist. Shared by the islands-chunk
 * route here and by {@link preview}'s static site handler.
 */
export async function serveFile(root: string, pathname: string): Promise<Response> {
  const filePath = resolveWithin(root, pathname);
  if (filePath === undefined) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  return new Response("Not found", { status: 404 });
}

/**
 * Build the client (or islands) once and return the request handler, separated
 * from the server so it can be tested directly: bundle/chunk requests are
 * served statically, every other path is SSR-rendered through the shared
 * document template. Throws on a broken config or a failed build — the CLI
 * turns that into a non-zero exit (unlike `build`/`generate` there is no
 * result object to report through; a server that can't serve should not start).
 */
export async function createSSRHandler(
  config: SSRConfig,
  options: ServeOptions = {},
): Promise<(req: Request) => Promise<Response>> {
  if (typeof config.render !== "function") {
    throw new Error("kanabun: serve config must include a `render(path)` function.");
  }
  if (config.client !== undefined && config.islands !== undefined) {
    throw new Error("kanabun: serve config takes `client` or `islands`, not both.");
  }
  const dir = resolve(options.dir ?? ".");
  const base = normalizeBase(options.base ?? config.base ?? "/");
  const title = config.title ?? "kanabun";
  const minify = options.minify ?? true;

  // The `<script>` tag the document embeds, and where its code comes from:
  // a single in-memory client bundle, or a dir of per-island chunks on disk.
  let script = "";
  let bundle: { path: string; text: string } | undefined;
  let chunkDir: string | undefined;

  if (config.client !== undefined) {
    try {
      const built = await Bun.build({
        entrypoints: [resolve(dir, config.client)],
        target: "browser",
        minify,
      });
      const out = built.outputs[0]!;
      bundle = { path: `${base}${basename(out.path)}`, text: await out.text() };
    } catch (error) {
      // Bun.build throws an AggregateError whose diagnostics live in `.errors`.
      throw new Error(`kanabun: client bundle failed:\n${errorMessages(error).join("\n")}`);
    }
    script = `<script type="module" src="${bundle.path}"></script>`;
  } else if (config.islands !== undefined) {
    chunkDir = await mkdtemp(join(tmpdir(), "kanabun-serve-islands-"));
    const built = await buildIslands({
      islands: Object.fromEntries(
        Object.entries(config.islands).map(([name, entry]) => [name, resolve(dir, entry)]),
      ),
      outdir: chunkDir,
      minify,
      base,
    });
    if (!built.success) {
      throw new Error(`kanabun: islands build failed:\n${built.logs.join("\n")}`);
    }
    script = built.script;
  }

  return async (req: Request): Promise<Response> => {
    // A malformed percent-escape makes decodeURIComponent throw; 404 rather
    // than letting it bubble out of the handler (same as the dev server).
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }

    if (bundle !== undefined && pathname === bundle.path) {
      return new Response(bundle.text, { headers: JS });
    }
    if (chunkDir !== undefined && extname(pathname) !== "") {
      // Chunks live under `base` (the bootstrap's imports resolve relative to
      // its own URL), so strip the prefix — keeping the leading slash — before
      // the containment check.
      const rel = pathname.startsWith(base) ? pathname.slice(base.length - 1) : pathname;
      return serveFile(chunkDir, rel);
    }

    const { html, head } = renderToString(() => config.render(pathname));
    const ctx: DocumentContext = { html, head, path: pathname, script, base };
    const page = config.document ? config.document(ctx) : defaultDocument(ctx, title);
    return new Response(page, { headers: HTML });
  };
}

/** The port to listen on when neither the options nor `$PORT` name one. */
export function defaultPort(env: string | undefined, fallback = 3000): number {
  return Number(env) || fallback;
}

/**
 * Start an SSR server for the config. Builds the client (or islands) once,
 * then renders `config.render(path)` per request. Returns its URL/port and a
 * `stop()` function.
 */
export async function serve(
  config: SSRConfig,
  options: ServeOptions = {},
): Promise<SSRServer> {
  const handler = await createSSRHandler(config, options);
  const server = Bun.serve({
    port: options.port ?? defaultPort(process.env.PORT),
    fetch: handler,
  });
  return {
    url: server.url.href,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}
