import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createRoot, effect, signal, render, jsx } from "./index";
import { resource, Suspense } from "./async";
import type { Resource, ResourceActions, ResourceFetcherInfo } from "./async";
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

// ── resource: the reactive primitive (no DOM needed) ────────────────
describe("resource", () => {
  test("loads, exposes loading then the resolved value", async () => {
    const d = deferred<number>();
    let calls = 0;
    let data!: Resource<number>;
    createRoot(() => {
      [data] = resource(() => {
        calls++;
        return d.promise;
      });
    });
    // The fetch is deferred to a microtask, but loading flips synchronously.
    expect(data.loading()).toBe(true);
    expect(data()).toBeUndefined();
    expect(calls).toBe(0);

    await tick();
    expect(calls).toBe(1);

    d.resolve(42);
    await tick();
    expect(data()).toBe(42);
    expect(data.loading()).toBe(false);
    expect(data.error()).toBeUndefined();
  });

  test("captures a rejection in error() and stops loading", async () => {
    const d = deferred<number>();
    let data!: Resource<number>;
    createRoot(() => {
      [data] = resource(() => d.promise);
    });
    await tick();
    d.reject(new Error("boom"));
    await tick();
    expect(data()).toBeUndefined();
    expect((data.error() as Error).message).toBe("boom");
    expect(data.loading()).toBe(false);
  });

  test("a synchronous throw in the fetcher becomes an error", async () => {
    let data!: Resource<number>;
    createRoot(() => {
      [data] = resource(() => {
        throw new Error("sync");
      });
    });
    await tick();
    expect((data.error() as Error).message).toBe("sync");
    expect(data.loading()).toBe(false);
  });

  test("loading() and error() are reactive accessors", async () => {
    const d = deferred<number>();
    const log: boolean[] = [];
    createRoot(() => {
      const [data] = resource(() => d.promise);
      effect(() => {
        log.push(data.loading());
      });
    });
    expect(log).toEqual([true]); // load() set loading before the effect ran
    d.resolve(1);
    await tick();
    expect(log).toEqual([true, false]);
  });

  test("refetches when a reactive source changes, passing it to the fetcher", async () => {
    const id = signal(1);
    const seen: number[] = [];
    let cur = deferred<string>();
    let data!: Resource<string>;
    createRoot(() => {
      [data] = resource(id, (s) => {
        seen.push(s);
        return cur.promise;
      });
    });
    await tick();
    cur.resolve("a");
    await tick();
    expect(data()).toBe("a");

    cur = deferred<string>();
    id.set(2);
    expect(data.loading()).toBe(true);
    await tick();
    cur.resolve("b");
    await tick();
    expect(data()).toBe("b");
    expect(seen).toEqual([1, 2]);
  });

  test("an unready source (null) skips fetching and idles", async () => {
    const id = signal<number | null>(null);
    let calls = 0;
    let data!: Resource<number>;
    let actions!: ResourceActions<number>;
    createRoot(() => {
      [data, actions] = resource(id, () => {
        calls++;
        return Promise.resolve(1);
      });
    });
    await tick();
    expect(calls).toBe(0);
    expect(data.loading()).toBe(false);

    actions.refetch(); // also a no-op while unready
    expect(calls).toBe(0);

    id.set(5); // now ready → fetches
    await tick();
    expect(calls).toBe(1);
  });

  test("refetch() re-runs with refetching=true and the previous value", async () => {
    let info!: ResourceFetcherInfo<string>;
    let cur = deferred<string>();
    let data!: Resource<string>;
    let actions!: ResourceActions<string>;
    createRoot(() => {
      [data, actions] = resource((_s, i) => {
        info = i;
        return cur.promise;
      });
    });
    await tick();
    cur.resolve("first");
    await tick();
    expect(data()).toBe("first");
    expect(info.refetching).toBe(false);

    cur = deferred<string>();
    actions.refetch();
    expect(data.loading()).toBe(true);
    await tick();
    cur.resolve("second");
    await tick();
    expect(data()).toBe("second");
    expect(info.refetching).toBe(true);
    expect(info.value).toBe("first");
  });

  test("mutate() sets the value and cancels any in-flight fetch", async () => {
    const d = deferred<number>();
    let data!: Resource<number>;
    let actions!: ResourceActions<number>;
    createRoot(() => {
      [data, actions] = resource(() => d.promise);
    });
    await tick();
    actions.mutate(7);
    expect(data()).toBe(7);
    expect(data.loading()).toBe(false);

    d.resolve(99); // superseded by mutate — must be ignored
    await tick();
    expect(data()).toBe(7);
  });

  test("ignores a stale resolution when the source changes mid-flight", async () => {
    const id = signal(1);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let data!: Resource<string>;
    createRoot(() => {
      [data] = resource(id, (s) => (s === 1 ? d1.promise : d2.promise));
    });
    await tick();
    id.set(2);
    await tick();
    d1.resolve("stale"); // older version — dropped
    d2.resolve("fresh");
    await tick();
    expect(data()).toBe("fresh");
  });

  test("ignores a stale rejection when the source changes mid-flight", async () => {
    const id = signal(1);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    let data!: Resource<string>;
    createRoot(() => {
      [data] = resource(id, (s) => (s === 1 ? d1.promise : d2.promise));
    });
    await tick();
    id.set(2);
    await tick();
    d1.reject(new Error("stale")); // older version — dropped
    d2.resolve("fresh");
    await tick();
    expect(data()).toBe("fresh");
    expect(data.error()).toBeUndefined();
  });

  test("disposing the owner cancels an in-flight fetch", async () => {
    const d = deferred<number>();
    let data!: Resource<number>;
    let dispose!: () => void;
    createRoot((dp) => {
      dispose = dp;
      [data] = resource(() => d.promise);
    });
    await tick();
    dispose();
    d.resolve(123); // owner gone — must not be applied
    await tick();
    expect(data()).toBeUndefined();
  });

  test("refetch() works without a source", async () => {
    let calls = 0;
    let cur = deferred<number>();
    let data!: Resource<number>;
    let actions!: ResourceActions<number>;
    createRoot(() => {
      [data, actions] = resource(() => {
        calls++;
        return cur.promise;
      });
    });
    await tick();
    cur.resolve(1);
    await tick();
    expect(calls).toBe(1);

    cur = deferred<number>();
    actions.refetch();
    await tick();
    cur.resolve(2);
    await tick();
    expect(calls).toBe(2);
    expect(data()).toBe(2);
  });
});

// ── <Suspense>: the component ───────────────────────────────────────
describe("<Suspense>", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installDOM();
  });
  afterEach(() => {
    teardown();
  });

  test("shows the fallback while loading, then the children", async () => {
    const container = createContainer();
    const d = deferred<string>();
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => {
            const [data] = resource(() => d.promise);
            return jsx("span", { children: () => data() ?? "" });
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>loading</p></div>");
    d.resolve("hi");
    await tick();
    expect(serialize(container)).toBe("<div><span>hi</span></div>");
  });

  test("defaults to no fallback (renders nothing while loading)", async () => {
    const container = createContainer();
    const d = deferred<string>();
    render(
      () =>
        jsx(Suspense, {
          children: () => {
            const [data] = resource(() => d.promise);
            return jsx("span", { children: () => data() ?? "x" });
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div></div>");
    d.resolve("done");
    await tick();
    expect(serialize(container)).toBe("<div><span>done</span></div>");
  });

  test("non-function children (no boundary scope) render immediately", () => {
    const container = createContainer();
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: jsx("span", { children: "static" }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><span>static</span></div>");
  });

  test("a refetch keeps the last value on screen (does not re-suspend)", async () => {
    const container = createContainer();
    let cur = deferred<string>();
    let actions!: ResourceActions<string>;
    render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => {
            const [data, a] = resource(() => cur.promise);
            actions = a;
            return jsx("span", { children: () => data() ?? "" });
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>loading</p></div>");
    cur.resolve("first");
    await tick();
    expect(serialize(container)).toBe("<div><span>first</span></div>");

    cur = deferred<string>();
    actions.refetch();
    // Still showing the previous value — the fallback does not return.
    expect(serialize(container)).toBe("<div><span>first</span></div>");
    cur.resolve("second");
    await tick();
    expect(serialize(container)).toBe("<div><span>second</span></div>");
  });

  test("disposing the render tears down the children and clears the container", async () => {
    const container = createContainer();
    const d = deferred<string>();
    const dispose = render(
      () =>
        jsx(Suspense, {
          fallback: jsx("p", { children: "loading" }),
          children: () => {
            const [data] = resource(() => d.promise);
            return jsx("span", { children: () => data() ?? "" });
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>loading</p></div>");
    dispose();
    expect(serialize(container)).toBe("<div></div>");
    d.resolve("late"); // children are gone — must not throw or reappear
    await tick();
    expect(serialize(container)).toBe("<div></div>");
  });
});
