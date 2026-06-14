/**
 * kanabun/router — history sources
 * ------------------------------------------------------------------
 * A {@link RouterSource} is the thin seam between the router's reactive state
 * and *where* the URL actually lives. The browser source drives
 * `window.history`; the memory source is an in-process implementation used by
 * tests (and usable for SSR / non-browser hosts). Keeping this an interface is
 * what lets the router be fully unit-tested without jsdom.
 */

/** The history backend the router reads from and writes to. */
export interface RouterSource {
  /** The current path string (`pathname + search + hash`). */
  location(): string;
  /** Push a new entry (back button will return to the previous one). */
  push(to: string): void;
  /** Replace the current entry (no new history entry). */
  replace(to: string): void;
  /**
   * Subscribe to *external* navigations (the browser back/forward buttons).
   * Returns an unsubscribe function. `push`/`replace` do **not** notify — the
   * router updates itself synchronously after calling them.
   */
  subscribe(callback: () => void): () => void;
}

// The minimal slices of `window` the browser source touches. Declared
// structurally so a test (or any host) can supply a stand-in.
interface HistoryLike {
  pushState(state: unknown, unused: string, url: string): void;
  replaceState(state: unknown, unused: string, url: string): void;
}
interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
}
export interface WindowLike {
  history: HistoryLike;
  location: LocationLike;
  addEventListener(type: "popstate", callback: () => void): void;
  removeEventListener(type: "popstate", callback: () => void): void;
}

/** Resolve the global `window` lazily, so importing this module never needs a DOM. */
function getWindow(): WindowLike {
  const win = (globalThis as { window?: WindowLike }).window;
  if (!win) {
    throw new Error(
      "kanabun/router: no `window` is available — createBrowserSource needs a " +
        "browser (or pass a window-like object explicitly).",
    );
  }
  return win;
}

/**
 * A {@link RouterSource} backed by the History API. Resolves `window` lazily
 * (or accepts a stand-in), so it's safe to construct anywhere a DOM exists.
 */
export function createBrowserSource(win: WindowLike = getWindow()): RouterSource {
  const read = () => win.location.pathname + win.location.search + win.location.hash;
  return {
    location: read,
    push: (to) => win.history.pushState(null, "", to),
    replace: (to) => win.history.replaceState(null, "", to),
    subscribe(callback) {
      win.addEventListener("popstate", callback);
      return () => win.removeEventListener("popstate", callback);
    },
  };
}

/** A {@link RouterSource} that keeps history in memory (tests / SSR). */
export interface MemorySource extends RouterSource {
  /**
   * Simulate a browser back/forward (or any external) navigation: update the
   * location and notify subscribers, exactly as a real `popstate` would.
   */
  go(to: string): void;
}

/**
 * Create an in-memory {@link RouterSource}, starting at `initial` (default `/`).
 * `push`/`replace` mutate the location silently; `go` additionally notifies
 * subscribers so it stands in for the back/forward buttons.
 */
export function createMemorySource(initial = "/"): MemorySource {
  let current = initial;
  const subscribers = new Set<() => void>();
  return {
    location: () => current,
    push: (to) => {
      current = to;
    },
    replace: (to) => {
      current = to;
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    go(to) {
      current = to;
      for (const callback of [...subscribers]) callback();
    },
  };
}
