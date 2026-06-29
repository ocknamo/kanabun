import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx, onCleanup } from "@kanabun/core";
import { Router, Route, Routes, useParams, createMemorySource } from "./index";
import { installDOM, createContainer, serialize, asEl } from "../../core/src/dom-mock";
import { findTag } from "./router-test-utils";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

describe("nested routing", () => {
  test("a layout route renders nested routes against the leftover path", () => {
    const src = createMemorySource("/users/1");
    const container = createContainer();
    // The layout matches the `/users/*` prefix; the nested <Routes> matches the
    // leftover ("/1", then "/") — no <Outlet>, the nested router is the outlet.
    function UsersLayout() {
      return jsx("div", {
        children: [
          jsx("h2", { children: "users" }),
          jsx(Routes, {
            children: [
              jsx(Route, {
                path: "/:id",
                children: (params: () => { id: string }) =>
                  jsx("p", { children: () => `user ${params().id}` }),
              }),
              jsx(Route, { path: "/", children: jsx("p", { children: "index" }) }),
            ],
          }),
        ],
      });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Routes, {
              children: jsx(Route, {
                path: "/users/*",
                component: () => jsx(UsersLayout, {}),
              }),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe(
      "<div><div><h2>users</h2><p>user 1</p></div></div>",
    );

    // Switch the *child* — the layout (and its <h2>) is kept, only the nested
    // route re-selects.
    const layout = findTag(container, "h2");
    src.go("/users");
    expect(findTag(container, "h2")).toBe(layout);
    expect(serialize(container)).toBe(
      "<div><div><h2>users</h2><p>index</p></div></div>",
    );
  });

  test("nested params merge, so descendants read the whole chain", () => {
    const src = createMemorySource("/orgs/acme/users/7");
    const container = createContainer();
    function Profile() {
      const params = useParams();
      return jsx("p", { children: () => `${params().org}/${params().id}` });
    }
    function OrgLayout() {
      return jsx("section", {
        children: jsx(Routes, {
          children: jsx(Route, { path: "/users/:id", children: () => jsx(Profile, {}) }),
        }),
      });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx(Route, { path: "/orgs/:org/*", children: () => jsx(OrgLayout, {}) }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><section><p>acme/7</p></section></div>");

    // The shared org param keeps updating reactively (same Profile node).
    const before = findTag(container, "p");
    src.go("/orgs/globex/users/7");
    expect(findTag(container, "p")).toBe(before);
    expect(serialize(container)).toBe("<div><section><p>globex/7</p></section></div>");
  });

  test("switching a nested route disposes the previous child, keeps the layout", () => {
    const src = createMemorySource("/x/a");
    const cleaned: string[] = [];
    const container = createContainer();
    function A() {
      onCleanup(() => cleaned.push("a"));
      return jsx("p", { children: "A" });
    }
    function Layout() {
      onCleanup(() => cleaned.push("layout"));
      // The nested router lives inside a host element (a layout's chrome), so it
      // gets its own insert boundary and an inner switch doesn't rebuild Layout.
      return jsx("section", {
        children: jsx(Routes, {
          children: [
            jsx(Route, { path: "/a", children: () => jsx(A, {}) }),
            jsx(Route, { path: "/b", children: jsx("p", { children: "B" }) }),
          ],
        }),
      });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () => jsx(Route, { path: "/x/*", children: () => jsx(Layout, {}) }),
        }),
      asEl(container),
    );
    expect(cleaned).toEqual([]);

    src.go("/x/b"); // same layout, different child → only the child is torn down
    expect(cleaned).toEqual(["a"]);
    expect(serialize(container)).toBe("<div><section><p>B</p></section></div>");

    src.go("/elsewhere"); // the layout prefix no longer matches → layout torn down
    expect(cleaned).toEqual(["a", "layout"]);
    expect(serialize(container)).toBe("<div></div>");
  });

  test("a nested router returned bare (not in a host element) keeps the layout", () => {
    // Core insulates every reactive thunk in its own insert slot (dom.ts →
    // bindSlot), so a nested <Routes> behaves the same whether it sits inside a
    // host element or is returned *bare*: its $matched read no longer leaks into
    // the parent's tracking, so an inner switch re-selects only the child and the
    // layout stays mounted. (This used to rebuild the layout, making a wrapper
    // mandatory; that constraint was lifted — see decisions.md.)
    const src = createMemorySource("/x/a");
    const cleaned: string[] = [];
    const container = createContainer();
    function Layout() {
      onCleanup(() => cleaned.push("layout"));
      return jsx(Routes, {
        children: [
          jsx(Route, { path: "/a", children: jsx("p", { children: "A" }) }),
          jsx(Route, { path: "/b", children: jsx("p", { children: "B" }) }),
        ],
      });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () => jsx(Route, { path: "/x/*", children: () => jsx(Layout, {}) }),
        }),
      asEl(container),
    );
    expect(cleaned).toEqual([]);
    src.go("/x/b"); // inner switch — the layout is preserved, only the child swaps
    expect(cleaned).toEqual([]);
    expect(serialize(container)).toBe("<div><p>B</p></div>");

    src.go("/elsewhere"); // the layout prefix no longer matches → layout torn down
    expect(cleaned).toEqual(["layout"]);
    expect(serialize(container)).toBe("<div></div>");
  });

  test("a nested <Routes> shows its own fallback for an unmatched leftover", () => {
    const src = createMemorySource("/shop/unknown");
    const container = createContainer();
    function Shop() {
      return jsx("section", {
        children: jsx(Routes, {
          fallback: jsx("p", { children: "no such item" }),
          children: jsx(Route, { path: "/cart", children: jsx("p", { children: "cart" }) }),
        }),
      });
    }
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () => jsx(Route, { path: "/shop/*", children: () => jsx(Shop, {}) }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><section><p>no such item</p></section></div>");
    src.go("/shop/cart");
    expect(serialize(container)).toBe("<div><section><p>cart</p></section></div>");
  });
});
