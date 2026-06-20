import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx, Suspense, lazy, ErrorBoundary } from "./index";
import { installDOM, createContainer, serialize, asEl } from "./dom-mock";

// A promise whose settlement we control from the test.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Drain all microtasks (a macrotask runs after every queued microtask).
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("lazy()", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installDOM();
  });
  afterEach(() => {
    teardown();
  });

  test("shows the <Suspense> fallback until the module resolves, then renders it", async () => {
    const container = createContainer();
    const d = deferred<{ default: (p: { name: string }) => unknown }>();
    const Greeting = lazy<{ name: string }>(() => d.promise);
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => jsx(Greeting, { name: "kana" }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>loading</p></div>");

    d.resolve({
      default: (p: { name: string }) => jsx("span", { children: p.name }),
    });
    await tick();
    expect(serialize(container)).toBe("<div><span>kana</span></div>");
  });

  test("renders with no <Suspense> boundary (no fallback, fills in on resolve)", async () => {
    const container = createContainer();
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);
    render(() => jsx(Comp, {}), asEl(container));
    expect(serialize(container)).toBe("<div></div>");

    d.resolve({ default: () => jsx("span", { children: "ready" }) });
    await tick();
    expect(serialize(container)).toBe("<div><span>ready</span></div>");
  });

  test("a failed import surfaces the error to an <ErrorBoundary>", async () => {
    const container = createContainer();
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: (err: unknown) => jsx("p", { children: `caught: ${String(err)}` }),
          children: () =>
            jsx(Suspense, {
              fallback: jsx("span", { children: "loading" }),
              children: () => jsx(Comp, {}),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><span>loading</span></div>");

    d.reject(new Error("chunk failed"));
    await tick();
    expect(serialize(container)).toBe("<div><p>caught: Error: chunk failed</p></div>");
  });

  test("multiple lazy components share one boundary and one import each", async () => {
    const container = createContainer();
    const da = deferred<{ default: () => unknown }>();
    const db = deferred<{ default: () => unknown }>();
    const A = lazy(() => da.promise);
    const B = lazy(() => db.promise);
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => [jsx(A, {}), jsx(B, {})],
        }),
      asEl(container),
    );
    // Both outstanding → fallback.
    expect(serialize(container)).toBe("<div><p>loading</p></div>");

    da.resolve({ default: () => jsx("span", { children: "A" }) });
    await tick();
    // One still pending → still the fallback (boundary counts both).
    expect(serialize(container)).toBe("<div><p>loading</p></div>");

    db.resolve({ default: () => jsx("b", { children: "B" }) });
    await tick();
    expect(serialize(container)).toBe("<div><span>A</span><b>B</b></div>");
  });

  test("imports once and shares the promise across instances", async () => {
    const container = createContainer();
    let calls = 0;
    const d = deferred<{ default: (p: { n: number }) => unknown }>();
    const Item = lazy<{ n: number }>(() => {
      calls++;
      return d.promise;
    });
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => [jsx(Item, { n: 1 }), jsx(Item, { n: 2 })],
        }),
      asEl(container),
    );
    expect(calls).toBe(1); // both instances share the single import

    d.resolve({ default: (p: { n: number }) => jsx("i", { children: () => p.n }) });
    await tick();
    expect(serialize(container)).toBe("<div><i>1</i><i>2</i></div>");
  });

  test("an instance created after the module loaded renders synchronously", async () => {
    const container = createContainer();
    const d = deferred<{ default: (p: { n: number }) => unknown }>();
    const Item = lazy<{ n: number }>(() => d.promise);

    // Preload and settle the module first.
    const loaded = Item.preload();
    d.resolve({ default: (p: { n: number }) => jsx("i", { children: () => p.n }) });
    await loaded;
    await tick();

    // Now a fresh render — no <Suspense> needed, no fallback frame.
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => jsx(Item, { n: 7 }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><i>7</i></div>");
  });

  test("an instance created after the import failed throws synchronously", async () => {
    const container = createContainer();
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);

    const loaded = Comp.preload().then(undefined, () => {});
    d.reject(new Error("dead"));
    await loaded;
    await tick();

    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: (err: unknown) => jsx("p", { children: `caught: ${String(err)}` }),
          children: () => jsx(Comp, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>caught: Error: dead</p></div>");
  });

  test("preload() returns the cached promise and resolves to the module", async () => {
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);
    const p1 = Comp.preload();
    const p2 = Comp.preload();
    expect(p1).toBe(p2); // same cached promise

    const fn = () => jsx("span", { children: "x" });
    d.resolve({ default: fn });
    expect((await p1).default).toBe(fn);
  });

  test("disposing before the import resolves does not render or throw", async () => {
    const container = createContainer();
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);
    const dispose = render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => jsx(Comp, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>loading</p></div>");
    dispose();
    expect(serialize(container)).toBe("<div></div>");

    d.resolve({ default: () => jsx("span", { children: "late" }) });
    await tick();
    expect(serialize(container)).toBe("<div></div>");
  });

  test("disposing before a failed import does not surface the error", async () => {
    const container = createContainer();
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);
    const dispose = render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => jsx(Comp, {}),
        }),
      asEl(container),
    );
    dispose();
    expect(serialize(container)).toBe("<div></div>");

    d.reject(new Error("ignored"));
    await tick();
    expect(serialize(container)).toBe("<div></div>");
  });

  test("works without a <Suspense> boundary when the import later fails", async () => {
    const container = createContainer();
    const d = deferred<{ default: () => unknown }>();
    const Comp = lazy(() => d.promise);
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: (err: unknown) => jsx("p", { children: `caught: ${String(err)}` }),
          children: () => jsx(Comp, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>"); // no boundary, nothing shows

    d.reject(new Error("boom"));
    await tick();
    expect(serialize(container)).toBe("<div><p>caught: Error: boom</p></div>");
  });
});
