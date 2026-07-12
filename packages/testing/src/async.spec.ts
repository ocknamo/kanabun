import { describe, expect, test } from "bun:test";
import { jsx, onMount } from "@kanabun/core";
import { renderTest } from "./render";
import { tick } from "./async";

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
