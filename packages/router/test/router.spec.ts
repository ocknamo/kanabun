import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx } from "@kanabun/core";
import {
  Router,
  Route,
  Link,
  useNavigate,
  useLocation,
  useParams,
  createMemorySource,
  type WindowLike,
} from "../src/index";
import {
  installDOM,
  createContainer,
  serialize,
  type MockNode,
} from "../../core/test/dom-mock";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
  delete (globalThis as { window?: unknown }).window;
});

const asEl = (n: MockNode) => n as unknown as Element;

/** Depth-first search for the first node matching `pred`. */
function find(node: MockNode, pred: (n: MockNode) => boolean): MockNode | undefined {
  if (pred(node)) return node;
  for (const child of node.childNodes) {
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return undefined;
}
function findTag(root: MockNode, tag: string): MockNode | undefined {
  return find(root, (n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag);
}
/** A left-click event payload the mock dispatcher understands. */
const leftClick = {
  button: 0,
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

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
});

// A structural stand-in for `window`, backed by an in-memory URL.
function fakeWindow(initial = "/"): WindowLike & { popstate(): void } {
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
