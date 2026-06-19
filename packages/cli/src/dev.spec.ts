import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { changeMessage, createDevHandler, dev, swapCss, type DevServer } from "./dev";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

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
  // A symlinked *directory* inside root that points outside it.
  await mkdir(join(fixture, "outside-dir"), { recursive: true });
  await writeFile(join(fixture, "outside-dir", "deep.txt"), `DEEPSECRET`);
  await symlink(join(fixture, "outside-dir"), join(site, "symdir"));
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
    expect(body).toContain("function swapCss"); // the CSS hot-swap client runtime, serialised in
    expect(body).toContain("</body>");
  });

  test("also serves /index.html", async () => {
    const res = await handler()(new Request("http://localhost/index.html"));
    expect(await res.text()).toContain("__kanabun_livereload");
  });

  test("enables core dev warnings via the injected dev flag", async () => {
    const res = await handler()(new Request("http://localhost/"));
    expect(await res.text()).toContain("globalThis.__KANABUN_DEV__ = true");
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

  test("404s for a malformed percent-escape instead of throwing a URIError", async () => {
    const h = handler();
    for (const path of ["/%ZZ", "/%", "/a%2"]) {
      const res = await h(new Request(`http://localhost${path}`));
      expect(res.status).toBe(404);
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

  test("rejects a request through a symlinked directory that escapes the root", async () => {
    const res = await handler()(new Request("http://localhost/symdir/deep.txt"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("DEEPSECRET");
  });
});

describe("swapCss (client css hot-swap)", () => {
  // A minimal fake matching swapCss's structural DOM shapes.
  interface FakeLink {
    href: string;
    nextSibling: unknown;
    removed: boolean;
    listeners: Record<string, () => void>;
    parentNode: {
      inserted: { node: FakeLink; ref: unknown }[];
      insertBefore(node: FakeLink, ref: unknown): void;
    };
    cloneNode(): FakeLink;
    addEventListener(type: "load" | "error", fn: () => void): void;
    remove(): void;
  }
  function fakeLink(href: string): FakeLink {
    const listeners: Record<string, () => void> = {};
    const link: FakeLink = {
      href,
      nextSibling: { tag: "sibling" },
      removed: false,
      listeners,
      parentNode: {
        inserted: [],
        insertBefore(node, ref) {
          this.inserted.push({ node, ref });
        },
      },
      cloneNode: () => fakeLink(href),
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
      remove() {
        link.removed = true;
      },
    };
    return link;
  }
  const docOf = (links: FakeLink[]) => ({ querySelectorAll: () => links });
  const locOf = () => {
    const loc = { href: "http://localhost/", reloaded: false, reload() {} };
    loc.reload = () => {
      loc.reloaded = true;
    };
    return loc;
  };

  test("swaps a matching stylesheet (cache-busted) and removes the old one on load", () => {
    const old = fakeLink("http://localhost/styles.css");
    const loc = locOf();
    swapCss(docOf([old]), loc, "/styles.css");

    expect(loc.reloaded).toBe(false);
    expect(old.parentNode.inserted).toHaveLength(1);
    const clone = old.parentNode.inserted[0]!.node;
    expect(clone.href).toContain("/styles.css");
    expect(clone.href).toContain("k-hmr="); // cache-busting query
    // The old link is removed only once its replacement finishes loading.
    expect(old.removed).toBe(false);
    clone.listeners.load!();
    expect(old.removed).toBe(true);
  });

  test("removes the old link if the replacement errors instead of loading", () => {
    const old = fakeLink("http://localhost/styles.css");
    swapCss(docOf([old]), locOf(), "/styles.css");
    const clone = old.parentNode.inserted[0]!.node;
    clone.listeners.error!();
    expect(old.removed).toBe(true);
  });

  test("reloads when present stylesheets don't match the changed path", () => {
    const other = fakeLink("http://localhost/other.css");
    const loc = locOf();
    swapCss(docOf([other]), loc, "/styles.css");
    expect(other.parentNode.inserted).toHaveLength(0);
    expect(loc.reloaded).toBe(true);
  });
});

describe("changeMessage", () => {
  test("hot-swaps a .css change instead of reloading", () => {
    expect(changeMessage("styles.css")).toBe("css:/styles.css");
    expect(changeMessage(["sub", "theme.CSS"].join(sep))).toBe("css:/sub/theme.CSS");
  });

  test("reloads for non-CSS changes or a missing filename", () => {
    expect(changeMessage("main.tsx")).toBe("reload");
    expect(changeMessage("notes.txt")).toBe("reload");
    expect(changeMessage(null)).toBe("reload");
    expect(changeMessage(undefined)).toBe("reload");
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

  test("pushes a targeted css hot-swap over the websocket when a .css file changes", async () => {
    server = dev({ entry: htmlPath, port: 0 });
    const ws = new WebSocket(`${server.url.replace("http", "ws")}__kanabun_livereload`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws failed to open"));
    });

    const update = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(String(e.data));
    });
    await writeFile(join(site, "styles.css"), `body { color: blue; }`);
    const message = await Promise.race([
      update,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("no css update within 3s")), 3000),
      ),
    ]);
    expect(message).toBe("css:/styles.css");
    ws.close();
  });
});
