import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createSSRHandler, defaultPort, serve, serveFile } from "./serve";

const root = resolve(import.meta.dir, "../../..");
const ssrDir = resolve(root, "examples/ssr");
const islandsDir = resolve(root, "examples/islands");

/** Run the handler against a pathname on a nominal host. */
function get(
  handler: (req: Request) => Promise<Response>,
  pathname: string,
): Promise<Response> {
  return handler(new Request(`http://localhost${pathname}`));
}

describe("createSSRHandler", () => {
  test("renders any path through the default document (no client → no script)", async () => {
    const handler = await createSSRHandler({
      render: (path) => `path is ${path}`,
      title: "ssr test",
    });
    const res = await get(handler, "/about/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain("<title>ssr test</title>");
    expect(page).toContain("path is /about/");
    expect(page).not.toContain("<script");
  });

  test("bundles a client once and serves it; the document references it", async () => {
    const handler = await createSSRHandler(
      { render: () => "x", client: "./main.tsx" },
      { dir: ssrDir, minify: false },
    );
    const page = await (await get(handler, "/")).text();
    expect(page).toContain('<script type="module" src="/main.js"></script>');
    const js = await get(handler, "/main.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await js.text()).toContain("hydrate");
  });

  test("collects scoped CSS emitted during the render into head", async () => {
    // `css` runs inside `render` (not at module scope — a module-level style
    // would stay in core's `pending` registry for the rest of the test process
    // and leak into every later `renderToString`).
    const { css } = await import("@kanabun/core");
    const handler = await createSSRHandler({
      render: () => {
        const cls = css`color: rebeccapurple;`;
        return `<span class="${cls}">x</span>`;
      },
    });
    const page = await (await get(handler, "/")).text();
    expect(page).toMatch(/<style data-k="[a-z0-9]+">/);
    expect(page).toContain("rebeccapurple");
  });

  test("a --base prefixes the bundle path and stays serveable", async () => {
    const handler = await createSSRHandler(
      { render: () => "x", client: "./main.tsx" },
      { dir: ssrDir, minify: false, base: "repo" },
    );
    const page = await (await get(handler, "/")).text();
    expect(page).toContain('src="/repo/main.js"');
    expect((await get(handler, "/repo/main.js")).status).toBe(200);
  });

  test("islands mode serves the bootstrap and per-island chunks", async () => {
    const handler = await createSSRHandler(
      {
        render: () => "shell",
        islands: { Counter: "./counter.tsx", Clock: "./clock.tsx" },
      },
      { dir: islandsDir, minify: false },
    );
    const page = await (await get(handler, "/")).text();
    expect(page).toContain('<script type="module" src="/islands.js"></script>');
    expect(await (await get(handler, "/islands.js")).text()).toContain(
      "hydrateIslandsLazy",
    );
    expect((await get(handler, "/counter.js")).status).toBe(200);
    expect((await get(handler, "/clock.js")).status).toBe(200);
    // Chunk requests are confined to the build dir; a missing chunk 404s.
    // (`%2f` because the URL parser would resolve a literal `/../` itself.)
    expect((await get(handler, "/..%2fescape.js")).status).toBe(403);
    expect((await get(handler, "/missing.js")).status).toBe(404);
  });

  test("islands chunks are served under a base prefix", async () => {
    const handler = await createSSRHandler(
      { render: () => "shell", islands: { Counter: "./counter.tsx" } },
      { dir: islandsDir, minify: false, base: "/sub/" },
    );
    const page = await (await get(handler, "/")).text();
    expect(page).toContain('src="/sub/islands.js"');
    expect((await get(handler, "/sub/islands.js")).status).toBe(200);
  });

  test("a malformed percent-escape is a 404, not a crash", async () => {
    const handler = await createSSRHandler({ render: () => "x" });
    expect((await get(handler, "/%ZZ")).status).toBe(404);
  });

  test("honours a custom document", async () => {
    const handler = await createSSRHandler({
      render: (p) => `body@${p}`,
      document: (ctx) => `DOC:${ctx.path}:${ctx.html}:${ctx.base}`,
    });
    expect(await (await get(handler, "/x")).text()).toBe("DOC:/x:body@/x:/");
  });

  test("rejects a config without a render function", async () => {
    await expect(
      createSSRHandler({} as never),
    ).rejects.toThrow(/render\(path\)/);
  });

  test("rejects a config with both client and islands", async () => {
    await expect(
      createSSRHandler(
        { render: () => "x", client: "./main.tsx", islands: {} },
        { dir: ssrDir },
      ),
    ).rejects.toThrow(/not both/);
  });

  test("a failing client bundle throws with the diagnostics", async () => {
    await expect(
      createSSRHandler(
        { render: () => "x", client: "./does-not-exist.tsx" },
        { dir: ssrDir },
      ),
    ).rejects.toThrow(/client bundle failed/);
  });

  test("a failing islands build throws with the diagnostics", async () => {
    await expect(
      createSSRHandler({ render: () => "x", islands: {} }, { dir: islandsDir }),
    ).rejects.toThrow(/islands build failed/);
  });
});

describe("serveFile", () => {
  test("serves an existing file and 403s/404s the rest", async () => {
    expect((await serveFile(ssrDir, "/app.tsx")).status).toBe(200);
    expect((await serveFile(ssrDir, "/../ssg/app.tsx")).status).toBe(403);
    expect((await serveFile(ssrDir, "/nope.txt")).status).toBe(404);
  });
});

describe("defaultPort", () => {
  test("prefers a numeric $PORT, falling back otherwise", () => {
    expect(defaultPort("3111")).toBe(3111);
    expect(defaultPort(undefined)).toBe(3000);
    expect(defaultPort("abc")).toBe(3000);
    expect(defaultPort(undefined, 3020)).toBe(3020);
  });
});

describe("serve", () => {
  test("starts a stoppable server that renders over HTTP", async () => {
    const server = await serve(
      { render: (p) => `served ${p}`, title: "over http" },
      { port: 0 },
    );
    try {
      expect(server.port).toBeGreaterThan(0);
      const page = await (await fetch(`${server.url}hello`)).text();
      expect(page).toContain("served /hello");
      expect(page).toContain("<title>over http</title>");
    } finally {
      server.stop();
    }
  });
});
