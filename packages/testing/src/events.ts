/**
 * Event helpers over the mock's synchronous `dispatch`. `fireEvent` is a thin
 * wrapper; `MockNode.dispatch` stays available for anything not covered here.
 */
import { type MockEvent, type MockNode } from "./dom-mock";

/** A left-click event payload the mock dispatcher (and `<Link>`) understands. */
export const leftClick = {
  button: 0,
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

function fire(
  node: MockNode,
  type: string,
  init?: Record<string, unknown>,
): MockEvent {
  return node.dispatch(type, init);
}

export const fireEvent = Object.assign(fire, {
  /** Dispatch a plain left click (merge `init` over the `leftClick` payload). */
  click: (node: MockNode, init?: Record<string, unknown>): MockEvent =>
    fire(node, "click", { ...leftClick, ...init }),
  /** Dispatch a `keydown` carrying `key`. */
  keyDown: (
    node: MockNode,
    key: string,
    init?: Record<string, unknown>,
  ): MockEvent => fire(node, "keydown", { key, ...init }),
});

/** Set an input-like node's `value` property (the mock has no value handling). */
export function setValue(node: MockNode, value: string): void {
  (node as MockNode & { value?: string }).value = value;
}

/** Type into an input and press Enter — the "submit a text field" gesture. */
export function typeAndEnter(input: MockNode, text: string): MockEvent {
  setValue(input, text);
  return fireEvent.keyDown(input, "Enter");
}
