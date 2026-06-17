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
  onMount,
  createRoot,
  createContext,
  useContext,
  catchError,
} from "./reactive";
export type { Accessor, Signal, SignalOptions, Disposer, Context } from "./reactive";

// Component prop helpers.
export { mergeProps, splitProps } from "./props";

// DOM runtime (render + the low-level helpers the JSX runtime builds on).
export { render, hydrate, createElement, insert, reconcileNodes } from "./dom";
export type { Props } from "./dom";

// Server rendering (SSR / SSG): render to an HTML string, no real DOM needed.
export { renderToString } from "./server";
export type { RenderToStringResult } from "./server";

// Control flow.
export { Show, For, mapArray, ErrorBoundary } from "./control-flow";
export type { ShowProps, ForProps, ErrorBoundaryProps } from "./control-flow";

// Async: `resource` (fetch-into-a-signal) + `<Suspense>`.
export { resource, Suspense } from "./async";
export type {
  Resource,
  ResourceActions,
  ResourceFetcher,
  ResourceFetcherInfo,
  ResourceReturn,
  SuspenseProps,
} from "./async";

// Scoped CSS (runtime helper: hashes a class + injects a <style>).
export { css } from "./css";

// Dev-time warnings (opt-in diagnostics; `kanabun dev` enables them for you).
export { setDev, setWarnHandler } from "./dev";

// JSX runtime, also re-exported here for manual / hyperscript-style use.
export { jsx, jsxs, Fragment } from "./jsx-runtime";
export type { JSXChild, JSX, EventHandler, HTMLAttributes } from "./jsx-runtime";
