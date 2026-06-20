/**
 * kanabun — async primitives: `resource` (fetch-into-a-signal) and `<Suspense>`.
 * ------------------------------------------------------------------
 * `resource` turns an async function into reactive state: a value accessor plus
 * `loading`/`error` accessors and `{ mutate, refetch }` actions. It is race-safe
 * (a stale fetch never clobbers a newer one) and re-runs when its optional
 * reactive `source` changes.
 *
 * `<Suspense>` shows a `fallback` while any resource created in its subtree is
 * loading *for the first time*, then reveals the children. Only the initial load
 * suspends — a later `refetch()` keeps the last value on screen (read `loading()`
 * to show an inline spinner) — mirroring Solid's behaviour.
 *
 * Both ride the existing primitives (signals, the owner tree, context) so they
 * stay runtime-independent and add no dependencies. The convention is the usual
 * one: wrap `<Suspense>`'s children in a **function** so the resources inside are
 * created *under* the boundary (and so find it via context):
 *
 *     <Suspense fallback={<p>loading…</p>}>{() => <Profile />}</Suspense>
 *
 * `lazy(() => import("./X"))` defers a component behind a dynamic import so it can
 * be code-split. The returned component suspends the nearest `<Suspense>` until
 * the module's default export resolves, then renders it; a failed import surfaces
 * the error into the reactive graph (catchable by an `<ErrorBoundary>`).
 */
import { computed, effect, signal, untrack } from "./reactive";
import type { Accessor } from "./reactive";
import { createRoot, onCleanup } from "./lifecycle";
import { createContext, useContext } from "./context";
import type { JSXChild } from "./jsx-runtime";

// ── Suspense wiring ──────────────────────────────────────────────
/**
 * The contract a `resource` uses to tell the nearest `<Suspense>` it is (or is no
 * longer) blocking first paint. `<Suspense>` keeps a count of outstanding loads.
 */
interface SuspenseRegistry {
  increment(): void;
  decrement(): void;
}

/** Carries the nearest boundary's registry down the owner tree; `null` = none. */
const SuspenseContext = createContext<SuspenseRegistry | null>(null);

// ── resource ─────────────────────────────────────────────────────
/** Extra info handed to a fetcher: the last value and whether this is a refetch. */
export interface ResourceFetcherInfo<T> {
  /** The most recent resolved value, or `undefined` if it has never resolved. */
  value: T | undefined;
  /** `true` when triggered by `refetch()` (not the initial load or a source change). */
  refetching: boolean;
}

/** Loads a value, optionally from a reactive `source`. May be sync or async. */
export type ResourceFetcher<S, T> = (
  source: S,
  info: ResourceFetcherInfo<T>,
) => T | Promise<T>;

/**
 * The reactive read side of a resource. Call it to read the current value
 * (subscribing); `loading`/`error` are reactive accessors for the request state.
 */
export interface Resource<T> extends Accessor<T | undefined> {
  /** Reactive: `true` while a fetch is in flight. */
  readonly loading: Accessor<boolean>;
  /** Reactive: the error from the latest fetch, or `undefined`. */
  readonly error: Accessor<unknown>;
}

/** Imperative controls returned alongside a resource. */
export interface ResourceActions<T> {
  /** Overwrite the value directly (optimistic update); cancels any in-flight fetch. */
  mutate: (value: T) => void;
  /** Re-run the fetcher with the current source. No-op while the source is unready. */
  refetch: () => void;
}

/** `[resource, { mutate, refetch }]` — the tuple `resource()` returns. */
export type ResourceReturn<T> = [Resource<T>, ResourceActions<T>];

/** A source value `false`/`null`/`undefined` means "not ready — don't fetch yet". */
type SourceValue<S> = S | false | null | undefined;

/**
 * Create a resource from an async fetcher. Reading the resource subscribes to its
 * value; `loading()`/`error()` track the request.
 *
 * @example
 *   const [user] = resource(() => fetch(`/api/me`).then(r => r.json()));
 *   // with a reactive source — refetches whenever `id()` changes:
 *   const [post, { refetch }] = resource(id, (id) => fetchPost(id));
 */
export function resource<T>(fetcher: ResourceFetcher<true, T>): ResourceReturn<T>;
export function resource<T, S>(
  source: Accessor<SourceValue<S>>,
  fetcher: ResourceFetcher<S, T>,
): ResourceReturn<T>;
export function resource<T, S>(
  sourceOrFetcher: Accessor<SourceValue<S>> | ResourceFetcher<S, T>,
  maybeFetcher?: ResourceFetcher<S, T>,
): ResourceReturn<T> {
  const hasSource = maybeFetcher !== undefined;
  const source = (hasSource ? sourceOrFetcher : () => true) as Accessor<SourceValue<S>>;
  const fetcher = (hasSource ? maybeFetcher : sourceOrFetcher) as ResourceFetcher<S, T>;

  const value = signal<T | undefined>(undefined);
  const error = signal<unknown>(undefined);
  const loading = signal(false);

  // Find the nearest <Suspense> (if any) so we can block first paint while we load.
  const registry = useContext(SuspenseContext);
  let registered = false; // do we currently hold a count on that boundary?
  let resolvedOnce = false; // has a fetch ever succeeded? (gates re-suspending)
  let version = 0; // bumped per load; a resolution from an old version is stale.

  // Only the *first* load suspends a boundary; refetches keep the last value up.
  const acquire = (): void => {
    if (registry !== null && !registered && !resolvedOnce) {
      registry.increment();
      registered = true;
    }
  };
  const release = (): void => {
    if (registered) {
      registered = false;
      registry!.decrement();
    }
  };

  const load = (s: S, refetching: boolean): void => {
    const v = ++version;
    loading.set(true);
    acquire();
    const info: ResourceFetcherInfo<T> = { value: value.peek(), refetching };
    // Defer the call so a synchronous throw becomes a rejection and the loading
    // state is observable before the (possibly immediate) resolution.
    Promise.resolve()
      .then(() => fetcher(s, info))
      .then(
        (result) => {
          if (v !== version) return; // a newer load (or cancel) superseded us.
          value.set(result);
          error.set(undefined);
          loading.set(false);
          resolvedOnce = true;
          release();
        },
        (err) => {
          if (v !== version) return;
          error.set(err);
          loading.set(false);
          release();
        },
      );
  };

  if (hasSource) {
    // Re-run whenever the source changes; an unready source cancels and idles.
    effect(() => {
      const s = source();
      if (s === false || s === null || s === undefined) {
        version++; // cancel any in-flight load
        loading.set(false);
        release();
        return;
      }
      untrack(() => load(s as S, false));
    });
  } else {
    load(true as unknown as S, false);
  }

  // On disposal, ignore any in-flight resolution and let go of the boundary.
  onCleanup(() => {
    version++;
    release();
  });

  const data = (() => value()) as Resource<T>;
  const writable = data as { loading: Accessor<boolean>; error: Accessor<unknown> };
  writable.loading = () => loading();
  writable.error = () => error();

  const actions: ResourceActions<T> = {
    mutate: (next: T) => {
      version++; // cancel any in-flight load
      loading.set(false);
      error.set(undefined);
      release();
      resolvedOnce = true;
      value.set(next);
    },
    refetch: () => {
      const s = untrack(source);
      if (s === false || s === null || s === undefined) return;
      load(s as S, true);
    },
  };

  return [data, actions];
}

// ── Suspense ─────────────────────────────────────────────────────
export interface SuspenseProps {
  /** Shown while a child resource is loading for the first time. */
  fallback?: unknown;
  /** The guarded subtree. Wrap in a function so resources inside find the boundary. */
  children: unknown;
}

/**
 * Show `fallback` while any resource created in `children` is loading for the
 * first time, then reveal `children`. The children are built **once** (in their
 * own root, under this boundary's context) and kept alive while the fallback
 * shows — so their resources keep loading and are revealed in place, exactly like
 * `<Show>` with an element child. Wrap the children in a function (`{() => …}`)
 * so the resources are created *under* the boundary and register with it.
 */
export function Suspense(props: SuspenseProps): () => JSXChild {
  const pending = signal(0);
  const registry: SuspenseRegistry = {
    increment: () => pending.update((n) => n + 1),
    decrement: () => pending.update((n) => n - 1),
  };

  // Build the children once, under the boundary's context, in a disposable root.
  let children: JSXChild = null;
  const dispose = createRoot((d) => {
    children = SuspenseContext.Provider({
      value: registry,
      children: () => {
        const c = props.children;
        return typeof c === "function" ? (c as () => unknown)() : c;
      },
    }) as JSXChild;
    return d;
  });
  onCleanup(() => dispose());

  return () => (pending() > 0 ? (props.fallback ?? null) : children) as JSXChild;
}

// ── lazy ─────────────────────────────────────────────────────────
/**
 * A component whose props are `P`. The JSX transform enforces the real prop
 * shape at the call site; here it is intentionally loose (mirroring the JSX
 * runtime's `Component`).
 */
type LazyComponent<P> = (props: P) => unknown;

/** The shape `lazy()` returns: a component that also carries an eager `preload()`. */
export interface LazyComponentResult<P> {
  (props: P): unknown;
  /** Start (or reuse) the dynamic import without rendering — for prefetching. */
  preload: () => Promise<{ default: LazyComponent<P> }>;
}

/**
 * Defer a component behind a dynamic `import()` so the bundler can code-split it.
 * The returned component suspends the nearest `<Suspense>` while the module loads
 * *for the first time*, then renders the module's `default` export in place. A
 * failed import surfaces its error into the reactive graph (so an enclosing
 * `<ErrorBoundary>` can catch it).
 *
 * The import is started lazily on first render and the resulting promise is
 * cached, so multiple instances (or a `preload()`) share one network request.
 *
 * @example
 *   const Profile = lazy(() => import("./Profile"));
 *   <Suspense fallback={<p>loading…</p>}>{() => <Profile id={1} />}</Suspense>
 */
export function lazy<P = Record<string, unknown>>(
  loader: () => Promise<{ default: LazyComponent<P> }>,
): LazyComponentResult<P> {
  // The shared, cached import promise — created on the first preload()/render.
  // It never rejects: a failed import settles `failed` and resolves so callers
  // (multiple instances, `preload()`) share it without unhandled rejections.
  let promise: Promise<{ default: LazyComponent<P> }> | undefined;
  let resolved: LazyComponent<P> | undefined; // set once the module loads
  let failed: { error: unknown } | undefined; // set if the import rejects

  const preload = (): Promise<{ default: LazyComponent<P> }> => {
    if (promise === undefined) {
      promise = loader()
        .then((mod) => {
          resolved = mod.default;
        })
        .catch((err) => {
          failed = { error: err };
        })
        // Re-throw the captured failure so `preload()` callers that *await* it
        // still see the rejection, while the cached `promise` above is settled.
        .then(() => {
          if (failed !== undefined) throw failed.error;
          return { default: resolved! };
        });
    }
    return promise;
  };

  const Lazy = (props: P): unknown => {
    // Already settled (e.g. a second instance after the first load): render now.
    if (resolved !== undefined) return resolved(props);
    if (failed !== undefined) throw failed.error;

    const ready = signal(false); // module loaded?
    const errored = signal<{ error: unknown } | undefined>(undefined);

    // Register with the nearest <Suspense> so it shows its fallback while we load.
    const registry = useContext(SuspenseContext);
    let registered = false;
    if (registry !== null) {
      registry.increment();
      registered = true;
    }
    const release = (): void => {
      if (registered) {
        registered = false;
        registry!.decrement();
      }
    };

    let disposed = false;
    onCleanup(() => {
      disposed = true;
      release();
    });

    // Settle from the cached state (`resolved`/`failed`) rather than the promise's
    // rejection, so an instance never spawns an unhandled rejection of its own.
    preload().then(
      () => {
        if (disposed) return;
        release();
        ready.set(true);
      },
      () => {
        if (disposed) return;
        release();
        errored.set(failed);
      },
    );

    // Build the content inside a `computed` *owned by this component* (and thus
    // by the boundary above it). A bare reactive thunk returned to the caller is
    // re-inserted by the *outer* render effect, so a throw from it would escape
    // the enclosing `<ErrorBoundary>`; a `computed` keeps the throw on this
    // owner, where `catchError` routes it correctly. Nothing while loading, the
    // component once ready, or a throw on a failed import.
    const view = computed<unknown>(() => {
      const e = errored();
      if (e !== undefined) throw e.error;
      if (!ready()) return null;
      return untrack(() => resolved!(props));
    });
    return () => view();
  };

  (Lazy as LazyComponentResult<P>).preload = preload;
  return Lazy as LazyComponentResult<P>;
}
