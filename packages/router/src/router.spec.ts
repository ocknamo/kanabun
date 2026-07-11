import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx, onCleanup } from "@kanabun/core";
import { Router, Route, Routes, useParams, createMemorySource } from "./index";
import {
  installDOM,
  createContainer,
  serialize,
  asEl,
  queryByTag as findTag,
} from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

describe("<Router> + <Route>", () => {
  test("shows the matching route and switches on navigation", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx("div", {
              children: [
                jsx(Route, { path: "/", children: jsx("p", { children: "home" }) }),
                jsx(Route, { path: "/about", children: jsx("p", { children: "about" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><div><p>home</p></div></div>");

    src.go("/about"); // simulate external navigation
    expect(serialize(container)).toBe("<div><div><p>about</p></div></div>");
  });

  test("renders a fallback while unmatched, nothing by default", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx("div", {
              children: [
                jsx(Route, {
                  path: "/secret",
                  fallback: jsx("p", { children: "nope" }),
                  children: jsx("p", { children: "secret" }),
                }),
                jsx(Route, { path: "/secret", children: jsx("p", { children: "secret2" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    // First route shows its fallback; the second (no fallback) renders nothing.
    expect(serialize(container)).toBe("<div><div><p>nope</p></div></div>");
  });

  test("a route component receives reactive params", () => {
    const src = createMemorySource("/users/1");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Route, {
              path: "/users/:id",
              component: ({ params }: { params: () => { id: string } }) =>
                jsx("p", { children: () => `user ${params().id}` }),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>user 1</p></div>");

    // Same route, different param: content node is reused, text updates.
    const before = findTag(container, "p");
    src.go("/users/2");
    expect(findTag(container, "p")).toBe(before);
    expect(serialize(container)).toBe("<div><p>user 2</p></div>");
  });

  test("function children receive the params accessor", () => {
    const src = createMemorySource("/q/hi");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Route, {
              path: "/q/:term",
              children: (params: () => { term: string }) =>
                jsx("p", { children: () => params().term }),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>hi</p></div>");
  });

  test("descendants read the matched params via useParams", () => {
    const src = createMemorySource("/users/7");
    const container = createContainer();
    function Profile() {
      const params = useParams();
      return jsx("p", { children: () => `id=${params().id}` });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          // Function children (lazy) so Profile is built *inside* the route
          // context and can read useParams — the eager-children limitation.
          children: () =>
            jsx(Route, { path: "/users/:id", children: () => jsx(Profile, {}) }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>id=7</p></div>");
  });

  test("a standalone <Route> disposes its content when it stops matching", () => {
    const src = createMemorySource("/x");
    const cleaned: string[] = [];
    function Inner() {
      onCleanup(() => cleaned.push("x"));
      return jsx("p", { children: "X" });
    }
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () => jsx(Route, { path: "/x", children: () => jsx(Inner, {}) }),
        }),
      asEl(container),
    );
    expect(cleaned).toEqual([]);
    src.go("/other"); // no longer matches → content torn down
    expect(cleaned).toEqual(["x"]);
    expect(serialize(container)).toBe("<div></div>");
  });

  test("disposing the render tears down the active route content", () => {
    // The content lives in its own root (a disposal boundary), so only the
    // slot's onCleanup tears it down when the whole render is disposed.
    const src = createMemorySource("/x");
    const cleaned: string[] = [];
    function Inner() {
      onCleanup(() => cleaned.push("x"));
      return jsx("p", { children: "X" });
    }
    const container = createContainer();
    const dispose = render(
      () =>
        jsx(Router, {
          source: src,
          children: () => jsx(Route, { path: "/x", children: () => jsx(Inner, {}) }),
        }),
      asEl(container),
    );
    expect(cleaned).toEqual([]);
    dispose();
    expect(cleaned).toEqual(["x"]);
  });

  test("useParams outside a route is an empty object", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    function Probe() {
      const params = useParams();
      return jsx("p", { children: () => JSON.stringify(params()) });
    }
    render(
      () => jsx(Router, { source: src, children: () => jsx(Probe, {}) }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>{}</p></div>");
  });
});

describe("<Routes> (exclusive)", () => {
  test("renders only the first matching route, even when others match too", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Routes, {
              children: [
                jsx(Route, { path: "/", children: jsx("p", { children: "home" }) }),
                // A catch-all that also matches "/", but is second in order.
                jsx(Route, { path: "*", children: jsx("p", { children: "catch-all" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>home</p></div>");

    src.go("/anything/deep"); // only the wildcard matches now
    expect(serialize(container)).toBe("<div><p>catch-all</p></div>");
  });

  test("shows the fallback when no route matches (a 404 home)", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Routes, {
              fallback: jsx("p", { children: "404" }),
              children: jsx(Route, { path: "/about", children: jsx("p", { children: "about" }) }),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>404</p></div>");
    src.go("/about");
    expect(serialize(container)).toBe("<div><p>about</p></div>");
  });

  test("defaults to nothing when no route matches and no fallback is given", () => {
    const src = createMemorySource("/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Routes, {
              children: jsx(Route, { path: "/about", children: jsx("p", { children: "x" }) }),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>");
  });

  test("keeps the node and updates params while a route stays selected", () => {
    const src = createMemorySource("/users/1");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Routes, {
              children: [
                jsx(Route, {
                  path: "/users/:id",
                  component: ({ params }: { params: () => { id: string } }) =>
                    jsx("p", { children: () => `user ${params().id}` }),
                }),
                jsx(Route, { path: "*", children: jsx("p", { children: "other" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    const before = findTag(container, "p");
    src.go("/users/2"); // same route, different param
    expect(findTag(container, "p")).toBe(before); // not rebuilt
    expect(serialize(container)).toBe("<div><p>user 2</p></div>");
  });

  test("disposes the previous route's scope on switch", () => {
    const src = createMemorySource("/a");
    const cleaned: string[] = [];
    const container = createContainer();
    function A() {
      onCleanup(() => cleaned.push("a"));
      return jsx("p", { children: "A" });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Routes, {
              children: [
                jsx(Route, { path: "/a", children: () => jsx(A, {}) }),
                jsx(Route, { path: "/b", children: jsx("p", { children: "B" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    expect(cleaned).toEqual([]);
    src.go("/b"); // switch away from /a → its scope is torn down
    expect(cleaned).toEqual(["a"]);
    expect(serialize(container)).toBe("<div><p>B</p></div>");
  });
});
