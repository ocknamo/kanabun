/**
 * kanabun — control flow (`<Show>`, `<For>`) and the keyed `mapArray` it builds
 * on. These are ordinary components: they run once and return a reactive thunk
 * that the DOM runtime inserts and keeps up to date.
 */
import { batch, catchError, computed, signal } from "./reactive";
import { createRoot, onCleanup } from "./lifecycle";
import type { JSXChild } from "./jsx-runtime";

/**
 * Keyed array → nodes mapping. For each item (keyed by reference) a node is
 * created once and **reused** across updates; reordering reuses the same node,
 * removed items are disposed, new items are created in their own reactive root.
 * Returns a thunk producing the current node list (with stable identities) for
 * `reconcileNodes` to place efficiently.
 */
export function mapArray<T>(
  list: () => readonly T[],
  mapFn: (item: T, index: number) => Node,
): () => Node[] {
  let prevItems: T[] = [];
  let prevNodes: Node[] = [];
  let prevDisposers: Array<() => void> = [];

  // Dispose every live item when the owner (e.g. the enclosing render) tears down.
  onCleanup(() => {
    for (const dispose of prevDisposers) dispose();
  });

  return () => {
    const items = list();
    const n = items.length;
    const nodes: Node[] = new Array(n);
    const disposers: Array<() => void> = new Array(n);

    // Index previous positions by item reference (lists may contain duplicates).
    const prevPositions = new Map<T, number[]>();
    for (let i = 0; i < prevItems.length; i++) {
      const bucket = prevPositions.get(prevItems[i]!);
      if (bucket) bucket.push(i);
      else prevPositions.set(prevItems[i]!, [i]);
    }
    const reused: boolean[] = new Array(prevItems.length).fill(false);

    for (let i = 0; i < n; i++) {
      const item = items[i]!;
      // Each previous position lives in exactly one bucket and is taken once,
      // so shifting yields a fresh, not-yet-reused position (handles duplicates).
      const bucket = prevPositions.get(item);
      if (bucket !== undefined && bucket.length > 0) {
        const from = bucket.shift()!;
        reused[from] = true;
        nodes[i] = prevNodes[from]!;
        disposers[i] = prevDisposers[from]!;
      } else {
        let node!: Node;
        const dispose = createRoot((d) => {
          node = mapFn(item, i);
          return d;
        });
        nodes[i] = node;
        disposers[i] = dispose;
      }
    }

    // Dispose previous items that were not reused.
    for (let i = 0; i < prevDisposers.length; i++) {
      if (!reused[i]) prevDisposers[i]!();
    }

    prevItems = items.slice();
    prevNodes = nodes;
    prevDisposers = disposers;
    return nodes;
  };
}

export interface ShowProps {
  /** Condition (reactive). Rendered children show while truthy. */
  when: () => unknown;
  /** Optional content shown while the condition is falsy. */
  fallback?: unknown;
  children: unknown;
}

/**
 * Conditional rendering. Shows `children` while `when()` is truthy, otherwise
 * `fallback`. The boolean is memoized, so children are not swapped while the
 * condition merely changes among truthy values.
 *
 * Children disposal follows the framework's "functions are lazy" convention:
 *   - `<Show ...><Child/></Show>` — the child element is created once and only
 *     detached while hidden; its reactive scope stays live (keeps computing).
 *   - `<Show ...>{() => <Child/>}</Show>` — children wrapped in a function are
 *     created lazily, so hiding disposes the child's reactive scope and showing
 *     recreates it. Prefer this for expensive or self-contained subtrees.
 */
export function Show(props: ShowProps): () => JSXChild {
  const condition = computed(() => !!props.when());
  return () => (condition() ? props.children : (props.fallback ?? null)) as JSXChild;
}

export interface ForProps<T> {
  /** The list (reactive). */
  each: () => readonly T[] | null | undefined;
  /** Optional content shown when the list is empty. */
  fallback?: unknown;
  /** Renders one item. The returned node is reused across updates. */
  children: (item: T, index: number) => unknown;
}

/**
 * Keyed list rendering. Items are keyed by reference; a node is created once per
 * item and reused on reorder/insert/remove — no full rebuild.
 */
export function For<T>(props: ForProps<T>): () => JSXChild {
  const mapped = mapArray(
    () => props.each() ?? [],
    (item, index) => props.children(item, index) as Node,
  );
  return () => {
    const nodes = mapped();
    return (nodes.length > 0 ? nodes : (props.fallback ?? null)) as JSXChild;
  };
}

export interface ErrorBoundaryProps {
  /**
   * Shown when a child throws. Either a static node, or a function receiving the
   * thrown error and a `reset` callback that clears the error and rebuilds the
   * children from scratch.
   */
  fallback: unknown | ((err: unknown, reset: () => void) => unknown);
  /** The guarded subtree. */
  children: unknown;
}

/**
 * Catches errors thrown while **creating** *or* **reactively updating** its
 * children and renders `fallback` instead of letting them crash the whole app.
 * Built on {@link catchError}: a throw from any descendant computation is routed
 * up the owner tree to here. The `reset` handed to a function `fallback` clears
 * the error and recreates the children.
 *
 * As with `<Show>`/context, wrap the children in a **function** so their
 * *creation* is guarded too (a plain child is built eagerly, before the boundary
 * runs, so only its later *updates* would be caught):
 *
 *     <ErrorBoundary fallback={(err) => <p>oops: {String(err)}</p>}>
 *       {() => <App />}
 *     </ErrorBoundary>
 */
export function ErrorBoundary(props: ErrorBoundaryProps): () => JSXChild {
  const failure = signal<{ readonly err: unknown } | null>(null);

  // The guarded children live in their *own* disposable root and are built once
  // (and again on `reset`) — crucially **not** on every render. That isolation
  // is what keeps a thrown error from rebuilding the subtree: were the children
  // rebuilt inside the render thunk, a nested boundary's `failure` would re-run
  // the parent's slot, recreate the nested boundary (clearing its caught error),
  // and re-throw forever. `catchError` registers the handler on the owner tree,
  // so an error from creating the children now — or from a later update — routes
  // here. The build is wrapped in `batch` so disposing the old children, clearing
  // the error, and rebuilding settle before the boundary re-renders.
  let dispose: (() => void) | null = null;
  let children: JSXChild = null;
  const build = (): void => {
    batch(() => {
      dispose?.();
      failure.set(null);
      dispose = createRoot((d) => {
        children = catchError(
          () => {
            const c = props.children;
            return typeof c === "function" ? (c as () => unknown)() : c;
          },
          (err) => {
            if (failure.peek() === null) failure.set({ err });
          },
        ) as JSXChild;
        return d;
      });
    });
  };
  onCleanup(() => dispose?.());

  const reset = (): void => build();
  const renderFallback = (err: unknown): JSXChild => {
    const fb = props.fallback;
    return (
      typeof fb === "function"
        ? (fb as (e: unknown, r: () => void) => unknown)(err, reset)
        : fb
    ) as JSXChild;
  };

  build(); // initial, eager build in its own root
  // The render thunk *chooses* between the (already built) children and the
  // fallback, reading `failure` so a later throw or a `reset` re-renders it. On a
  // failure it also tears down the broken children's root (the same disposal the
  // router's slot does) so the dead subtree stops reacting to unrelated updates;
  // `reset` rebuilds it.
  return () => {
    const f = failure();
    if (f === null) return children;
    if (dispose !== null) {
      dispose();
      dispose = null;
    }
    return renderFallback(f.err);
  };
}
