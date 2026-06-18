import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx } from "@kanabun/core";
import { Router, Route, Link, createHashSource } from "./index";
import { installDOM, createContainer, serialize, asEl } from "../../core/src/dom-mock";
import { findTag, leftClick, fakeWindow, fakeHashWindow } from "./router-test-utils";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

describe("default browser source", () => {
  test("a source-less <Router> drives window.history", () => {
    (globalThis as { window?: unknown }).window = fakeWindow("/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          children: () =>
            jsx("div", {
              children: [
                jsx(Link, { href: "/dest", children: "go" }),
                jsx(Route, { path: "/dest", children: jsx("p", { children: "arrived" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).not.toContain("arrived");
    findTag(container, "a")!.dispatch("click", { ...leftClick });
    expect(serialize(container)).toContain("<p>arrived</p>");
  });
});

describe("hash source (integration)", () => {
  test("a <Router> on a hash source navigates by link and by hashchange", () => {
    const win = fakeHashWindow("#/");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: createHashSource(win),
          children: () =>
            jsx("div", {
              children: [
                jsx(Link, { href: "/dest", children: "go" }),
                jsx(Route, { path: "/dest", children: jsx("p", { children: "arrived" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).not.toContain("arrived");

    // Click → the route renders and the URL hash carries the path.
    findTag(container, "a")!.dispatch("click", { ...leftClick });
    expect(win.location.hash).toBe("#/dest");
    expect(serialize(container)).toContain("<p>arrived</p>");

    // Simulate the back button: change the hash and fire hashchange.
    win.location.hash = "/";
    win.hashchange();
    expect(serialize(container)).not.toContain("arrived");
  });
});
