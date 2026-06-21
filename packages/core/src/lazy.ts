/**
 * kanabun — `lazy()`
 * ------------------------------------------------------------------
 * Defer a component behind a dynamic `import()` so a bundler code-splits it at
 * the boundary and the chunk only loads when the component first renders. It is
 * `<Suspense>`'s missing partner: while the module loads, the component
 * suspends the nearest boundary (so its `fallback` shows); once loaded it
 * renders in place.
 *
 *     const Settings = lazy(() => import("./Settings"));
 *
 *     <Suspense fallback={<p>loading…</p>}>
 *       {() => <Settings user={user} />}
 *     </Suspense>
 *
 * The module is loaded **once** and cached — remounting reuses the resolved
 * component without re-importing. A failed import rejects the underlying
 * `resource` (read it via `resource.error` patterns / an `<ErrorBoundary>` is
 * not auto-wired, mirroring `resource`); the rejection is cached, so a later
 * mount surfaces the same error rather than silently retrying.
 *
 * As with everything that creates a resource, render the lazy component under a
 * `<Suspense>` via a **function** child so it finds the boundary.
 */
import { resource } from "./async";
import type { Component, JSXChild } from "./jsx-runtime";

/** The shape of a dynamic `import()` of a module with a default-exported component. */
export interface LazyModule<T extends Component> {
  default: T;
}

/**
 * Wrap a dynamic import of a component. Returns a component with the same props
 * that loads the real one on first render (suspending the nearest `<Suspense>`).
 */
export function lazy<T extends Component>(
  loader: () => Promise<LazyModule<T>>,
): (props: Parameters<T>[0]) => () => JSXChild {
  // Cache the import promise so the module is fetched at most once, no matter how
  // many instances mount or how often they remount.
  let cached: Promise<LazyModule<T>> | null = null;
  const load = (): Promise<LazyModule<T>> => (cached ??= loader());

  return (props) => {
    const [component] = resource<T>(() => load().then((mod) => mod.default));
    return () => {
      const Comp = component();
      return Comp ? (Comp(props) as JSXChild) : null;
    };
  };
}
