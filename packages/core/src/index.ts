/**
 * @kanabun/core — runtime-independent reactive core.
 *
 * No runtime dependencies: standard JS / Web APIs only, so this package is
 * safe to ship to any browser. Bun is used only by the (future) CLI/dev
 * layer, never here.
 */
export { signal, computed, effect, batch, untrack, onCleanup } from "./reactive";
export type { Accessor, Signal, SignalOptions, Disposer } from "./reactive";
