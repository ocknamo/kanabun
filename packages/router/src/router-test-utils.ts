/**
 * Shared test helpers for the router specs.
 * ------------------------------------------------------------------
 * Test-only utilities pulled out of `router.spec.ts` so the suite can be split
 * by feature (router / nested / link / browser) without duplicating them.
 * Not product code — excluded from coverage by name in `bunfig.toml`, the same
 * way the DOM mock is.
 */
import { type WindowLike } from "./index";
import { type MockNode } from "../../core/src/dom-mock";

/** Depth-first search for the first node matching `pred`. */
function find(
  node: MockNode,
  pred: (n: MockNode) => boolean,
): MockNode | undefined {
  if (pred(node)) return node;
  for (const child of node.childNodes) {
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return undefined;
}

/** Find the first element with the given tag name. */
export function findTag(root: MockNode, tag: string): MockNode | undefined {
  return find(root, (n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag);
}

/** A left-click event payload the mock dispatcher understands. */
export const leftClick = {
  button: 0,
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

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
