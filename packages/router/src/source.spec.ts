import { describe, expect, test, afterEach } from "bun:test";
import {
  createMemorySource,
  createBrowserSource,
  createHashSource,
  parsePath,
  type WindowLike,
} from "./index";

describe("memory source", () => {
  test("push/replace update the location silently", () => {
    const src = createMemorySource("/");
    expect(src.location()).toBe("/");
    src.push("/a");
    expect(src.location()).toBe("/a");
    src.replace("/b");
    expect(src.location()).toBe("/b");
  });

  test("only `go` notifies subscribers; unsubscribe stops it", () => {
    const src = createMemorySource("/");
    let count = 0;
    const off = src.subscribe(() => count++);

    src.push("/a"); // silent
    expect(count).toBe(0);

    src.go("/b"); // simulates back/forward
    expect(count).toBe(1);
    expect(src.location()).toBe("/b");

    off();
    src.go("/c");
    expect(count).toBe(1); // no longer notified
    expect(src.location()).toBe("/c");
  });
});

// A structural stand-in for `window`, backed by an in-memory URL.
function fakeWindow(initial = "/"): WindowLike & { popstate(): void } {
  let url = new URL(initial, "http://x");
  const listeners = new Set<() => void>();
  return {
    history: {
      pushState: (_state, _unused, to) => {
        url = new URL(to, "http://x");
      },
      replaceState: (_state, _unused, to) => {
        url = new URL(to, "http://x");
      },
    },
    location: {
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      get hash() {
        return url.hash;
      },
    },
    addEventListener: (_type, callback) => {
      listeners.add(callback);
    },
    removeEventListener: (_type, callback) => {
      listeners.delete(callback);
    },
    popstate() {
      for (const cb of [...listeners]) cb();
    },
  };
}

describe("browser source", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("reads location and pushes/replaces through history", () => {
    const win = fakeWindow("/start");
    const src = createBrowserSource(win);
    expect(src.location()).toBe("/start");

    src.push("/next?x=1#h");
    expect(src.location()).toBe("/next?x=1#h");

    src.replace("/final");
    expect(src.location()).toBe("/final");
  });

  test("subscribe wires popstate; unsubscribe removes it", () => {
    const win = fakeWindow("/");
    const src = createBrowserSource(win);
    let count = 0;
    const off = src.subscribe(() => count++);
    win.popstate();
    expect(count).toBe(1);
    off();
    win.popstate();
    expect(count).toBe(1);
  });

  test("defaults to the global `window`", () => {
    const win = fakeWindow("/home");
    (globalThis as { window?: unknown }).window = win;
    const src = createBrowserSource();
    expect(src.location()).toBe("/home");
  });

  test("throws when no `window` is available", () => {
    expect(() => createBrowserSource()).toThrow(/no `window`/);
  });
});

// A window stand-in whose location lives entirely in the hash. Setting
// `location.hash` updates it; `hashchange()` fires the registered listeners.
function fakeHashWindow(initialHash = ""): WindowLike & { hashchange(): void } {
  let url = new URL("http://x/" + initialHash);
  const listeners = new Set<() => void>();
  return {
    history: {
      pushState: (_state, _unused, to) => {
        url = new URL(to, url);
      },
      replaceState: (_state, _unused, to) => {
        url = new URL(to, url);
      },
    },
    location: {
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      get hash() {
        return url.hash;
      },
      set hash(value: string) {
        url.hash = value;
      },
    },
    addEventListener: (_type, callback) => {
      listeners.add(callback);
    },
    removeEventListener: (_type, callback) => {
      listeners.delete(callback);
    },
    hashchange() {
      for (const cb of [...listeners]) cb();
    },
  };
}

describe("hash source", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("reads the path from the location hash (defaults to /)", () => {
    expect(createHashSource(fakeHashWindow()).location()).toBe("/");
    expect(createHashSource(fakeHashWindow("#/users/1")).location()).toBe("/users/1");
  });

  test("push writes the hash; replace swaps it via replaceState", () => {
    const win = fakeHashWindow("#/");
    const src = createHashSource(win);
    src.push("/a");
    expect(src.location()).toBe("/a");
    src.replace("/b?x=1"); // query stays inside the fragment
    expect(src.location()).toBe("/b?x=1");
    // The underlying hash must carry a single leading "#" (no `"#" + to` doubling).
    expect(win.location.hash).toBe("#/b?x=1");
  });

  test("a fragment query parses back into pathname + search", () => {
    const win = fakeHashWindow("#/");
    const src = createHashSource(win);
    src.push("/b?x=1&y=2");
    const loc = parsePath(src.location());
    expect(loc.pathname).toBe("/b");
    expect(loc.search).toBe("?x=1&y=2");
    expect(loc.query).toEqual({ x: "1", y: "2" });
  });

  test("empty and slash-less hashes resolve sensibly", () => {
    expect(createHashSource(fakeHashWindow("#")).location()).toBe("/"); // bare "#"
    // A hash without a leading slash still matches (segments ignore it).
    const win = fakeHashWindow();
    const src = createHashSource(win);
    src.push("about");
    expect(src.location()).toBe("about");
    expect(parsePath(src.location()).pathname).toBe("/about");
  });

  test("subscribe wires hashchange; unsubscribe removes it", () => {
    const win = fakeHashWindow();
    const src = createHashSource(win);
    let count = 0;
    const off = src.subscribe(() => count++);
    win.hashchange();
    expect(count).toBe(1);
    off();
    win.hashchange();
    expect(count).toBe(1);
  });

  test("defaults to the global `window`", () => {
    (globalThis as { window?: unknown }).window = fakeHashWindow("#/home");
    expect(createHashSource().location()).toBe("/home");
  });
});
