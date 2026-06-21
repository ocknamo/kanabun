/**
 * @kanabun/core — runtime-independent reactive core.
 *
 * No runtime dependencies: standard JS / Web APIs only, so this package is
 * safe to ship to any browser. Bun is used only by the (future) CLI/dev
 * layer, never here.
 */
export { signal, computed, effect, batch, untrack, catchError } from "./reactive";
export type { Accessor, Signal, SignalOptions, Disposer } from "./reactive";
export { onCleanup, onMount, createRoot } from "./lifecycle";
export { createContext, useContext } from "./context";
export type { Context } from "./context";

// Component prop helpers.
export { mergeProps, splitProps } from "./props";
export type { SplitProps } from "./props";

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

// Ecosystem primitives: code-split (`lazy`), teleport (`<Portal>`), runtime host
// (`<Dynamic>`), and the document head API (`<Head>` / `<Title>`).
export { lazy } from "./lazy";
export type { LazyModule } from "./lazy";
export { Portal } from "./portal";
export type { PortalProps } from "./portal";
export { Dynamic } from "./dynamic";
export type { DynamicProps, DynamicComponent } from "./dynamic";
export { Head, Title } from "./head";
export type { HeadProps, TitleProps } from "./head";

// Islands: explicit partial hydration (server marks boundaries, the client
// hydrates only those). The per-island bundle split lives in the CLI.
export { Island, registerIsland, hydrateIslands } from "./islands";
export type {
  IslandComponent,
  IslandProps,
  IslandRegistry,
  IslandBoundaryProps,
  HydrateIslandsOptions,
} from "./islands";

// Scoped CSS (runtime helper: hashes a class + injects a <style>).
export { css } from "./css";

// Dev-time warnings (opt-in diagnostics; `kanabun dev` enables them for you).
export { setDev, setWarnHandler } from "./dev";

// JSX runtime, also re-exported here for manual / hyperscript-style use.
export { jsx, jsxs, Fragment } from "./jsx-runtime";
export type {
  JSXChild,
  JSX,
  EventHandler,
  DOMEventHandlers,
  Reactive,
  Attr,
  StyleValue,
  StyleObject,
  Ref,
  HTMLAttributes,
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  OptionHTMLAttributes,
  FormHTMLAttributes,
  LabelHTMLAttributes,
  ImgHTMLAttributes,
  ScriptHTMLAttributes,
  LinkHTMLAttributes,
  MediaHTMLAttributes,
  VideoHTMLAttributes,
  OlHTMLAttributes,
  TableCellHTMLAttributes,
  ThHTMLAttributes,
  ProgressHTMLAttributes,
  CanvasHTMLAttributes,
} from "./jsx-runtime";
