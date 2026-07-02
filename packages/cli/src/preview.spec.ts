import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { preview } from "./preview";

const root = resolve(import.meta.dir, "../../..");
const entry = resolve(root, "examples/ssg/ssg.tsx");
const outdir = resolve(import.meta.dir, "../.tmp-preview-test");

afterAll(async () => {
  await rm(outdir, { recursive: true, force: true });
});

describe("preview", () => {
  test("builds the SSG entry and serves it statically", async () => {
    const server = await preview({ entry, port: 0, minify: false });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(existsSync(join(server.outdir, "index.html"))).toBe(true);

      const index = await (await fetch(`${server.url}`)).text();
      expect(index).toContain("<title>kanabun SSG</title>");
      // Directory paths fall back to their index.html.
      const about = await (await fetch(`${server.url}about/`)).text();
      expect(about).toContain("renderToString");
      // The client bundle is served next to the pages.
      expect((await fetch(`${server.url}main.js`)).status).toBe(200);

      expect((await fetch(`${server.url}missing.txt`)).status).toBe(404);
      expect((await fetch(`${server.url}%ZZ`)).status).toBe(404);
      // Requests are confined to the build dir.
      const forbidden = await fetch(`${server.url}..%2fsecret`);
      expect(forbidden.status).toBe(403);
    } finally {
      server.stop();
    }
  });

  test("honours an explicit outdir", async () => {
    const server = await preview({ entry, port: 0, minify: false, outdir });
    try {
      expect(server.outdir).toBe(outdir);
      expect(existsSync(join(outdir, "about/index.html"))).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("throws (and starts no server) when the build fails", async () => {
    await expect(
      preview({ entry: join(outdir, "missing.tsx"), port: 0 }),
    ).rejects.toThrow(/SSG build failed/);
  });
});
