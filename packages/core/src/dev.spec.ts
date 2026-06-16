import { describe, expect, test, afterEach, spyOn } from "bun:test";
import {
  signal,
  computed,
  effect,
  onMount,
  onCleanup,
  createRoot,
  setDev,
  setWarnHandler,
} from "./index";
import { warn, isDev, __resetDev } from "./dev";

/** Collect warnings through a custom sink so the console stays clean. */
function captureWarnings(): string[] {
  const messages: string[] = [];
  setWarnHandler((m) => messages.push(m));
  return messages;
}

afterEach(() => {
  __resetDev();
  delete (globalThis as { __KANABUN_DEV__?: unknown }).__KANABUN_DEV__;
});

describe("dev warnings — gating & sink", () => {
  test("are off by default — warn() is a no-op", () => {
    const seen = captureWarnings();
    warn("should not appear");
    expect(seen).toEqual([]);
    expect(isDev()).toBe(false);
  });

  test("setDev(true) enables warnings, prefixed", () => {
    const seen = captureWarnings();
    setDev(true);
    expect(isDev()).toBe(true);
    warn("hello");
    expect(seen).toEqual(["kanabun [dev]: hello"]);
  });

  test("the ambient global __KANABUN_DEV__ also enables them", () => {
    const seen = captureWarnings();
    (globalThis as { __KANABUN_DEV__?: unknown }).__KANABUN_DEV__ = true;
    expect(isDev()).toBe(true);
    warn("ambient");
    expect(seen).toEqual(["kanabun [dev]: ambient"]);
  });

  test("each distinct message is emitted at most once (deduped)", () => {
    const seen = captureWarnings();
    setDev(true);
    warn("dup");
    warn("dup");
    warn("other");
    expect(seen).toEqual(["kanabun [dev]: dup", "kanabun [dev]: other"]);
  });

  test("setWarnHandler(null) restores the console.warn sink", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    setDev(true);
    setWarnHandler(null);
    warn("to console");
    expect(spy).toHaveBeenCalledWith("kanabun [dev]: to console");
    spy.mockRestore();
  });
});

describe("dev warnings — reactivity misuse", () => {
  test("effect() created outside an owner warns about disposal", () => {
    const seen = captureWarnings();
    setDev(true);
    const dispose = effect(() => {});
    dispose();
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("effect() was created outside any owner");
  });

  test("an effect created inside a root does NOT warn", () => {
    const seen = captureWarnings();
    setDev(true);
    createRoot((dispose) => {
      effect(() => {});
      dispose();
    });
    expect(seen).toEqual([]);
  });

  test("onCleanup() outside an owner warns it will never run", () => {
    const seen = captureWarnings();
    setDev(true);
    onCleanup(() => {});
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("onCleanup() was called outside an owner");
  });

  test("onMount() outside an owner warns it isn't tied to a lifecycle", () => {
    const seen = captureWarnings();
    setDev(true);
    onMount(() => {});
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("onMount() was called outside an owner");
  });

  test("writing a signal inside a computed warns about impurity", () => {
    const seen = captureWarnings();
    setDev(true);
    const a = signal(0);
    const b = signal(0);
    const c = computed(() => {
      b.set(a()); // impure: side effect inside a derivation
      return a();
    });
    c(); // force evaluation
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("a signal was written while a computed was evaluating");
  });

  test("writing a signal inside an effect does NOT warn", () => {
    const seen = captureWarnings();
    setDev(true);
    const a = signal(0);
    createRoot((dispose) => {
      effect(() => {
        a.set(1); // effects are allowed to write
      });
      dispose();
    });
    expect(seen).toEqual([]);
  });
});
