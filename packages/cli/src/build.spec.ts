import { describe, expect, test, afterAll } from "bun:test";
import { build } from "./build";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const outdir = resolve(import.meta.dir, "../.tmp-build-test");

afterAll(async () => {
  await rm(outdir, { recursive: true, force: true });
});

describe("build", () => {
  test("bundles a TSX entry for the browser", async () => {
    const result = await build({
      entry: resolve(root, "examples/counter/main.tsx"),
      outdir,
      minify: false,
    });
    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
    expect(result.outputs.some((p) => p.endsWith(".js"))).toBe(true);
    expect(existsSync(result.outputs[0]!)).toBe(true);
  });

  test("emits a linked sourcemap by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-build-map-"));
    try {
      const result = await build({
        entry: resolve(root, "examples/counter/main.tsx"),
        outdir: dir,
        minify: false,
      });
      expect(result.success).toBe(true);
      expect(result.outputs.some((p) => p.endsWith(".js.map"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('sourcemap: "none" emits no sourcemap', async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-build-nomap-"));
    try {
      const result = await build({
        entry: resolve(root, "examples/counter/main.tsx"),
        outdir: dir,
        minify: false,
        sourcemap: "none",
      });
      expect(result.success).toBe(true);
      expect(result.outputs.some((p) => p.endsWith(".js.map"))).toBe(false);
      const bundle = result.outputs.find((p) => p.endsWith(".js"))!;
      expect(await Bun.file(bundle).text()).not.toContain("sourceMappingURL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports failure (and logs) for an unresolvable entry", async () => {
    const result = await build({
      entry: resolve(root, "examples/counter/does-not-exist.tsx"),
      outdir,
    });
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("reports failure with logs for a resolvable file that won't compile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-build-bad-"));
    try {
      const bad = join(dir, "bad.tsx");
      await writeFile(bad, "export const x: number = ;\n"); // syntax error
      const result = await build({ entry: bad, outdir: join(dir, "dist") });
      expect(result.success).toBe(false);
      expect(result.logs.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("surfaces the real diagnostic for an unresolved import (not just 'Bundle failed')", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-build-unres-"));
    try {
      const entry = join(dir, "m.tsx");
      await writeFile(entry, `import "totally-not-a-real-pkg-xyz";\nexport const x = 1;\n`);
      const result = await build({ entry, outdir: join(dir, "dist") });
      expect(result.success).toBe(false);
      expect(result.logs.join("\n")).toMatch(/resolve|totally-not-a-real-pkg-xyz/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
