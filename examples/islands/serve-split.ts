/**
 * The per-island split, end to end. It:
 *   1. code-splits the islands (`buildIslands`) into per-island chunks + a
 *      bootstrap, then
 *   2. SSR-renders the page (`renderToString`) and injects the bootstrap script,
 *      and serves the page plus the built chunks statically.
 *
 *     bun examples/islands/serve-split.ts   # http://localhost:3020
 *
 * Open the network tab: the static shell loads `islands.js`, which pulls in only
 * the chunks for the islands on the page (here `counter.js` and `clock.js`) — an
 * island registered but absent would never be fetched. Compare with `server.tsx`,
 * which ships one bundle with every island's code.
 *
 * Bun-only (build + static server) — outside `packages/core`, like the other
 * example harnesses.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { renderToString } from "@kanabun/core";
import { buildIslands } from "@kanabun/cli";
import { App } from "./app";

const PORT = Number(process.env.PORT) || 3020;
const here = new URL(".", import.meta.url).pathname;
const outdir = await mkdtemp(join(tmpdir(), "kanabun-islands-preview-"));

const built = await buildIslands({
  islands: {
    Counter: join(here, "counter.tsx"),
    Clock: join(here, "clock.tsx"),
  },
  outdir,
  minify: false,
});
if (!built.success) {
  console.error(`kanabun: islands build failed:\n${built.logs.join("\n")}`);
  process.exit(1);
}

function page(html: string, head: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8" />\n<title>kanabun islands (split)</title>\n${head}\n` +
    `</head>\n<body>\n<div id="app">${html}</div>\n${built.script}\n` +
    `</body>\n</html>\n`
  );
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/") {
      const { html, head } = renderToString(() => App());
      return new Response(page(html, head), {
        headers: { "content-type": "text/html" },
      });
    }
    // Serve the built chunks, kept inside the build dir.
    const filePath = join(outdir, pathname);
    const rel = relative(outdir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return new Response("Forbidden", { status: 403 });
    }
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`islands split preview on http://localhost:${PORT} (chunks in ${outdir})`);
