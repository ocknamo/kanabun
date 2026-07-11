/**
 * Integration test: drives the *actual* TodoMVC example component end-to-end
 * (no reduced re-implementation), so the example's real wiring — Enter-to-add,
 * checkbox toggle, filter buttons, destroy button, clear-completed — is
 * behaviorally verified, not just compiled.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { render, jsx } from "./index";
import { TodoApp } from "../../../examples/todomvc/app";
import {
  installDOM,
  createContainer,
  asEl,
  hasClass,
  queryAllByTag as byTag,
  queryByClass as oneByClass,
  typeAndEnter as enter,
  type MockNode,
} from "@kanabun/testing";

let teardown: () => void;
beforeEach(() => {
  teardown = installDOM();
});
afterEach(() => {
  teardown();
});

// App-specific lookups over the shared query helpers.
const titles = (root: MockNode) =>
  byTag(root, "span")
    .filter((s) => hasClass(s, "title"))
    .map((s) => s.textContent);
const checkboxes = (root: MockNode) =>
  byTag(root, "input").filter((n) => n.getAttribute("type") === "checkbox");
const filterButton = (root: MockNode, label: string) =>
  byTag(root, "button").find(
    (b) => hasClass(b, "destroy") === false && b.textContent === label,
  );
const liByTitle = (root: MockNode, title: string) =>
  byTag(root, "li").find((li) =>
    byTag(li, "span").some((s) => hasClass(s, "title") && s.textContent === title),
  );

function typeAndEnter(root: MockNode, text: string): void {
  enter(oneByClass(root, "new-todo")!, text);
}

describe("TodoMVC example (real component)", () => {
  test("add, toggle, filter, destroy, and clear completed", () => {
    const container = createContainer();
    render(() => jsx(TodoApp, {}), asEl(container));

    // Empty: fallback shown, count 0, no clear button.
    expect(titles(container)).toEqual([]);
    expect(oneByClass(container, "empty")).toBeDefined();
    expect(oneByClass(container, "todo-count")!.textContent).toContain("0 items left");
    expect(oneByClass(container, "clear-completed")).toBeUndefined();

    // Add via the input + Enter; whitespace-only is ignored.
    typeAndEnter(container, "write core");
    typeAndEnter(container, "ship it");
    typeAndEnter(container, "   ");
    expect(titles(container)).toEqual(["write core", "ship it"]);
    expect(oneByClass(container, "todo-count")!.textContent).toContain("2 items left");

    // Toggle the first via its checkbox change event.
    checkboxes(container)[0]!.dispatch("change");
    expect(liByTitle(container, "write core")!.getAttribute("class")).toBe("completed");
    expect(oneByClass(container, "todo-count")!.textContent).toContain("1 item left");
    expect(oneByClass(container, "clear-completed")).toBeDefined();

    // Filter buttons.
    filterButton(container, "active")!.dispatch("click");
    expect(titles(container)).toEqual(["ship it"]);
    filterButton(container, "completed")!.dispatch("click");
    expect(titles(container)).toEqual(["write core"]);
    filterButton(container, "all")!.dispatch("click");
    expect(titles(container)).toEqual(["write core", "ship it"]);

    // Destroy "ship it" via its button.
    const shipLi = liByTitle(container, "ship it")!;
    byTag(shipLi, "button")[0]!.dispatch("click"); // the .destroy button
    expect(titles(container)).toEqual(["write core"]);

    // Clear completed removes the done "write core".
    oneByClass(container, "clear-completed")!.dispatch("click");
    expect(titles(container)).toEqual([]);
    expect(oneByClass(container, "empty")).toBeDefined();
    expect(oneByClass(container, "clear-completed")).toBeUndefined();
  });
});
