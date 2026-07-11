/**
 * Router-specific test helpers: in-memory `WindowLike` stand-ins.
 * ------------------------------------------------------------------
 * Test-only utilities for the router specs. Generic DOM helpers (queries,
 * event payloads) live in `@kanabun/testing`; only the fakes coupled to the
 * router's `WindowLike` surface stay here. Not product code — excluded from
 * coverage by name in `bunfig.toml`.
 */
import { type WindowLike } from "./index";

/** A structural stand-in for `window`, backed by an in-memory URL. */
export function fakeWindow(initial = "/"): WindowLike & { popstate(): void } {
  let url = new URL(initial, "http://x");
  const listeners = new Set<() => void>();
  return {
    history: {
      pushState: (_s, _u, to) => {
        url = new URL(to, "http://x");
      },
      replaceState: (_s, _u, to) => {
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
    addEventListener: (_t, cb) => {
      listeners.add(cb);
    },
    removeEventListener: (_t, cb) => {
      listeners.delete(cb);
    },
    popstate() {
      for (const cb of [...listeners]) cb();
    },
  };
}

/** A window stand-in whose location lives entirely in the hash. */
export function fakeHashWindow(
  initialHash = "",
): WindowLike & { hashchange(): void } {
  let url = new URL("http://x/" + initialHash);
  const listeners = new Set<() => void>();
  return {
    history: {
      pushState: (_s, _u, to) => {
        url = new URL(to, url);
      },
      replaceState: (_s, _u, to) => {
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
    addEventListener: (_t, cb) => {
      listeners.add(cb);
    },
    removeEventListener: (_t, cb) => {
      listeners.delete(cb);
    },
    hashchange() {
      for (const cb of [...listeners]) cb();
    },
  };
}
