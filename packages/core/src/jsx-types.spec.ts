import { describe, expect, test } from "bun:test";
import type { JSX } from "./jsx-runtime";

/**
 * Compile-time assertions for the typed `on*` event handlers. These are checked
 * by `bunx tsc` (every `@ts-expect-error` must mark a *real* type error, or tsc
 * fails); the runtime body only exists so the suite has something to run and so
 * `noUnusedLocals` is satisfied. We assert against `IntrinsicElements["button"]`
 * — the attribute shape TS resolves for `<button …>`.
 */
type ButtonAttrs = JSX.IntrinsicElements["button"];

describe("JSX event-handler types", () => {
  test("a handler function (or no-arg thunk) is accepted", () => {
    const arrow: ButtonAttrs = { onClick: () => {} };
    const named: ButtonAttrs = { onClick: handleClick };
    // The event is typed: reading `e.key` off a KeyboardEvent is fine.
    const typed: ButtonAttrs = { onKeyDown: (e: KeyboardEvent) => void e.key };
    expect([arrow, named, typed]).toHaveLength(3);
  });

  test("undefined is allowed (a conditional handler is not a mistake)", () => {
    const enabled = false;
    const conditional: ButtonAttrs = { onClick: enabled ? handleClick : undefined };
    expect(conditional.onClick).toBeUndefined();
  });

  test("forgetting the arrow — passing the call's result — is a type error", () => {
    const set: (value: number) => void = () => {};
    // @ts-expect-error onClick wants a handler; `set(1)` is `void`, not a function
    const forgotArrow: ButtonAttrs = { onClick: set(1) };
    expect(forgotArrow).toBeDefined();
  });

  test("a non-function value is a type error", () => {
    // @ts-expect-error a number is not a valid event handler
    const wrong: ButtonAttrs = { onClick: 5 };
    expect(wrong).toBeDefined();
  });

  test("the wrong event type is a type error (handlers are contravariant)", () => {
    // @ts-expect-error a KeyboardEvent handler can't sit on a MouseEvent slot
    const mismatched: ButtonAttrs = { onClick: (e: KeyboardEvent) => void e.key };
    expect(mismatched).toBeDefined();
  });
});

type AnchorAttrs = JSX.IntrinsicElements["a"];
type InputAttrs = JSX.IntrinsicElements["input"];
type DivAttrs = JSX.IntrinsicElements["div"];

describe("JSX attribute types", () => {
  test("a typed attribute accepts its value or a reactive accessor of it", () => {
    const stat: AnchorAttrs = { href: "/users/42" };
    const reactive: AnchorAttrs = { href: () => "/users/42" };
    const cls: DivAttrs = { class: () => (true ? "on" : "off") };
    const checked: InputAttrs = { checked: () => true };
    expect([stat, reactive, cls, checked]).toHaveLength(4);
  });

  test("a wrongly-typed attribute value is a type error", () => {
    // @ts-expect-error `class` is a string attribute, not a number
    const badClass: DivAttrs = { class: 5 };
    // @ts-expect-error `disabled` is a boolean, not the string "yes"
    const badDisabled: ButtonAttrs = { disabled: "yes" };
    // @ts-expect-error `tabIndex` is a number, not a string
    const badTab: DivAttrs = { tabIndex: "3" };
    // @ts-expect-error a <button>'s type is the button-type union, not any string
    const badType: ButtonAttrs = { type: "email" };
    expect([badClass, badDisabled, badTab, badType]).toHaveLength(4);
  });

  test("per-element attributes are typed (input gets `checked`/`value`)", () => {
    const ok: InputAttrs = { type: "checkbox", checked: true, value: "x" };
    // @ts-expect-error `checked` is a boolean, not a string
    const bad: InputAttrs = { checked: "true" };
    expect([ok, bad]).toHaveLength(2);
  });

  test("unknown attributes (data-*/aria-*) stay permissive", () => {
    const data: DivAttrs = { "data-id": 7, "aria-label": "x", whatever: true };
    expect(data).toBeDefined();
  });
});

function handleClick(): void {}
