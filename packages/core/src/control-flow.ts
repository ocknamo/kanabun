/**
 * kanabun — control flow (`<Show>`, `<For>`) and the keyed `mapArray` it builds
 * on. These are ordinary components: they run once and return a reactive thunk
 * that the DOM runtime inserts and keeps up to date.
 */
import { computed, createRoot, onCleanup } from "./reactive";
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
