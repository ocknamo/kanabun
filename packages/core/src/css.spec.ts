import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { css } from "./index";
import { installDOM, styles, ruleFor } from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

describe("css", () => {
  test("returns a stable k-<hash> class and injects one <style>", () => {
    const cls = css`color: red;`;
    expect(cls).toMatch(/^k-[0-9a-z]+$/);
    expect(styles().length).toBe(1);
    expect(ruleFor(cls)).toBe(`.${cls}{color: red;}`);
  });

  test("same body dedupes (same class, single <style>)", () => {
    const a = css`color: red;`;
    const b = css`color: red;`;
    expect(a).toBe(b);
    expect(styles().length).toBe(1);
  });

  test("different bodies get different classes and separate <style>s", () => {
    const a = css`color: red;`;
    const b = css`color: blue;`;
    expect(a).not.toBe(b);
    expect(styles().length).toBe(2);
    // Injecting `a` again still dedupes against the existing element.
    css`color: red;`;
    expect(styles().length).toBe(2);
  });

  test("nested `&` is replaced by the scope class", () => {
    const cls = css`
      color: red;
      &:hover { color: blue; }
    `;
    expect(ruleFor(cls)).toBe(`.${cls}{color: red;}.${cls}:hover{color: blue;}`);
  });

  test("a nested block without `&` becomes a descendant", () => {
    const cls = css`.icon { margin: 0; }`;
    expect(ruleFor(cls)).toBe(`.${cls} .icon{margin: 0;}`);
  });

  test("a block-only body emits no top-level rule", () => {
    const cls = css`.icon { margin: 0; }`;
    // No `.k-hash { … }` wrapper, only the descendant rule.
    expect(ruleFor(cls).startsWith(`.${cls} .icon`)).toBe(true);
  });

  test("comma selector lists scope each part (commas in `()` kept)", () => {
    const cls = css`
      &.a, .b:not(.c, .d) { color: red; }
    `;
    expect(ruleFor(cls)).toBe(
      `.${cls}.a,.${cls} .b:not(.c, .d){color: red;}`,
    );
  });

  test("nesting recurses to arbitrary depth", () => {
    const cls = css`.a { .b { color: red; } }`;
    expect(ruleFor(cls)).toBe(`.${cls} .a .b{color: red;}`);
  });

  test("@media re-scopes its inner rules", () => {
    const cls = css`
      color: red;
      @media (min-width: 40rem) { padding: 1rem; }
    `;
    expect(ruleFor(cls)).toBe(
      `.${cls}{color: red;}@media (min-width: 40rem){.${cls}{padding: 1rem;}}`,
    );
  });

  test("@keyframes is passed through verbatim (not scoped)", () => {
    const cls = css`@keyframes spin { to { transform: rotate(360deg); } }`;
    expect(ruleFor(cls)).toBe(
      `@keyframes spin{to { transform: rotate(360deg); }}`,
    );
  });

  test("declarations after a block are still scoped", () => {
    const cls = css`.a { color: red; } margin: 0;`;
    expect(ruleFor(cls)).toBe(`.${cls}{margin: 0;}.${cls} .a{color: red;}`);
  });

  test("supports tagged-template interpolation (stringified)", () => {
    const color = "tomato";
    const size = 12;
    const cls = css`color: ${color}; font-size: ${size}px;`;
    expect(ruleFor(cls)).toBe(`.${cls}{color: tomato; font-size: 12px;}`);
  });

  test("can be called with a plain string", () => {
    const cls = css("color: green;");
    expect(ruleFor(cls)).toBe(`.${cls}{color: green;}`);
  });

  test("an empty body injects an empty rule set", () => {
    const cls = css``;
    expect(cls).toMatch(/^k-[0-9a-z]+$/);
    expect(ruleFor(cls)).toBe("");
  });

  test("tolerates an unbalanced closing brace", () => {
    const cls = css`color: red; }`;
    expect(ruleFor(cls)).toBe(`.${cls}{color: red;}`);
  });

  // ── Documented limitations, pinned so a future parser change is noticed ──

  test("a declaration before a block must be `;`-terminated (else absorbed)", () => {
    // Missing the `;` after `red`: it's swallowed into the selector prelude
    // (matches Sass / native CSS nesting), producing a garbage selector rather
    // than a declaration. This locks the documented behaviour.
    const cls = css`color: red &:hover { color: blue; }`;
    expect(ruleFor(cls)).toBe(`color: red .${cls}:hover{color: blue;}`);
  });

  test("top-level declarations after a block are hoisted ahead of it", () => {
    const cls = css`color: red; @media (x) { padding: 1rem; } margin: 0;`;
    // `margin: 0` (written after @media) joins the leading rule.
    expect(ruleFor(cls)).toBe(
      `.${cls}{color: red; margin: 0;}@media (x){.${cls}{padding: 1rem;}}`,
    );
  });

  test("a literal brace inside a string breaks lexical matching (documented)", () => {
    const cls = css`content: "}";`;
    // The `}` is misread as a block end and dropped, truncating the value.
    expect(ruleFor(cls)).toBe(`.${cls}{content: "";}`);
  });
});
