import { describe, expect, test } from "bun:test";
import { signal, mergeProps, splitProps } from "./index";

describe("mergeProps", () => {
  test("later sources win", () => {
    const m = mergeProps({ a: 1, b: 1 }, { b: 2, c: 3 });
    expect(m.a).toBe(1);
    expect(m.b).toBe(2);
    expect(m.c).toBe(3);
  });

  test("ignores null/undefined sources (defaults pattern)", () => {
    const m = mergeProps({ a: 1 }, undefined, null, { a: 2 });
    expect(m.a).toBe(2);
  });

  test("preserves reactivity of source getters", () => {
    const s = signal("x");
    const m = mergeProps({
      get v() {
        return s();
      },
    });
    expect(m.v).toBe("x");
    s.set("y");
    expect(m.v).toBe("y"); // read live through the forwarding getter
  });

  test("result keys are enumerable", () => {
    const m = mergeProps({ a: 1 }, { b: 2 });
    expect(Object.keys(m).sort()).toEqual(["a", "b"]);
  });
});

describe("splitProps", () => {
  test("splits into one group plus rest", () => {
    const fn = () => {};
    const props = { class: "x", id: "y", onClick: fn };
    const [local, rest] = splitProps(props, ["class"]);
    expect(local.class).toBe("x");
    expect("id" in local).toBe(false);
    expect(rest.id).toBe("y");
    expect(rest.onClick).toBe(fn);
    expect("class" in rest).toBe(false);
  });

  test("supports multiple groups", () => {
    const props = { a: 1, b: 2, c: 3, d: 4 };
    const [g1, g2, rest] = splitProps(props, ["a"], ["b", "c"]);
    expect(g1.a).toBe(1);
    expect(g2.b).toBe(2);
    expect(g2.c).toBe(3);
    expect(rest.d).toBe(4);
  });

  test("ignores group keys not present in props", () => {
    const props = { a: 1 } as { a: number; missing?: number };
    const [group, rest] = splitProps(props, ["missing"]);
    expect("missing" in group).toBe(false);
    expect(rest.a).toBe(1);
  });

  test("preserves reactivity", () => {
    const s = signal(1);
    const props = {
      get n() {
        return s();
      },
      k: 2,
    };
    const [local, rest] = splitProps(props, ["n"]);
    expect(local.n).toBe(1);
    s.set(5);
    expect(local.n).toBe(5);
    expect(rest.k).toBe(2);
  });

  // Compile-time: the return type is a precise tuple (Pick per group, then Omit
  // for the rest), checked by `bunx tsc` — each `@ts-expect-error` must mark a
  // real type error or the typecheck fails. The runtime body just satisfies the
  // suite and `noUnusedLocals`.
  test("the return type is a precise tuple of Pick…Omit", () => {
    const props = { a: 1, b: "x", c: true };
    const [g1, g2, rest] = splitProps(props, ["a"], ["b"]);
    // Picked keys are present and typed…
    const a: number = g1.a;
    const b: string = g2.b;
    const c: boolean = rest.c;
    // …and a non-picked key is *absent* from a group (not just `undefined`).
    // @ts-expect-error `b` is not in the first group's Pick
    void g1.b;
    // @ts-expect-error `a` was taken, so it's Omit-ted from the rest
    void rest.a;
    expect([a, b, c]).toEqual([1, "x", true]);
  });
});
