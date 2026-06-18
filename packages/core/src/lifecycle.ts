/**
 * kanabun — component lifecycle helpers
 * ------------------------------------------------------------------
 * Ownership-scoped utilities layered on top of the reactive engine:
 *
 *   onCleanup(fn)   register teardown for the current owner
 *   createRoot(fn)  establish a disposal scope (the root of a render)
 *   onMount(fn)     defer work to after the synchronous render
 *
 * Split out from `reactive.ts` so the engine stays focused on graph
 * propagation. These only need the *active owner* plus a couple of scope
 * helpers the engine exposes (`runWithOwner`), never the private tracking
 * state directly.
 */
import { warn } from "./dev";
import {
  ReactiveNode,
  defaultEquals,
  DISPOSED,
  currentOwner,
  runWithOwner,
} from "./reactive";

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
  // Link to the enclosing owner so context provided outside the root is still
  // visible inside it (e.g. a `<For>` row, which runs in its own root). The
  // root is disposal-isolated otherwise — its lifetime is the returned disposer.
  owner.owner = currentOwner;
  return runWithOwner(owner, () => fn(() => owner.dispose()));
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
    runWithOwner(owner, fn);
  });
}
