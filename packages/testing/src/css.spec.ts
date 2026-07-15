import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { docHead, installDOM, MockDocument } from "./dom-mock";
import { ruleFor, styles } from "./css";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

// A detached factory document — the nodes are plain MockNodes, so they can be
// appended into the *installed* document's head without touching globals.
const factory = new MockDocument();

/** Append a `<style data-k=…>` to `<head>` the way core's `css` does. */
function injectStyle(hash: string, text: string): void {
  const style = factory.createElement("style");
  style.setAttribute("data-k", hash);
  style.textContent = text;
  docHead().appendChild(style);
}

describe("styles", () => {
  test("lists injected <style>s as [data-k, cssText] in document order", () => {
    injectStyle("abc", ".k-abc{color: red;}");
    injectStyle("def", ".k-def{color: blue;}");
    expect(styles()).toEqual([
      ["abc", ".k-abc{color: red;}"],
      ["def", ".k-def{color: blue;}"],
    ]);
  });

  test("ignores non-<style> head content (e.g. <Head> output)", () => {
    docHead().appendChild(factory.createElement("meta"));
    injectStyle("abc", "");
    expect(styles()).toEqual([["abc", ""]]);
  });
});

describe("ruleFor", () => {
  test("returns the single rule text for a k-<hash> class", () => {
    injectStyle("abc", ".k-abc{color: red;}");
    expect(ruleFor("k-abc")).toBe(".k-abc{color: red;}");
  });

  test("throws when no rule matches", () => {
    expect(() => ruleFor("k-abc")).toThrow(
      'ruleFor("k-abc"): expected exactly one injected <style>, found 0',
    );
  });

  test("throws when the rule is duplicated (dedupe broke)", () => {
    injectStyle("abc", "");
    injectStyle("abc", "");
    expect(() => ruleFor("k-abc")).toThrow("found 2");
  });
});
