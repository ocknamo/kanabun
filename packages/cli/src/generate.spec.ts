import { describe, expect, test, afterAll } from "bun:test";
import { generate } from "./generate";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const outdir = resolve(import.meta.dir, "../.tmp-generate-test");
// Config fixtures return plain strings (no `@kanabun/core` import), so they can
// live in an OS tmpdir — outside the repo, so coverage never scans them. (The
// end-to-end test below uses the real `examples/ssg`, which does import core.)
const fixturesP = mkdtemp(join(tmpdir(), "kanabun-generate-fix-"));

afterAll(async () => {
  await rm(outdir, { recursive: true, force: true });
  await rm(await fixturesP, { recursive: true, force: true });
});

/** Write a config module to the tmp fixtures dir and return its absolute path. */
async function fixture(name: string, source: string): Promise<string> {
  const path = join(await fixturesP, name);
  await writeFile(path, source);
  return path;
}

describe("generate", () => {
  test("prerenders the ssg example (markup, scoped CSS, client bundle)", async () => {
    const out = join(outdir, "example");
    const result = await generate({
      entry: resolve(root, "examples/ssg/ssg.tsx"),
      outdir: out,
      minify: false,
    });
    expect(result.success).toBe(true);
    expect(result.pages.length).toBe(2);

    const index = await readFile(join(out, "index.html"), "utf8");
    const about = await readFile(join(out, "about/index.html"), "utf8");
    // App markup made it in, route-specific content differs per page.
    expect(index).toContain("<title>kanabun SSG</title>");
    expect(index).toContain("kanabun generate");
    expect(about).toContain("renderToString");
    // Scoped CSS collected into <head>, client bundle referenced + written.
    expect(index).toContain("<style data-k=");
    expect(index).toContain('<script type="module" src="/main.js">');
    expect(existsSync(join(out, "main.js"))).toBe(true);
  });

  test("defaults to a single `/` route and the built-in document", async () => {
    const entry = await fixture(
      "single.ts",
      `export default { render: (p) => "path is " + p };\n`,
    );
    const out = join(outdir, "single");
    const result = await generate({ entry, outdir: out });
    expect(result.success).toBe(true);
    expect(result.pages.length).toBe(1);
    const html = await readFile(join(out, "index.html"), "utf8");
    expect(html).toContain("<title>kanabun</title>"); // default title
    expect(html).toContain("path is /");
    expect(html).not.toContain("<script"); // no client → static only
  });

  test("accepts a config exported directly (no default export)", async () => {
    const entry = await fixture(
      "named.ts",
      `export const render = (p) => "named " + p;\nexport const routes = ["/x"];\n`,
    );
    const out = join(outdir, "named");
    const result = await generate({ entry, outdir: out });
    expect(result.success).toBe(true);
    expect(await readFile(join(out, "x/index.html"), "utf8")).toContain("named /x");
  });

  test("writes nested index.html per route and honours a custom document", async () => {
    const entry = await fixture(
      "custom.ts",
      `export default {
        routes: ["/", "/blog/post/"],
        document: (ctx) => "DOC:" + ctx.path + ":" + ctx.html,
        render: (p) => "body@" + p,
      };\n`,
    );
    const out = join(outdir, "custom");
    const result = await generate({ entry, outdir: out });
    expect(result.success).toBe(true);
    expect(await readFile(join(out, "index.html"), "utf8")).toBe("DOC:/:body@/");
    expect(await readFile(join(out, "blog/post/index.html"), "utf8")).toBe(
      "DOC:/blog/post/:body@/blog/post/",
    );
  });

  test("renders routes mapping to the same file once (pages reflects files written)", async () => {
    const entry = await fixture(
      "dupes.ts",
      `export default { routes: ["/", "/", "/a", "/a/"], render: (p) => "x" };\n`,
    );
    const out = join(outdir, "dupes");
    const result = await generate({ entry, outdir: out });
    expect(result.success).toBe(true);
    // "/" + "/" collapse to one, "/a" + "/a/" collapse to one → 2 unique files.
    expect(result.pages.length).toBe(2);
    expect(new Set(result.pages).size).toBe(2);
  });

  test("refuses a route that escapes the output directory", async () => {
    const entry = await fixture(
      "escape.ts",
      `export default { routes: ["/../evil"], render: (p) => "x" };\n`,
    );
    const result = await generate({ entry, outdir: join(outdir, "escape") });
    expect(result.success).toBe(false);
    expect(result.logs.join("\n")).toMatch(/escapes the output directory/);
  });

  test("reports failure when the config has no render function", async () => {
    const entry = await fixture("norender.ts", `export default { routes: ["/"] };\n`);
    const result = await generate({ entry, outdir: join(outdir, "norender") });
    expect(result.success).toBe(false);
    expect(result.logs.join("\n")).toMatch(/render/);
  });

  test("reports failure (with logs) when the client bundle won't build", async () => {
    const entry = await fixture(
      "badclient.ts",
      `export default { client: "./does-not-exist.tsx", render: () => "x" };\n`,
    );
    const result = await generate({ entry, outdir: join(outdir, "badclient") });
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("reports failure (success: false) when the client resolves but won't compile", async () => {
    await fixture("badsyntax.tsx", "export const x: number = ;\n"); // syntax error
    const entry = await fixture(
      "compileclient.ts",
      `export default { client: "./badsyntax.tsx", render: () => "x" };\n`,
    );
    const result = await generate({ entry, outdir: join(outdir, "compileclient") });
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("reports failure when the entry module cannot be imported", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-generate-"));
    try {
      const result = await generate({
        entry: join(dir, "nope.ts"),
        outdir: join(dir, "out"),
      });
      expect(result.success).toBe(false);
      expect(result.logs.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports failure when a route's render throws", async () => {
    const entry = await fixture(
      "throws.ts",
      `export default { render: () => { throw new Error("boom"); } };\n`,
    );
    const result = await generate({ entry, outdir: join(outdir, "throws") });
    expect(result.success).toBe(false);
    expect(result.logs.join("\n")).toMatch(/boom/);
  });
});
