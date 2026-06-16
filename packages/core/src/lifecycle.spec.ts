import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx, onMount, onCleanup, createRoot } from "./index";
import { installDOM, createContainer, type MockNode } from "./dom-mock";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

const asEl = (n: MockNode) => n as unknown as Element;

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
