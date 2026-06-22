import { describe, expect, test, afterAll } from "bun:test";
import { buildIslands } from "./islands";
import { rm, readFile, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const outdir = resolve(import.meta.dir, "../.tmp-islands-test");
const exampleDir = resolve(root, "examples/islands");
const entries = {
  Counter: resolve(exampleDir, "counter.tsx"),
  Clock: resolve(exampleDir, "clock.tsx"),
};

afterAll(async () => {
  await rm(outdir, { recursive: true, force: true });
});

describe("buildIslands", () => {
  test("code-splits each island and emits a lazy bootstrap", async () => {
    const out = resolve(outdir, "split");
    const result = await buildIslands({ islands: entries, outdir: out, minify: false });
    expect(result.success).toBe(true);
    expect(result.logs).toEqual([]);

    // The page references the generated bootstrap (default base `/`).
    expect(result.script).toBe('<script type="module" src="/islands.js"></script>');

    // A distinct chunk per island, plus the bootstrap + runtime.
    const names = result.outputs.map((p) => basename(p));
    expect(names).toContain("islands.js");
    expect(names).toContain("counter.js");
    expect(names).toContain("clock.js");
    expect(names).toContain("kanabun-islands-runtime.js");

    // The bootstrap dynamically imports each island (so only present ones load).
    const bootstrap = await readFile(resolve(out, "islands.js"), "utf8");
    expect(bootstrap).toContain('() => import("./counter.js")');
    expect(bootstrap).toContain('() => import("./clock.js")');
    expect(bootstrap).toContain("hydrateIslandsLazy");

    // Each island chunk default-exports its component (so the lazy import works).
    expect(await readFile(resolve(out, "counter.js"), "utf8")).toMatch(/export\s*\{[^}]*\bas default\b|export default/);
  });

  test("fails when two island entries share a file basename", async () => {
    // The basename guard runs before any build, so the second path needn't exist.
    const result = await buildIslands({
      islands: {
        Counter: entries.Counter,
        Other: resolve(exampleDir, "../elsewhere/counter.tsx"), // same basename "counter"
      },
      outdir: resolve(outdir, "collide"),
    });
    expect(result.success).toBe(false);
    expect(result.logs.join("\n")).toMatch(/distinct file names/);
  });

  test("prefixes the bootstrap src with a normalized base", async () => {
    const out = resolve(outdir, "based");
    const result = await buildIslands({
      islands: { Counter: entries.Counter },
      outdir: out,
      minify: false,
      base: "repo", // missing slashes → normalized to "/repo/"
    });
    expect(result.success).toBe(true);
    expect(result.script).toBe('<script type="module" src="/repo/islands.js"></script>');
  });

  test("removes the temporary bootstrap directory after building", async () => {
    const out = resolve(outdir, "cleanup");
    await buildIslands({ islands: { Counter: entries.Counter }, outdir: out, minify: false });
    const leftovers = (await readdir(exampleDir)).filter((n) =>
      n.startsWith(".kanabun-islands-"),
    );
    expect(leftovers).toEqual([]);
  });

  test("fails when no islands are given", async () => {
    const result = await buildIslands({ islands: {}, outdir: resolve(outdir, "empty") });
    expect(result.success).toBe(false);
    expect(result.script).toBe("");
    expect(result.logs.join("\n")).toMatch(/at least one island/);
  });

  test("reports failure (with logs) when an island entry won't resolve", async () => {
    const result = await buildIslands({
      islands: { Nope: resolve(exampleDir, "does-not-exist.tsx") },
      outdir: resolve(outdir, "bad"),
    });
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });
});
