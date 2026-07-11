import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { render, jsx, signal, effect, onMount, onCleanup, createRoot } from "./index";
import { installDOM, createContainer, asEl } from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

describe("onMount", () => {
  test("runs once on the next microtask, after synchronous render", async () => {
    const order: string[] = [];
    const container = createContainer();
    render(() => {
      onMount(() => order.push("mount"));
      order.push("render");
      return jsx("div", {});
    }, asEl(container));

    expect(order).toEqual(["render"]); // not mounted synchronously
    await Promise.resolve();
    expect(order).toEqual(["render", "mount"]);
  });

  test("runs within the owner, so onCleanup is honoured on dispose", async () => {
    const cleaned: string[] = [];
    const container = createContainer();
    const dispose = render(() => {
      onMount(() => onCleanup(() => cleaned.push("c")));
      return jsx("div", {});
    }, asEl(container));

    await Promise.resolve();
    expect(cleaned).toEqual([]);
    dispose();
    expect(cleaned).toEqual(["c"]);
  });

  test("is skipped if the owner is disposed before the microtask fires", async () => {
    let ran = 0;
    const dispose = createRoot((d) => {
      onMount(() => ran++);
      return d;
    });
    dispose(); // dispose before the microtask runs
    await Promise.resolve();
    expect(ran).toBe(0);
  });
});

describe("cleanup", () => {
  test("returned cleanup runs before re-run and on dispose", () => {
    const count = signal(0);
    const log: string[] = [];
    const dispose = effect(() => {
      const v = count();
      log.push(`run:${v}`);
      return () => {
        log.push(`cleanup:${v}`);
      };
    });
    count.set(1);
    count.set(2);
    dispose();
    expect(log).toEqual([
      "run:0",
      "cleanup:0",
      "run:1",
      "cleanup:1",
      "run:2",
      "cleanup:2", // cleanup on dispose
    ]);
  });

  test("onCleanup registers teardown", () => {
    const count = signal(0);
    const cleaned: number[] = [];
    effect(() => {
      const v = count();
      onCleanup(() => cleaned.push(v));
    });
    count.set(1);
    expect(cleaned).toEqual([0]); // cleanup for the first run
  });

  test("multiple cleanups run LIFO", () => {
    const tick = signal(0);
    const order: number[] = [];
    effect(() => {
      tick();
      onCleanup(() => order.push(1));
      onCleanup(() => order.push(2));
    });
    tick.set(1);
    expect(order).toEqual([2, 1]);
  });
});

describe("ownership / createRoot", () => {
  test("dispose tears down effects created inside the root", () => {
    const count = signal(0);
    const runs = mock(() => {
      count();
    });
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      effect(runs);
    });
    expect(runs).toHaveBeenCalledTimes(1);
    count.set(1);
    expect(runs).toHaveBeenCalledTimes(2);
    dispose();
    count.set(2);
    expect(runs).toHaveBeenCalledTimes(2); // disposed with the root
  });

  test("nested effects are disposed when the parent re-runs", () => {
    const outer = signal(0);
    const inner = signal(0);
    const innerRuns = mock(() => {
      inner();
    });
    createRoot(() => {
      effect(() => {
        outer(); // re-runs the parent, which must dispose the previous child
        effect(innerRuns);
      });
    });
    expect(innerRuns).toHaveBeenCalledTimes(1);

    // The child effect from the first parent run is live.
    inner.set(1);
    expect(innerRuns).toHaveBeenCalledTimes(2);

    // Re-run the parent: the old child is disposed and a fresh one created.
    outer.set(1);
    expect(innerRuns).toHaveBeenCalledTimes(3);

    // Only ONE child is now subscribed (the old one was disposed, no leak).
    inner.set(2);
    expect(innerRuns).toHaveBeenCalledTimes(4);
  });

  test("onCleanup inside a root runs on dispose", () => {
    const cleaned: string[] = [];
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      onCleanup(() => cleaned.push("root"));
    });
    expect(cleaned).toEqual([]);
    dispose();
    expect(cleaned).toEqual(["root"]);
  });

  test("createRoot returns the callback result and does not track reads", () => {
    const s = signal(1);
    const runs = mock(() => {});
    const value = createRoot(() => {
      // This read must not subscribe the root to s.
      const v = s();
      effect(runs); // unrelated effect, just to have something owned
      return v * 10;
    });
    expect(value).toBe(10);
    runs.mockClear();
    s.set(2); // root isn't tracking s → nothing re-runs
    expect(runs).toHaveBeenCalledTimes(0);
  });
});
