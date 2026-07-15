import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx, lazy, Suspense, Show, signal } from "./index";
import {
  installDOM,
  createContainer,
  serialize,
  asEl,
  tick,
  deferred,
  childByTag as byTag,
} from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

describe("lazy", () => {
  test("loads the module then renders it with forwarded props", async () => {
    const Greeting = (props: { name: string }) =>
      jsx("p", { children: () => `hi ${props.name}` });
    const d = deferred<{ default: typeof Greeting }>();
    const Lazy = lazy(() => d.promise);

    const container = createContainer();
    render(() => jsx(Lazy, { name: "ada" }), asEl(container));
    // Nothing yet — the import is in flight.
    expect(byTag(container, "p")).toBeUndefined();

    await tick();
    d.resolve({ default: Greeting });
    await tick();
    expect(serialize(container)).toContain("<p>hi ada</p>");
  });

  test("imports the module once across multiple instances", async () => {
    const Comp = () => jsx("span", { children: "x" });
    let calls = 0;
    const Lazy = lazy(() => {
      calls++;
      return Promise.resolve({ default: Comp });
    });

    render(
      () => [jsx(Lazy, {}), jsx(Lazy, {})],
      asEl(createContainer()),
    );
    await tick();
    await tick();
    expect(calls).toBe(1);
  });

  test("suspends the nearest <Suspense> until the module loads", async () => {
    const Comp = () => jsx("p", { children: "ready" });
    const d = deferred<{ default: typeof Comp }>();
    const Lazy = lazy(() => d.promise);

    const container = createContainer();
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => jsx(Lazy, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toContain("loading");

    await tick();
    d.resolve({ default: Comp });
    await tick();
    expect(serialize(container)).toContain("ready");
    expect(serialize(container)).not.toContain("loading");
  });

  test("does not re-import across a remount (dispose then render again)", async () => {
    const Comp = () => jsx("p", { children: "x" });
    let calls = 0;
    const Lazy = lazy(() => {
      calls++;
      return Promise.resolve({ default: Comp });
    });

    const dispose = render(() => jsx(Lazy, {}), asEl(createContainer()));
    await tick();
    expect(calls).toBe(1);
    dispose();

    // A fresh mount reuses the cached module promise — no second import.
    const container = createContainer();
    render(() => jsx(Lazy, {}), asEl(container));
    await tick();
    await tick();
    expect(calls).toBe(1);
    expect(serialize(container)).toContain("<p>x</p>");
  });

  test("caches a failed import (a later mount surfaces it without re-importing)", async () => {
    const d = deferred<{ default: () => unknown }>();
    let calls = 0;
    const Lazy = lazy(() => {
      calls++;
      return d.promise;
    });

    const dispose = render(() => jsx(Lazy, {}), asEl(createContainer()));
    await tick();
    d.reject(new Error("chunk failed"));
    await tick();
    dispose();

    // The rejected promise is cached: remounting neither re-imports nor renders.
    const container = createContainer();
    render(() => jsx(Lazy, {}), asEl(container));
    await tick();
    await tick();
    expect(calls).toBe(1);
    expect(serialize(container)).toBe("<div></div>");
  });

  test("loads on demand under a <Show>-gated <Suspense> without looping", async () => {
    // Mirrors examples/primitives: a button reveals a <Suspense> wrapping a
    // lazy() component. The whole boundary is created lazily via a function
    // child of <Show>, so the chunk only loads on first show. Each reactive
    // level must be insulated — otherwise the Suspense's pending count would
    // re-run the <Show> slot, rebuild the boundary, re-create the resource, and
    // loop forever (100% CPU). We assert it settles and the module loads once.
    let calls = 0;
    const Panel = () => jsx("p", { children: "panel" });
    const Lazy = lazy(() => {
      calls++;
      return Promise.resolve({ default: Panel });
    });
    const shown = signal(false);

    const container = createContainer();
    render(
      () =>
        jsx(Show, {
          when: shown,
          children: () =>
            jsx(Suspense, {
              fallback: jsx("p", { children: "loading" }),
              children: () => jsx(Lazy, {}),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>"); // nothing until shown

    shown.set(true);
    expect(serialize(container)).toContain("loading"); // boundary up, chunk in flight
    await tick();
    await tick();
    expect(serialize(container)).toContain("<p>panel</p>");
    expect(serialize(container)).not.toContain("loading");
    expect(calls).toBe(1); // imported exactly once — no rebuild loop
  });

  test("a failed import surfaces via the resource error (no render)", async () => {
    const d = deferred<{ default: () => unknown }>();
    const Lazy = lazy(() => d.promise);
    const container = createContainer();
    render(() => jsx(Lazy, {}), asEl(container));
    await tick();
    d.reject(new Error("chunk failed"));
    await tick();
    // Stays empty; the error is held on the resource, not thrown into render.
    expect(serialize(container)).toBe("<div></div>");
  });
});
