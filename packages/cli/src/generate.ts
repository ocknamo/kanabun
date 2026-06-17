/**
 * `kanabun generate` — static site generation (SSG).
 *
 * SSG is **SSR run at build time** (see `docs/decisions.md` → "SSR, hydration &
 * SSG"): import the user's SSG config, call core's runtime-independent
 * `renderToString` for each route, wrap the markup in an HTML document, and
 * write it to `<outdir>/<route>/index.html`. When the config names a `client`
 * entry, bundle it once with `Bun.build` so the prerendered pages hydrate into
 * a live app; otherwise the output is purely static HTML.
 *
 * The file writing and bundling are Bun/Node APIs, so this is the CLI layer.
 * The render itself reuses core's primitive — no new rendering path.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { renderToString } from "@kanabun/core";
import { errorMessages } from "./errors";

/** Context handed to a custom {@link SSGConfig.document} template. */
export interface DocumentContext {
  /** The serialized app markup for this route (place in the mount container). */
  html: string;
  /** Collected scoped-CSS `<style>` tags to place in `<head>`. */
  head: string;
  /** The route path being rendered (e.g. `"/"`, `"/about/"`). */
  path: string;
  /** The `<script>` tag for the client bundle, or `""` when there is no client. */
  script: string;
}

/** The shape a `generate` entry module default-exports (or exports directly). */
export interface SSGConfig {
  /** Paths to prerender. Defaults to `["/"]`. */
  routes?: string[];
  /** Returns the view to render for a given path. */
  render: (path: string) => unknown;
  /**
   * Optional client entry to bundle for hydration, resolved relative to the
   * config file. When set, the default document references the bundle so the
   * page becomes interactive; when omitted, the output is static-only.
   */
  client?: string;
  /** `<title>` for the default document template. Defaults to `"kanabun"`. */
  title?: string;
  /** Custom HTML document template; overrides the built-in one. */
  document?: (ctx: DocumentContext) => string;
}

export interface GenerateOptions {
  /** Entry module that exports an {@link SSGConfig} (default or direct). */
  entry: string;
  /** Output directory. Defaults to `dist`. */
  outdir?: string;
  /** Minify the client bundle. Defaults to `true`. */
  minify?: boolean;
}

export interface GenerateResult {
  success: boolean;
  /** Absolute paths of the `.html` files written. */
  pages: string[];
  logs: string[];
}

/** `"/"` → `index.html`; `"/about/"` → `about/index.html`. */
function routeToFile(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "index.html" : join(trimmed, "index.html");
}

/** The built-in HTML document used when the config supplies no `document`. */
function defaultDocument(ctx: DocumentContext, title: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>${title}</title>\n${ctx.head}\n` +
    `</head>\n<body>\n<div id="app">${ctx.html}</div>\n${ctx.script}\n` +
    `</body>\n</html>\n`
  );
}

/**
 * Prerender every route in the config's entry to a static `.html` file under
 * `outdir`. Never throws: a failure (bad entry, client bundle error, or a
 * throwing `render`) is reported as `success: false` with the messages in
 * `logs` — mirroring {@link build}.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const outdir = resolve(options.outdir ?? "dist");
  const pages: string[] = [];
  try {
    const entryPath = resolve(options.entry);
    const mod = (await import(entryPath)) as { default?: SSGConfig };
    const config = (mod.default ?? (mod as unknown as SSGConfig)) as SSGConfig;
    if (typeof config.render !== "function") {
      return {
        success: false,
        pages: [],
        logs: ["kanabun: SSG entry must export a config with a `render(path)` function."],
      };
    }
    const routes = config.routes ?? ["/"];
    const title = config.title ?? "kanabun";

    // Bundle the client entry once (if any) so every page can reference it.
    let script = "";
    if (config.client !== undefined) {
      const clientEntry = resolve(dirname(entryPath), config.client);
      // A failed client build (syntax error, unresolved import) makes `Bun.build`
      // throw an `AggregateError`, which the outer `catch` unpacks via
      // `errorMessages` — the same path `build()` relies on. So success here
      // means the bundle is written; take the entry chunk as the script src.
      const built = await Bun.build({
        entrypoints: [clientEntry],
        outdir,
        target: "browser",
        minify: options.minify ?? true,
      });
      const out = built.outputs[0]!;
      script = `<script type="module" src="/${relative(outdir, out.path)}"></script>`;
    }

    const written = new Set<string>();
    for (const path of routes) {
      const file = join(outdir, routeToFile(path));
      // Keep every page inside `outdir` — a route like `/../x` must not write
      // above it. (Routes are build-time config, so this is a guardrail, not a
      // trust boundary.)
      const rel = relative(outdir, file);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return {
          success: false,
          pages,
          logs: [`kanabun: route ${JSON.stringify(path)} escapes the output directory.`],
        };
      }
      // Distinct routes that map to the same file (e.g. a duplicate, or `/a` and
      // `/a/`) render once — so `pages` reflects the files actually written.
      if (written.has(file)) continue;
      written.add(file);

      const { html, head } = renderToString(() => config.render(path));
      const ctx: DocumentContext = { html, head, path, script };
      const page = config.document ? config.document(ctx) : defaultDocument(ctx, title);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, page);
      pages.push(file);
    }
    return { success: true, pages, logs: [] };
  } catch (error) {
    return { success: false, pages, logs: errorMessages(error) };
  }
}
