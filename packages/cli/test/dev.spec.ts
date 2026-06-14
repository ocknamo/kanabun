import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { createDevHandler, dev, type DevServer } from "../src/dev";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixture: string;
let site: string; // the served root, nested so a sibling "secret" is outside it
let htmlPath: string;

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), "kanabun-dev-"));
  site = join(fixture, "site");
  await mkdir(site, { recursive: true });
  htmlPath = join(site, "index.html");
  await writeFile(
    htmlPath,
    `<!doctype html><html><body><div id="app"></div><script type="module" src="./main.tsx"></script></body></html>`,
  );
  await writeFile(join(site, "main.tsx"), `export const greeting = "hello";`);
  await writeFile(join(site, "styles.css"), `body { color: red; }`);
  await writeFile(join(site, "notes.txt"), `just text`);
  // A secret OUTSIDE the served root, to test path-traversal containment.
  await writeFile(join(fixture, "secret.txt"), `TOPSECRET`);
  await writeFile(join(fixture, "outside.tsx"), `export const x = "OUTSIDE";`);
  // Symlinks that live INSIDE the root but point outside it.
  await symlink(join(fixture, "secret.txt"), join(site, "leak.txt"));
  await symlink(join(fixture, "outside.tsx"), join(site, "evil.tsx"));
});
afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe("createDevHandler", () => {
  const handler = () => createDevHandler({ htmlPath, root: site });

  test("serves the HTML entry with the live-reload snippet injected", async () => {
    const res = await handler()(new Request("http://localhost/"));
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("__kanabun_livereload");
    expect(body).toContain("</body>");
  });

  test("also serves /index.html", async () => {
    const res = await handler()(new Request("http://localhost/index.html"));
    expect(await res.text()).toContain("__kanabun_livereload");
  });

  test("bundles a module request to browser JS", async () => {
    const res = await handler()(new Request("http://localhost/main.tsx"));
    expect(res.headers.get("content-type")).toContain("javascript");
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test("returns an error script when a module fails to build", async () => {
    const res = await handler()(new Request("http://localhost/missing.tsx"));
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("build error");
  });

  test("serves static files with a known content-type", async () => {
    const res = await handler()(new Request("http://localhost/styles.css"));
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(await res.text()).toContain("color: red");
  });

  test("serves static files with an unknown extension (no content-type)", async () => {
    const res = await handler()(new Request("http://localhost/notes.txt"));
    expect(await res.text()).toBe("just text");
  });

  test("404s for missing files", async () => {
    const res = await handler()(new Request("http://localhost/nope.png"));
    expect(res.status).toBe(404);
  });

  test("rejects path traversal across encodings without leaking files", async () => {
    const h = handler();
    const vectors = [
      "/..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
      "/..%2F..%2Fsecret.txt",
      "/sub/..%2f..%2fsecret.txt",
    ];
    for (const path of vectors) {
      const res = await h(new Request(`http://localhost${path}`));
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("TOPSECRET");
    }
  });

  test("rejects a symlink that escapes the root (static file)", async () => {
    const res = await handler()(new Request("http://localhost/leak.txt"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("TOPSECRET");
  });

  test("rejects a symlink that escapes the root (module)", async () => {
    const res = await handler()(new Request("http://localhost/evil.tsx"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("OUTSIDE");
  });
});

describe("dev server", () => {
  let server: DevServer | undefined;
  afterEach(() => server?.stop());

  test("starts on an ephemeral port and serves HTML + bundled JS", async () => {
    server = dev({ entry: htmlPath, port: 0 });
    expect(server.port).toBeGreaterThan(0);

    const html = await (await fetch(server.url)).text();
    expect(html).toContain("__kanabun_livereload");

    const js = await fetch(`${server.url}main.tsx`);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await js.text()).length).toBeGreaterThan(0);
  });

  test("rejects a non-websocket request to the live-reload path", async () => {
    server = dev({ entry: htmlPath, port: 0 });
    const res = await fetch(`${server.url}__kanabun_livereload`);
    expect(res.status).toBe(400);
  });

  test("pushes a reload over the websocket when a file changes", async () => {
    server = dev({ entry: htmlPath, port: 0 });
    const ws = new WebSocket(`${server.url.replace("http", "ws")}__kanabun_livereload`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws failed to open"));
    });
    ws.send("ping"); // exercises the server's message handler

    const reload = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(String(e.data));
    });
    await writeFile(join(site, "main.tsx"), `export const greeting = "changed";`);
    const message = await Promise.race([
      reload,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("no reload within 3s")), 3000),
      ),
    ]);
    expect(message).toBe("reload");
    ws.close();
  });
});
