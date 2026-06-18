/**
 * kanabun — reactive core
 * ------------------------------------------------------------------
 * A glitch-free, lazily-evaluated signals implementation with **no
 * runtime dependencies** (standard JS only — safe to ship to any
 * browser or runtime). The public surface is intentionally tiny:
 *
 *   signal(value)   writable reactive state   →  read s(), write s.set(v)
 *   computed(fn)    derived read-only value    →  read c()
 *   effect(fn)      side effect that re-runs    →  returns a disposer
 *   batch(fn)       group writes, flush once
 *   untrack(fn)     read without subscribing
 *   onCleanup(fn)   register teardown for the running effect/computed
 *
 * Propagation uses the push–pull "coloring" scheme popularised by
 * Reactively/Solid. A write *pushes* a "maybe-stale" color downstream;
 * a read *pulls* by re-validating only the nodes that could have
 * changed. This buys us two properties that are painful to bolt on
 * later (hence nailed down here, in Phase 1):
 *
 *   - glitch-free: a node is never observed in an inconsistent
 *     intermediate state, and never recomputes more than once per
 *     stabilization (the classic "diamond" problem is handled).
 *   - laziness: a computed only recomputes when it is actually read.
 *
 * The reactive graph is deliberately untyped internally (`unknown`):
 * the node only ever compares and stores opaque values. Static typing
 * lives entirely in the public `signal`/`computed`/`effect` wrappers,
 * which keeps the propagation core free of generic-variance friction.
 */
import { warn } from "./dev";

// ── Node colors ───────────────────────────────────────────────────
const CLEAN = 0; // up to date
const CHECK = 1; // a transitive source may have changed — re-validate sources
const DIRTY = 2; // a direct source changed — must recompute
const DISPOSED = 3; // torn down — inert

type Color = 0 | 1 | 2 | 3;

// ── Global tracking context ──────────────────────────────────────
/** The node currently executing its `fn` (records dependencies). */
let listener: ReactiveNode | null = null;
/**
 * The node that *owns* computations created during the current run. Separate
 * from `listener`: `untrack` suspends dependency tracking but ownership is
 * preserved, and `createRoot` establishes ownership without tracking. Owned
 * children are disposed when the owner re-runs or is disposed.
 */
let currentOwner: ReactiveNode | null = null;
/** Outermost-batch depth; while > 0 effects are deferred. */
let batchDepth = 0;
/** Guards against re-entrant flushes (an effect writing a signal). */
let flushing = false;
/** Effects scheduled to run on the next flush, in registration order. */
const effectQueue: ReactiveNode[] = [];

/**
 * Safety valve: if effects keep re-scheduling one another we fail loudly
 * instead of hanging the host. Generous enough to never trip on real graphs.
 */
const MAX_FLUSH_ITERATIONS = 1_000_000;

// ── Equality ─────────────────────────────────────────────────────
export interface SignalOptions<T> {
  /**
   * Custom equality used to decide whether a new value should notify
   * observers. `false` disables equality entirely (every write notifies).
   * Defaults to `===` (referential / value identity).
   */
  equals?: ((a: T, b: T) => boolean) | false;
}

type EqualsFn = (a: unknown, b: unknown) => boolean;

const defaultEquals: EqualsFn = (a, b) => a === b;
const neverEquals: EqualsFn = () => false;

function resolveEquals<T>(options?: SignalOptions<T>): EqualsFn {
  if (!options || options.equals === undefined) return defaultEquals;
  if (options.equals === false) return neverEquals;
  return options.equals as EqualsFn;
}

// ── The reactive node ────────────────────────────────────────────
/**
 * A single node in the reactive graph. Plain signals carry a value and
 * no `fn`; computeds and effects carry an `fn` and a set of `sources`.
 * Keeping them one shape keeps the propagation logic free of branches
 * on "kind", which is where reactivity bugs love to hide.
 */
class ReactiveNode {
  value: unknown;
  /** Derivation. `null` for plain signals. */
  fn: (() => unknown) | null;
  /** Nodes that depend on this one (downstream). */
  observers: ReactiveNode[] | null = null;
  /** Nodes this one depends on (upstream). Only set for derivations. */
  sources: ReactiveNode[] | null = null;
  /** Dependencies recorded during the *current* run (temporary). */
  private collecting: ReactiveNode[] | null = null;
  color: Color;
  readonly isEffect: boolean;
  cleanups: Array<() => void> | null = null;
  /** Computations created while this node ran — disposed with/before it. */
  owned: ReactiveNode[] | null = null;
  /** The owner this node was created under — the parent in the owner tree. */
  owner: ReactiveNode | null = null;
  /** Context values *provided* at this owner scope (`useContext` walks up). */
  context: Record<symbol, unknown> | null = null;
  readonly equals: EqualsFn;

  constructor(
    init: (() => unknown) | unknown,
    isEffect: boolean,
    equals: EqualsFn,
    isDerivation: boolean,
  ) {
    this.equals = equals;
    this.isEffect = isEffect;
    if (isDerivation) {
      // A derivation starts dirty: it must run once before it has a value.
      this.fn = init as () => unknown;
      this.value = undefined;
      this.color = DIRTY;
      // Attach to the owner so it gets disposed when the owner does, and record
      // the parent link so `useContext` can walk up the owner tree.
      if (currentOwner !== null) {
        (currentOwner.owned ??= []).push(this);
        this.owner = currentOwner;
      }
    } else {
      this.fn = null;
      this.value = init;
      this.color = CLEAN;
    }
  }

  /** Read the value, subscribing the active listener and pulling if stale. */
  read(): unknown {
    if (this.color === DISPOSED) return this.value;
    if (listener !== null) {
      // Record this node as a dependency of whoever is running.
      (listener.collecting ??= []).push(this);
    }
    if (this.fn !== null) this.updateIfNecessary();
    return this.value;
  }

  /** Write a new value (signals only). Pushes staleness to observers. */
  write(next: unknown): void {
    // A write while a *computed* (non-effect derivation) is evaluating means a
    // side effect inside something that's supposed to be pure — a common cause
    // of glitches and surprising re-runs. Effects are allowed to write.
    if (listener !== null && !listener.isEffect) {
      warn(
        "a signal was written while a computed was evaluating. Derivations must " +
          "be pure (no side effects) — move the write into an effect or an " +
          "event handler.",
      );
    }
    if (this.equals(this.value, next)) return;
    this.value = next;
    if (this.observers !== null) {
      for (const o of this.observers) o.markStale(DIRTY);
    }
  }

  /**
   * Push a "maybe stale" color downstream. A direct source change marks
   * us DIRTY; everything further downstream only needs CHECK (it must
   * re-validate, but might turn out unchanged — the key to glitch-free).
   */
  markStale(color: typeof CHECK | typeof DIRTY): void {
    if (this.color >= color) return; // already at least this stale
    const wasClean = this.color === CLEAN;
    this.color = color;
    if (wasClean && this.isEffect) scheduleEffect(this);
    if (this.observers !== null) {
      for (const o of this.observers) o.markStale(CHECK);
    }
  }

  /** Pull: bring this node up to date if (and only if) it might be stale. */
  updateIfNecessary(): void {
    if (this.color === CLEAN || this.color === DISPOSED) return;
    if (this.color === CHECK && this.sources !== null) {
      // We're only *maybe* stale: validate sources. The first one that
      // actually changes will flip us to DIRTY, and we can stop early.
      for (const s of this.sources) {
        s.updateIfNecessary();
        if ((this.color as Color) === DIRTY) break;
      }
    }
    if (this.color === DIRTY) this.update();
    // Either we recomputed, or revalidation found nothing changed.
    this.color = CLEAN;
  }

  /** Recompute the derivation, reconcile dependencies, notify observers. */
  private update(): void {
    this.cleanNode();
    const prevListener = listener;
    const prevOwner = currentOwner;
    listener = this;
    currentOwner = this;
    this.collecting = [];
    let next: unknown;
    let caught: unknown;
    let threw = false;
    try {
      next = this.fn!();
    } catch (err) {
      threw = true;
      caught = err;
    } finally {
      listener = prevListener;
      currentOwner = prevOwner;
    }
    if (threw) {
      // The derivation failed mid-run: drop the half-collected deps, mark clean
      // so a re-validating pull doesn't loop, and route the error to the nearest
      // boundary (or rethrow if there is none). The broken subtree is torn down
      // by whoever handles it (an `<ErrorBoundary>` re-render disposes its scope).
      this.collecting = null;
      this.color = CLEAN;
      handleError(caught, this.owner);
      return;
    }
    this.reconcileSources();

    const changed = !this.equals(this.value, next);
    this.value = next;
    this.color = CLEAN;
    if (changed && this.observers !== null) {
      // Observers were already CHECK'd by the originating write; promoting
      // them to DIRTY tells the in-progress pull they truly must recompute.
      for (const o of this.observers) {
        if (o.color !== DISPOSED && o.color < DIRTY) o.color = DIRTY;
      }
    }
  }

  /** Diff freshly-collected deps against the previous set, fixing links. */
  private reconcileSources(): void {
    const seen = this.collecting!;
    this.collecting = null;

    // De-duplicate (a source read twice in one run counts once).
    const next: ReactiveNode[] = [];
    for (const s of seen) if (!next.includes(s)) next.push(s);

    // Drop observer links for sources we no longer depend on.
    if (this.sources !== null) {
      for (const old of this.sources) {
        if (!next.includes(old)) removeObserver(old, this);
      }
    }
    // Add observer links for newly-acquired sources.
    for (const s of next) {
      if (this.sources === null || !this.sources.includes(s)) {
        addObserver(s, this);
      }
    }
    this.sources = next.length > 0 ? next : null;
  }

  /** Dispose owned child computations (LIFO), e.g. before a re-run. */
  private disposeOwned(): void {
    if (this.owned === null) return;
    const owned = this.owned;
    this.owned = null;
    for (let i = owned.length - 1; i >= 0; i--) owned[i]!.dispose();
  }

  /** Run and clear teardown callbacks (LIFO). */
  runCleanups(): void {
    if (this.cleanups === null) return;
    const cs = this.cleanups;
    this.cleanups = null;
    for (let i = cs.length - 1; i >= 0; i--) cs[i]!();
  }

  /** Tear down owned children then run own cleanups (shared by re-run/dispose). */
  private cleanNode(): void {
    this.disposeOwned();
    this.runCleanups();
  }

  /** Tear down: dispose children, run cleanups, detach from sources, go inert. */
  dispose(): void {
    if (this.color === DISPOSED) return;
    this.cleanNode();
    if (this.sources !== null) {
      for (const s of this.sources) removeObserver(s, this);
      this.sources = null;
    }
    this.observers = null;
    this.collecting = null;
    this.owner = null;
    this.color = DISPOSED;
  }
}

// ── Observer link helpers ────────────────────────────────────────
function addObserver(source: ReactiveNode, observer: ReactiveNode): void {
  if (source.observers === null) source.observers = [observer];
  else source.observers.push(observer);
}

function removeObserver(source: ReactiveNode, observer: ReactiveNode): void {
  const obs = source.observers;
  if (obs === null) return;
  const idx = obs.indexOf(observer);
  if (idx === -1) return;
  // Swap-remove: order among observers is irrelevant.
  obs[idx] = obs[obs.length - 1]!;
  obs.pop();
  if (obs.length === 0) source.observers = null;
}

// ── Scheduling / flushing ────────────────────────────────────────
function scheduleEffect(node: ReactiveNode): void {
  effectQueue.push(node);
}

/**
 * Drain the effect queue. Re-entrant calls (an effect that writes a
 * signal) are absorbed: the inner write schedules onto the same queue,
 * which the outer loop is still draining.
 */
function flush(): void {
  if (flushing) return;
  flushing = true;
  let i = 0;
  let iterations = 0;
  try {
    while (i < effectQueue.length) {
      if (++iterations > MAX_FLUSH_ITERATIONS) {
        throw new Error(
          "kanabun: effect flush did not stabilize — likely an effect that " +
            "writes a signal it also depends on (infinite update loop).",
        );
      }
      const node = effectQueue[i++]!;
      if (node.color !== DISPOSED) node.updateIfNecessary();
    }
  } finally {
    effectQueue.length = 0;
    flushing = false;
  }
}

// ── Public API ───────────────────────────────────────────────────
/** A function that returns the current value and subscribes the caller. */
export interface Accessor<T> {
  (): T;
}

/** A writable reactive value. Call it to read; use `.set`/`.update` to write. */
export interface Signal<T> extends Accessor<T> {
  /** Replace the value. The argument is always treated as the new value. */
  readonly set: (value: T) => void;
  /** Update from the previous value, e.g. `count.update(n => n + 1)`. */
  readonly update: (fn: (prev: T) => T) => void;
  /** Read the current value without subscribing or recomputing. */
  readonly peek: () => T;
}

/** A function that tears down an effect. Idempotent. */
export type Disposer = () => void;

/**
 * Create a writable reactive value.
 *
 * @example
 *   const count = signal(0);
 *   count();              // read (subscribes inside effects/computeds)
 *   count.set(1);         // write
 *   count.update(n => n + 1);
 */
export function signal<T>(value: T, options?: SignalOptions<T>): Signal<T> {
  const node = new ReactiveNode(value, false, resolveEquals(options), false);
  const accessor = (() => node.read() as T) as Signal<T>;
  const writable = accessor as { -readonly [K in keyof Signal<T>]: Signal<T>[K] };
  writable.set = (next: T) => {
    node.write(next);
    if (batchDepth === 0) flush();
  };
  writable.update = (fn: (prev: T) => T) => {
    node.write(fn(node.value as T));
    if (batchDepth === 0) flush();
  };
  writable.peek = () => node.value as T;
  return accessor;
}

/**
 * Create a memoized derived value. Recomputes lazily — only when read and
 * only if one of its dependencies actually changed.
 *
 * @example
 *   const doubled = computed(() => count() * 2);
 */
export function computed<T>(fn: () => T, options?: SignalOptions<T>): Accessor<T> {
  const node = new ReactiveNode(fn, false, resolveEquals(options), true);
  return () => node.read() as T;
}

/**
 * Run `fn` immediately, then re-run it whenever a dependency it read
 * changes. `fn` may return a cleanup function (Svelte `$effect` style),
 * or call `onCleanup`, to tear down before the next run and on disposal.
 *
 * @returns a disposer that stops the effect and runs its cleanups.
 */
export function effect(fn: () => void | (() => void)): Disposer {
  if (currentOwner === null) {
    warn(
      "effect() was created outside any owner (createRoot/render). It won't be " +
        "disposed automatically — keep the returned disposer and call it, or " +
        "create the effect inside a root.",
    );
  }
  const node = new ReactiveNode(
    () => {
      const cleanup = fn();
      if (typeof cleanup === "function") onCleanup(cleanup);
    },
    true,
    defaultEquals,
    true,
  );
  scheduleEffect(node);
  if (batchDepth === 0) flush();
  return () => node.dispose();
}

/**
 * Batch multiple writes so observers see them as one atomic change and
 * effects run at most once. Nested batches flush only at the outermost
 * exit. Returns whatever `fn` returns.
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

/**
 * Read reactive values inside `fn` *without* subscribing to them. Useful
 * when an effect needs a value but should not re-run when it changes.
 */
export function untrack<T>(fn: () => T): T {
  const prev = listener;
  listener = null;
  try {
    return fn();
  } finally {
    listener = prev;
  }
}

/**
 * Register a teardown callback for the current reactive owner (the running
 * effect/computed, or the enclosing `createRoot`). Runs before the owner's
 * next execution and on disposal. A no-op when called outside any owner.
 */
export function onCleanup(fn: () => void): void {
  if (currentOwner === null) {
    warn(
      "onCleanup() was called outside an owner; the cleanup will never run. " +
        "Call it during a render or inside an effect/createRoot.",
    );
    return;
  }
  (currentOwner.cleanups ??= []).push(fn);
}

/**
 * Create a disposal scope. `fn` receives a `dispose` function that tears down
 * every effect/computed (and their cleanups) created within the scope. Use it
 * as the root of a render, or anywhere you need to own a subtree's reactivity.
 * Reactive reads inside `fn` itself are not tracked.
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner = new ReactiveNode(undefined, false, defaultEquals, false);
  const prevOwner = currentOwner;
  const prevListener = listener;
  // Link to the enclosing owner so context provided outside the root is still
  // visible inside it (e.g. a `<For>` row, which runs in its own root).
  owner.owner = prevOwner;
  currentOwner = owner;
  listener = null;
  try {
    return fn(() => owner.dispose());
  } finally {
    currentOwner = prevOwner;
    listener = prevListener;
  }
}

/**
 * Schedule `fn` to run once after the current synchronous render completes (on
 * the next microtask) — e.g. to measure laid-out DOM. It runs within the
 * calling owner, so `onCleanup` registered inside it is honoured, and its reads
 * are untracked. Skipped if the owner is disposed before the microtask fires.
 */
export function onMount(fn: () => void): void {
  if (currentOwner === null) {
    warn(
      "onMount() was called outside an owner. It will run, but isn't tied to a " +
        "component lifecycle (onCleanup inside it won't be honoured). Call it " +
        "during a render or inside an effect/createRoot.",
    );
  }
  const owner = currentOwner;
  queueMicrotask(() => {
    if (owner !== null && owner.color === DISPOSED) return;
    const prevOwner = currentOwner;
    const prevListener = listener;
    currentOwner = owner;
    listener = null;
    try {
      fn();
    } finally {
      currentOwner = prevOwner;
      listener = prevListener;
    }
  });
}

// ── Error handling ───────────────────────────────────────────────
/** Key under which an error handler is stored on an owner's `context` map. */
const ERROR = Symbol("error-handler");

/**
 * Create a non-tracking owner scope parented to `currentOwner` and registered
 * in its `owned` list, so it is disposed when the enclosing owner disposes.
 * Used by `catchError` and `createContextScope` — both need the same wiring.
 * Intentionally NOT used by `createRoot`, which is disposal-isolated (not
 * pushed onto the parent's owned list, so lifetime is managed by the returned
 * disposer) — but `createRoot` still links `owner.owner` for context and
 * error-handler chain-walking.
 */
function createDependentScope(): ReactiveNode {
  const owner = new ReactiveNode(undefined, false, defaultEquals, false);
  owner.owner = currentOwner;
  if (currentOwner !== null) (currentOwner.owned ??= []).push(owner);
  return owner;
}

/**
 * Route `err` to the nearest error handler registered (via {@link catchError})
 * on the owner tree at or above `owner`. If none is found the error is rethrown,
 * so an unguarded failure still surfaces to the host rather than being swallowed.
 */
function handleError(err: unknown, owner: ReactiveNode | null): void {
  for (let o = owner; o !== null; o = o.owner) {
    if (o.context !== null && ERROR in o.context) {
      (o.context[ERROR] as (e: unknown) => void)(err);
      return;
    }
  }
  throw err;
}

/**
 * Run `tryFn`, routing any error it throws — synchronously now, *or* later when
 * a reactive computation created under it re-runs — to `handler` instead of
 * letting it propagate. The guarded scope is registered on the owner tree, so
 * the propagation core consults it when a descendant effect/computed throws.
 * Returns `tryFn`'s result, or `undefined` if it threw synchronously.
 *
 * This is the primitive behind {@link ErrorBoundary}; reach for the component
 * for UI, and for this when you need to catch imperatively.
 */
export function catchError<T>(
  tryFn: () => T,
  handler: (err: unknown) => void,
): T | undefined {
  const owner = createDependentScope();
  owner.context = { [ERROR]: handler };
  const prevOwner = currentOwner;
  currentOwner = owner;
  try {
    return tryFn();
  } catch (err) {
    handler(err);
    return undefined;
  } finally {
    currentOwner = prevOwner;
  }
}

// ── Context ──────────────────────────────────────────────────────
/**
 * A context handle created by {@link createContext}. Carry the value down the
 * tree with `<Ctx.Provider value={…}>` and read it back with
 * {@link useContext}. Like the rest of kanabun, this is runtime-only — there is
 * no compiler — so a Provider's children must be a **function** (a thunk), the
 * same "functions are lazy" convention `<Show>` uses:
 *
 *     <Ctx.Provider value={v}>{() => <App />}</Ctx.Provider>
 *
 * The thunk runs *after* the Provider has set the value, so descendants read
 * the provided value rather than the default. (Plain JSX children are evaluated
 * eagerly — before the Provider runs — and therefore only ever see the default.)
 */
export interface Context<T> {
  /** Unique key under which the value is stored on the owner tree. */
  readonly id: symbol;
  /** Returned by `useContext` when no Provider is found above the reader. */
  readonly defaultValue: T;
  /** Component that provides `value` to the descendants in its function child. */
  readonly Provider: (props: { value: T; children: unknown }) => unknown;
}

/**
 * Create a fresh owner scope that provides `value` under `id`. The scope is
 * owned by the enclosing owner, so it (and anything created under it) is
 * disposed when that owner is, and `useContext` reads find it by walking up.
 */
function createContextScope(id: symbol, value: unknown): ReactiveNode {
  const owner = createDependentScope();
  owner.context = { [id]: value };
  return owner;
}

/**
 * Run `fn` with `owner` as the current owner — ownership only. Tracking is left
 * untouched, so reactive reads inside `fn` still subscribe the active listener
 * (e.g. a `<For>` thunk re-run by an `insert` effect keeps its dependencies).
 */
function runUnderOwner<R>(owner: ReactiveNode, fn: () => R): R {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
  }
}

/**
 * Create a context with a default value. Returns a handle whose `Provider`
 * supplies a value to descendants and whose value is read with `useContext`.
 *
 * @example
 *   const Theme = createContext("light");
 *   // provide:  <Theme.Provider value="dark">{() => <App />}</Theme.Provider>
 *   // consume:  const theme = useContext(Theme);
 */
export function createContext<T>(defaultValue: T): Context<T> {
  const id = Symbol("context");
  return {
    id,
    defaultValue,
    Provider(props) {
      // One owner scope, tied to the enclosing owner, holds the value.
      const owner = createContextScope(id, props.value);
      const children = props.children;
      const view = runUnderOwner(owner, () =>
        typeof children === "function" ? (children as () => unknown)() : children,
      );
      // A component child (e.g. `<For>`/`<Show>`) returns a thunk whose body
      // runs *later*, inside an `insert` effect created outside this scope. Wrap
      // it so every invocation re-enters the scope — otherwise those deferred
      // reads would walk an owner chain that misses the provided value.
      return typeof view === "function"
        ? () => runUnderOwner(owner, view as () => unknown)
        : view;
    },
  };
}

/**
 * Read the nearest provided value for `context`, walking up the owner tree from
 * the current scope. Returns the context's `defaultValue` if no Provider is
 * found above the caller. Call it while an owner is active (during a component's
 * synchronous render, or inside an effect/computed).
 */
export function useContext<T>(context: Context<T>): T {
  for (let o = currentOwner; o !== null; o = o.owner) {
    if (o.context !== null && context.id in o.context) {
      return o.context[context.id] as T;
    }
  }
  return context.defaultValue;
}
