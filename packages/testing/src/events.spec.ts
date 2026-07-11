import { describe, expect, test } from "bun:test";
import { createContainer, type MockEvent } from "./dom-mock";
import { fireEvent, leftClick, setValue, typeAndEnter } from "./events";

type AnyEvent = MockEvent & Record<string, unknown>;

describe("fireEvent", () => {
  test("dispatches to listeners with init merged", () => {
    const el = createContainer("button");
    const seen: AnyEvent[] = [];
    el.addEventListener("change", (e) => seen.push(e as AnyEvent));
    const event = fireEvent(el, "change", { checked: true });
    expect(seen).toEqual([event as AnyEvent]);
    expect((event as AnyEvent).checked).toBe(true);
  });

  test("click carries the full leftClick payload and honors overrides", () => {
    const el = createContainer("a");
    const plain = fireEvent.click(el) as AnyEvent;
    expect(plain.button).toBe(0);
    expect(plain.metaKey).toBe(false);
    expect(plain.ctrlKey).toBe(false);
    expect(plain.shiftKey).toBe(false);
    expect(plain.altKey).toBe(false);
    const meta = fireEvent.click(el, { metaKey: true }) as AnyEvent;
    expect(meta.metaKey).toBe(true);
    expect(meta.button).toBe(0);
    expect(leftClick.button).toBe(0); // the payload itself is exported
  });

  test("keyDown sets the key and merges init", () => {
    const el = createContainer("input");
    const event = fireEvent.keyDown(el, "Escape", { shiftKey: true }) as AnyEvent;
    expect(event.type).toBe("keydown");
    expect(event.key).toBe("Escape");
    expect(event.shiftKey).toBe(true);
  });
});

describe("setValue / typeAndEnter", () => {
  test("setValue assigns the value property", () => {
    const input = createContainer("input");
    setValue(input, "hello");
    expect((input as unknown as { value: string }).value).toBe("hello");
  });

  test("typeAndEnter sets the value then presses Enter", () => {
    const input = createContainer("input");
    const keys: string[] = [];
    input.addEventListener("keydown", (e) => {
      keys.push(String((e as AnyEvent).key));
    });
    const event = typeAndEnter(input, "todo") as AnyEvent;
    expect((input as unknown as { value: string }).value).toBe("todo");
    expect(keys).toEqual(["Enter"]);
    expect(event.key).toBe("Enter");
  });
});
