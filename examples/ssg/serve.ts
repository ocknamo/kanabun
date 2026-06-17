/**
 * Build the SSG output (`generate`) and serve it statically — a preview you can
 * open, and the harness the visual-regression lane points at. Unlike the SSR
 * example (which renders per request), the pages here are prebuilt to `.html`
 * by `kanabun generate` and then just served as static files.
 *
 *     bun examples/ssg/serve.ts   # http://localhost:3103
 *
 * Bun-only (build + static file server) — outside `packages/core`, like the
 * other example harnesses.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { generate } from "@kanabun/cli";

const PORT = Number(process.env.PORT) || 3103;
const entry = new URL("./ssg.tsx", import.meta.url).pathname;
const outdir = await mkdtemp(join(tmpdir(), "kanabun-ssg-preview-"));

const result = await generate({ entry, outdir, minify: false });
if (!result.success) {
  console.error(`kanabun: SSG build failed:\n${result.logs.join("\n")}`);
  process.exit(1);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    let pathname = new URL(req.url).pathname;
    if (pathname.endsWith("/")) pathname += "index.html";
    // Keep requests inside the build dir — `join` normalizes any `..`, then we
    // confirm the result stays under `outdir` before reading it.
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

console.log(`SSG preview on http://localhost:${PORT} (built to ${outdir})`);
