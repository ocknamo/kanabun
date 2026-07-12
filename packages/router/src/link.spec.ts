import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx } from "@kanabun/core";
import { Router, Route, Link, createMemorySource } from "./index";
import {
  installDOM,
  createContainer,
  serialize,
  asEl,
  queryByTag as findTag,
  leftClick,
} from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

describe("<Link>", () => {
  function renderWithLink(props: Record<string, unknown>, initial = "/") {
    const src = createMemorySource(initial);
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx("div", {
              children: [
                jsx(Link, props),
                jsx(Route, { path: "/dest", children: jsx("p", { children: "arrived" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    return { src, container };
  }

  test("renders an anchor and intercepts a plain left-click", () => {
    const { src, container } = renderWithLink({ href: "/dest", children: "go" });
    const a = findTag(container, "a")!;
    expect(a.getAttribute("href")).toBe("/dest");

    const event = a.dispatch("click", { ...leftClick });
    expect(event.defaultPrevented).toBe(true); // intercepted
    expect(src.location()).toBe("/dest");
    expect(serialize(container)).toContain("<p>arrived</p>");
  });

  test("replace option replaces instead of pushing", () => {
    const { src, container } = renderWithLink({ href: "/dest", replace: true, children: "go" });
    let replaced = "";
    src.replace = (to: string) => {
      replaced = to;
    };
    findTag(container, "a")!.dispatch("click", { ...leftClick });
    expect(replaced).toBe("/dest");
  });

  test("a modified click is left to the browser", () => {
    const { src, container } = renderWithLink({ href: "/dest", children: "go" });
    const event = findTag(container, "a")!.dispatch("click", {
      ...leftClick,
      metaKey: true,
    });
    expect(event.defaultPrevented).toBe(false);
    expect(src.location()).toBe("/");
  });

  test("a non-left button is left to the browser", () => {
    const { src, container } = renderWithLink({ href: "/dest", children: "go" });
    findTag(container, "a")!.dispatch("click", { ...leftClick, button: 1 });
    expect(src.location()).toBe("/");
  });

  test("target other than _self is left to the browser", () => {
    const { src, container } = renderWithLink({
      href: "/dest",
      target: "_blank",
      children: "go",
    });
    findTag(container, "a")!.dispatch("click", { ...leftClick });
    expect(src.location()).toBe("/");
  });

  test("external hrefs are left to the browser", () => {
    const { src, container } = renderWithLink({
      href: "https://example.com",
      children: "out",
    });
    const event = findTag(container, "a")!.dispatch("click", { ...leftClick });
    expect(event.defaultPrevented).toBe(false);
    expect(src.location()).toBe("/");
  });

  test("a user onClick still runs before interception", () => {
    let clicked = false;
    const { src, container } = renderWithLink({
      href: "/dest",
      onClick: () => {
        clicked = true;
      },
      children: "go",
    });
    findTag(container, "a")!.dispatch("click", { ...leftClick });
    expect(clicked).toBe(true);
    expect(src.location()).toBe("/dest");
  });

  test("a relative href resolves against the current location", () => {
    const src = createMemorySource("/users/1");
    const container = createContainer();
    render(
      () =>
        jsx(Router, {
          source: src,
          children: () =>
            jsx("div", {
              children: [
                jsx(Link, { href: "2", children: "sibling" }),
                jsx(Route, { path: "/users/2", children: jsx("p", { children: "two" }) }),
              ],
            }),
        }),
      asEl(container),
    );
    const a = findTag(container, "a")!;
    // The rendered href is the resolved absolute path.
    expect(a.getAttribute("href")).toBe("/users/2");
    a.dispatch("click", { ...leftClick });
    expect(src.location()).toBe("/users/2");
    expect(serialize(container)).toContain("<p>two</p>");
  });

  test("a rendered external href is left verbatim (not origin-stripped)", () => {
    const { container } = renderWithLink({ href: "https://example.com/x", children: "out" });
    expect(findTag(container, "a")!.getAttribute("href")).toBe("https://example.com/x");
  });

  test("a script-executing scheme renders an inert anchor (no href)", () => {
    // S3: javascript:/data:/vbscript: must not reach the browser as an href,
    // or a click would execute it. Whitespace/control chars don't sneak past.
    const vectors = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ];
    for (const href of vectors) {
      const { src, container } = renderWithLink({ href, children: "x" });
      const a = findTag(container, "a")!;
      expect(a.getAttribute("href")).toBeNull();
      const event = a.dispatch("click", { ...leftClick });
      // Nothing to navigate to; the click does not route client-side.
      expect(event.defaultPrevented).toBe(false);
      expect(src.location()).toBe("/");
    }
  });
});
