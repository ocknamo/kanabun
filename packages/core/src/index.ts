/**
 * @kanabun/core — runtime-independent reactive core.
 *
 * No runtime dependencies: standard JS / Web APIs only, so this package is
 * safe to ship to any browser. Bun is used only by the (future) CLI/dev
 * layer, never here.
 */
export {
  signal,
  computed,
  effect,
  batch,
  untrack,
  onCleanup,
  createRoot,
} from "./reactive";
export type { Accessor, Signal, SignalOptions, Disposer } from "./reactive";

// DOM runtime (render + the low-level helpers the JSX runtime builds on).
export { render, createElement, insert } from "./dom";
export type { Props } from "./dom";

// JSX runtime, also re-exported here for manual / hyperscript-style use.
export { jsx, jsxs, Fragment } from "./jsx-runtime";
export type { JSXChild, JSX } from "./jsx-runtime";
