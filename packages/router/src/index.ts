/**
 * @kanabun/router — a history-based, signal-driven router.
 *
 * Zero runtime dependencies (standard Web APIs only), runtime-independent
 * (browser globals are resolved lazily), and built entirely on `@kanabun/core`'s
 * signals + owner-tree context. No virtual DOM, no compiler.
 */
export { Router, Route, Link, useNavigate, useLocation, useParams } from "./router";
export type {
  RouterProps,
  RouteProps,
  LinkProps,
  Navigate,
  NavigateOptions,
} from "./router";

export { createBrowserSource, createMemorySource } from "./source";
export type { RouterSource, MemorySource, WindowLike } from "./source";

export { parsePath, matchPath } from "./location";
export type { RouterLocation, RouteParams } from "./location";
