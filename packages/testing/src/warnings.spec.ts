import { afterEach, describe, expect, test } from "bun:test";
import { effect, setDev, setWarnHandler } from "@kanabun/core";
import { captureWarnings } from "./warnings";

// This package registers no runner hooks, so cleanup is wired here (the
// caller's side): restore the default console sink and turn dev mode off.
afterEach(() => {
  setWarnHandler(null);
  setDev(false);
});

describe("captureWarnings", () => {
  test("collects dev warnings into the returned array", () => {
    const seen = captureWarnings();
    setDev(true);
    const dispose = effect(() => {}); // owner-less: a canonical dev warning
    dispose();
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain("effect() was created outside any owner");
  });
});
