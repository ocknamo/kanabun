import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx } from "@kanabun/core";
import { Router, Route, useNavigate, useLocation, createMemorySource } from "./index";
import { installDOM, createContainer, serialize, asEl } from "../../core/src/dom-mock";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

describe("useLocation / useNavigate", () => {
  test("useLocation tracks the current pathname reactively", () => {
    const src = createMemorySource("/a");
    const container = createContainer();
    function Crumbs() {
      const location = useLocation();
      return jsx("p", { children: () => location().pathname });
    }
    render(
      () => jsx(Router, { source: src, children: () => jsx(Crumbs, {}) }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>/a</p></div>");
    src.go("/b");
    expect(serialize(container)).toBe("<div><p>/b</p></div>");
  });

  test("disposing the render unsubscribes from the source", () => {
    // Wrap a memory source to count live subscriptions, then assert the
    // <Router>'s onCleanup releases it when the render is disposed.
    const base = createMemorySource("/");
    let live = 0;
    const src = {
      ...base,
      subscribe(callback: () => void) {
        live++;
        const off = base.subscribe(callback);
        return () => {
          live--;
          off();
        };
      },
    };
    const container = createContainer();
    const dispose = render(
      () => jsx(Router, { source: src, children: () => jsx("p", { children: "x" }) }),
      asEl(container),
    );
    expect(live).toBe(1);
    dispose();
    expect(live).toBe(0);
  });

  test("useNavigate pushes and replaces", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    let nav!: ReturnType<typeof useNavigate>;
    function Capture() {
      nav = useNavigate();
      return null;
    }
    render(
      () => jsx(Router, { source: src, children: () => jsx(Capture, {}) }),
      asEl(container),
    );
    nav("/x");
    expect(src.location()).toBe("/x");
    nav("/y", { replace: true });
    expect(src.location()).toBe("/y");
  });

  test("useNavigate resolves a relative target against the current location", () => {
    const src = createMemorySource("/users/1");
    const container = createContainer();
    let nav!: ReturnType<typeof useNavigate>;
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () => {
            nav = useNavigate();
            return null;
          },
        }),
      asEl(container),
    );
    nav("2"); // sibling: replaces the last segment
    expect(src.location()).toBe("/users/2");
  });

  test("useNavigate leaves an external/scheme target verbatim", () => {
    // Symmetric with <Link>: resolving would strip the origin, so don't.
    const src = createMemorySource("/users/1");
    const container = createContainer();
    let nav!: ReturnType<typeof useNavigate>;
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () => {
            nav = useNavigate();
            return null;
          },
        }),
      asEl(container),
    );
    nav("https://example.com/p");
    expect(src.location()).toBe("https://example.com/p");
  });
});

describe("hooks outside a <Router>", () => {
  test("useLocation throws", () => {
    const container = createContainer();
    expect(() =>
      render(() => {
        useLocation();
        return null;
      }, asEl(container)),
    ).toThrow(/must be used inside a <Router>/);
  });

  test("a <Route> throws", () => {
    const container = createContainer();
    expect(() =>
      render(() => jsx(Route, { path: "/", children: "x" }), asEl(container)),
    ).toThrow(/must be used inside a <Router>/);
  });
});
