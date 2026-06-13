/**
 * Integration test: a compact TodoMVC driven end-to-end through the framework
 * (signals + <For> + <Show> + reactive attributes + events). This is the
 * Phase 3 "TodoMVC runs" proof — composition, not just primitives.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { signal, computed, render, jsx, For, Show } from "../src/index";
import type { Signal } from "../src/index";
import { installDOM, createContainer, type MockNode } from "./dom-mock";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

const asEl = (n: MockNode) => n as unknown as Element;

interface Todo {
  id: number;
  title: string;
  done: Signal<boolean>;
}
type Filter = "all" | "active" | "completed";

function makeApp() {
  const todos = signal<Todo[]>([]);
  const filter = signal<Filter>("all");
  let nextId = 1;

  const remaining = computed(() => todos().filter((t) => !t.done()).length);
  const anyDone = computed(() => todos().some((t) => t.done()));
  const visible = computed(() => {
    const f = filter();
    return todos().filter((t) =>
      f === "active" ? !t.done() : f === "completed" ? t.done() : true,
    );
  });

  const add = (title: string) =>
    todos.update((l) => [...l, { id: nextId++, title, done: signal(false) }]);
  const clearCompleted = () => todos.update((l) => l.filter((t) => !t.done()));

  const view = () =>
    jsx("main", {
      children: [
        jsx("ul", {
          children: jsx(For, {
            each: () => visible(),
            children: (t: Todo) =>
              jsx("li", {
                class: () => (t.done() ? "completed" : ""),
                children: [
                  jsx("input", {
                    type: "checkbox",
                    checked: () => t.done(),
                    onChange: () => t.done.update((d) => !d),
                  }),
                  jsx("span", { class: "title", children: t.title }),
                ],
              }),
          }),
        }),
        jsx("span", { class: "count", children: () => remaining() }),
        jsx(Show, {
          when: () => anyDone(),
          children: jsx("button", {
            class: "clear",
            onClick: clearCompleted,
            children: "Clear completed",
          }),
        }),
      ],
    });

  return { todos, filter, add, view };
}

// Recursive query helpers (the mock has no querySelector).
function walk(node: MockNode, out: MockNode[] = []): MockNode[] {
  out.push(node);
  for (const child of node.childNodes) walk(child, out);
  return out;
}
const allByTag = (root: MockNode, tag: string): MockNode[] =>
  walk(root).filter((n) => n.nodeType === 1 && n.tagName.toLowerCase() === tag);
const oneByClass = (root: MockNode, cls: string): MockNode | undefined =>
  walk(root).find((n) => n.nodeType === 1 && n.getAttribute("class") === cls);
const titles = (root: MockNode) =>
  allByTag(root, "span")
    .filter((s) => s.getAttribute("class") === "title")
    .map((s) => s.textContent);
const liCount = (root: MockNode) => allByTag(root, "li").length;

describe("TodoMVC (integration)", () => {
  test("add, toggle, filter, and clear completed", () => {
    const app = makeApp();
    const container = createContainer();
    render(app.view, asEl(container));

    // Initially empty: no items, count 0, no Clear button.
    expect(liCount(container)).toBe(0);
    expect(oneByClass(container, "count")!.textContent).toBe("0");
    expect(oneByClass(container, "clear")).toBeUndefined();

    // Add two todos.
    app.add("write core");
    app.add("ship it");
    expect(liCount(container)).toBe(2);
    expect(titles(container)).toEqual(["write core", "ship it"]);
    expect(oneByClass(container, "count")!.textContent).toBe("2");

    // Toggle the first via its checkbox event.
    const firstBox = allByTag(container, "input")[0]!;
    const firstLi = allByTag(container, "li")[0]!;
    firstBox.dispatch("change");
    expect(firstLi.getAttribute("class")).toBe("completed"); // reactive class
    expect(oneByClass(container, "count")!.textContent).toBe("1"); // remaining
    expect(oneByClass(container, "clear")).toBeDefined(); // Show revealed it

    // Filter to active: only the not-done todo remains visible.
    app.filter.set("active");
    expect(titles(container)).toEqual(["ship it"]);

    // Filter to completed: only the done one.
    app.filter.set("completed");
    expect(titles(container)).toEqual(["write core"]);

    // Back to all, then clear completed removes the done todo.
    app.filter.set("all");
    expect(liCount(container)).toBe(2);
    oneByClass(container, "clear")!.dispatch("click");
    expect(titles(container)).toEqual(["ship it"]);
    expect(oneByClass(container, "count")!.textContent).toBe("1");
    expect(oneByClass(container, "clear")).toBeUndefined(); // nothing done now
  });

  test("keyed items keep their checkbox state when the list reorders", () => {
    const app = makeApp();
    const container = createContainer();
    render(app.view, asEl(container));
    app.add("a");
    app.add("b");

    // Complete "a".
    allByTag(container, "input")[0]!.dispatch("change");
    const aLi = allByTag(container, "li")[0]!;

    // Reorder by replacing the array order (b, a).
    app.todos.update((l) => [l[1]!, l[0]!]);

    // "a" is now second, still completed and the same DOM node.
    const lis = allByTag(container, "li");
    expect(lis[1]).toBe(aLi); // same node reused
    expect(lis[1]!.getAttribute("class")).toBe("completed");
    expect(titles(container)).toEqual(["b", "a"]);
  });
});
