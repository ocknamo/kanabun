import { describe, expect, test } from "bun:test";
import { jsx, onMount } from "@kanabun/core";
import { renderTest } from "./render";
import { deferred, tick } from "./async";

describe("tick", () => {
  test("flushes queued microtasks", async () => {
    let ran = false;
    queueMicrotask(() => {
      ran = true;
    });
    await tick();
    expect(ran).toBe(true);
  });

  test("flushes zero-delay timeouts", async () => {
    let ran = false;
    setTimeout(() => {
      ran = true;
    }, 0);
    await tick();
    expect(ran).toBe(true);
  });

  test("deferred resolves its promise from the outside", async () => {
    const d = deferred<number>();
    let settled: number | undefined;
    void d.promise.then((v) => {
      settled = v;
    });
    expect(settled).toBeUndefined(); // still pending until the test says so
    d.resolve(42);
    await tick();
    expect(settled).toBe(42);
  });

  test("deferred rejects its promise from the outside", async () => {
    const d = deferred<never>();
    let reason: unknown;
    d.promise.catch((r) => {
      reason = r;
    });
    d.reject(new Error("boom"));
    await tick();
    expect((reason as Error).message).toBe("boom");
  });

  test("makes onMount observable after render", async () => {
    let mounted = false;
    const result = renderTest(() => {
      const App = () => {
        onMount(() => {
          mounted = true;
        });
        return jsx("div", { children: "app" });
      };
      return jsx(App as never, {});
    });
    expect(mounted).toBe(false); // onMount is queued, not synchronous
    await tick();
    expect(mounted).toBe(true);
    result.dispose();
  });
});
