import { describe, expect, test, mock } from "bun:test";
import { signal, computed, effect, batch, untrack, onCleanup } from "../src/index";

describe("signal", () => {
  test("reads and writes", () => {
    const count = signal(0);
    expect(count()).toBe(0);
    count.set(5);
    expect(count()).toBe(5);
  });

  test("update derives from previous value", () => {
    const count = signal(10);
    count.update((n) => n + 1);
    expect(count()).toBe(11);
  });

  test("peek reads without subscribing", () => {
    const count = signal(1);
    const runs = mock(() => {
      // peek must NOT register a dependency
      count.peek();
    });
    effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    count.set(2);
    expect(runs).toHaveBeenCalledTimes(1); // still 1 — peek didn't subscribe
  });

  test("set with an equal value does not notify", () => {
    const count = signal(1);
    const runs = mock(() => {
      count();
    });
    effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    count.set(1); // same value
    expect(runs).toHaveBeenCalledTimes(1);
  });

  test("can store function values", () => {
    const fn = signal<() => number>(() => 1);
    expect(fn()()).toBe(1);
    fn.set(() => 2); // arg is the new value, not an updater
    expect(fn()()).toBe(2);
  });
});

describe("computed", () => {
  test("derives and memoizes", () => {
    const count = signal(2);
    let computations = 0;
    const doubled = computed(() => {
      computations++;
      return count() * 2;
    });
    expect(doubled()).toBe(4);
    expect(doubled()).toBe(4); // cached — no recompute
    expect(computations).toBe(1);
    count.set(3);
    expect(doubled()).toBe(6);
    expect(computations).toBe(2);
  });

  test("is lazy — does not run until read", () => {
    const count = signal(1);
    let computations = 0;
    const c = computed(() => {
      computations++;
      return count();
    });
    expect(computations).toBe(0); // never read yet
    c();
    expect(computations).toBe(1);
  });

  test("chains of computeds", () => {
    const n = signal(1);
    const a = computed(() => n() + 1);
    const b = computed(() => a() * 10);
    expect(b()).toBe(20);
    n.set(2);
    expect(b()).toBe(30);
  });

  test("does not recompute when its value is unchanged", () => {
    const n = signal(4);
    const isEven = computed(() => n() % 2 === 0);
    let downstream = 0;
    const label = computed(() => {
      downstream++;
      return isEven() ? "even" : "odd";
    });
    expect(label()).toBe("even");
    expect(downstream).toBe(1);
    n.set(2); // changes n, but isEven stays true
    expect(label()).toBe("even");
    expect(downstream).toBe(1); // isEven didn't change → label not recomputed
  });
});

describe("effect", () => {
  test("runs immediately and on dependency change", () => {
    const count = signal(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count());
    });
    expect(seen).toEqual([0]);
    count.set(1);
    count.set(2);
    expect(seen).toEqual([0, 1, 2]);
  });

  test("tracks only the signals it reads", () => {
    const a = signal(0);
    const b = signal(0);
    const runs = mock(() => {
      a();
    });
    effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    b.set(1); // not a dependency
    expect(runs).toHaveBeenCalledTimes(1);
    a.set(1);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  test("disposer stops further runs and tears down", () => {
    const count = signal(0);
    const runs = mock(() => {
      count();
    });
    const dispose = effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    dispose();
    count.set(1);
    expect(runs).toHaveBeenCalledTimes(1); // disposed — never ran again
  });

  test("disposer is idempotent", () => {
    const dispose = effect(() => {});
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
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

describe("batch", () => {
  test("coalesces multiple writes into one effect run", () => {
    const a = signal(0);
    const b = signal(0);
    const runs = mock(() => {
      a();
      b();
    });
    effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    batch(() => {
      a.set(1);
      b.set(2);
    });
    expect(runs).toHaveBeenCalledTimes(2); // one run for both writes
    expect(a() + b()).toBe(3);
  });

  test("nested batches flush only at the outermost exit", () => {
    const a = signal(0);
    const runs = mock(() => {
      a();
    });
    effect(runs);
    batch(() => {
      a.set(1);
      batch(() => {
        a.set(2);
      });
      expect(runs).toHaveBeenCalledTimes(1); // not flushed yet
    });
    expect(runs).toHaveBeenCalledTimes(2);
    expect(a()).toBe(2);
  });

  test("returns the callback result", () => {
    expect(batch(() => 42)).toBe(42);
  });
});

describe("untrack", () => {
  test("reads without subscribing", () => {
    const tracked = signal(0);
    const ignored = signal(0);
    const runs = mock(() => {
      tracked();
      untrack(() => ignored());
    });
    effect(runs);
    expect(runs).toHaveBeenCalledTimes(1);
    ignored.set(1);
    expect(runs).toHaveBeenCalledTimes(1); // untracked
    tracked.set(1);
    expect(runs).toHaveBeenCalledTimes(2);
  });
});

describe("glitch-free propagation", () => {
  test("diamond updates the sink exactly once with consistent values", () => {
    // a → b, a → c, (b, c) → d ; an effect observes d.
    const a = signal(1);
    let bRuns = 0;
    let cRuns = 0;
    let dRuns = 0;
    const b = computed(() => {
      bRuns++;
      return a() * 2;
    });
    const c = computed(() => {
      cRuns++;
      return a() * 3;
    });
    const d = computed(() => {
      dRuns++;
      return b() + c();
    });
    const seen: number[] = [];
    effect(() => {
      seen.push(d());
    });

    expect(seen).toEqual([5]); // 1*2 + 1*3
    expect([bRuns, cRuns, dRuns]).toEqual([1, 1, 1]);

    a.set(2);
    expect(seen).toEqual([5, 10]); // 2*2 + 2*3 — single update, no glitch (no 8)
    expect([bRuns, cRuns, dRuns]).toEqual([2, 2, 2]); // each recomputed once
  });

  test("does not over-run a shared computed across many sinks", () => {
    const a = signal(0);
    let shared = 0;
    const s = computed(() => {
      shared++;
      return a() + 1;
    });
    effect(() => {
      s();
    });
    effect(() => {
      s();
    });
    expect(shared).toBe(1); // computed once, two readers
    a.set(1);
    expect(shared).toBe(2); // recomputed once despite two effects
  });
});

describe("dynamic dependencies", () => {
  test("unsubscribes from branches no longer read", () => {
    const toggle = signal(true);
    const a = signal("a");
    const b = signal("b");
    const seen: string[] = [];
    effect(() => {
      seen.push(toggle() ? a() : b());
    });

    expect(seen).toEqual(["a"]);

    a.set("a2");
    expect(seen).toEqual(["a", "a2"]);

    // Switch the branch: now we depend on b, not a.
    toggle.set(false);
    expect(seen).toEqual(["a", "a2", "b"]);

    // a is no longer a dependency — writing it must not re-run.
    a.set("a3");
    expect(seen).toEqual(["a", "a2", "b"]);

    // b is now a dependency.
    b.set("b2");
    expect(seen).toEqual(["a", "a2", "b", "b2"]);
  });
});

describe("custom equality", () => {
  test("equals:false always notifies", () => {
    const s = signal(0, { equals: false });
    const runs = mock(() => {
      s();
    });
    effect(runs);
    s.set(0); // same value, but equality disabled
    s.set(0);
    expect(runs).toHaveBeenCalledTimes(3);
  });

  test("custom comparator suppresses notifications", () => {
    // Compare points by value, not reference.
    const point = signal(
      { x: 0, y: 0 },
      { equals: (p, q) => p.x === q.x && p.y === q.y },
    );
    const runs = mock(() => {
      point();
    });
    effect(runs);
    point.set({ x: 0, y: 0 }); // structurally equal → no notify
    expect(runs).toHaveBeenCalledTimes(1);
    point.set({ x: 1, y: 0 });
    expect(runs).toHaveBeenCalledTimes(2);
  });
});

describe("safety", () => {
  test("effect writing a downstream signal still stabilizes", () => {
    // Mirror one signal into another via an effect — must not loop forever.
    const src = signal(0);
    const mirror = signal(-1);
    effect(() => {
      mirror.set(src());
    });
    expect(mirror()).toBe(0);
    src.set(5);
    expect(mirror()).toBe(5);
  });
});
