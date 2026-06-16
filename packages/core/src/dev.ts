/**
 * kanabun — dev-time warnings
 * ------------------------------------------------------------------
 * There is no compiler, so a class of mistakes can't be caught at build time.
 * This module is the runtime fallback: opt-in diagnostics for the things the
 * reactivity convention makes easy to get wrong (creating a computation with no
 * owner, calling a lifecycle hook outside one, mutating state from inside a
 * derivation).
 *
 * It is **off by default** — production and the test suite stay silent unless
 * they opt in — and `kanabun dev` flips it on automatically by setting
 * `globalThis.__KANABUN_DEV__` (a plain global, so the served page and the
 * bundled core share it). Warnings are **deduplicated** (each message is shown
 * at most once) so a re-running effect can't flood the console, and routed
 * through a **settable sink** so a future dev overlay can intercept them.
 *
 * Runtime-independent: only `console` and `globalThis` (standard globals) are
 * touched, and only while warnings are enabled.
 */

/** Explicit toggle via {@link setDev}. The ambient global is also honoured. */
let DEV = false;

/** Messages already emitted, so each warning is shown at most once. */
const seen = new Set<string>();

/** Default sink. Factored out so {@link setWarnHandler}(null) can restore it. */
const consoleSink = (message: string): void => console.warn(message);

/** Where warnings go. Defaults to `console.warn`; a dev overlay can intercept. */
let sink: (message: string) => void = consoleSink;

const PREFIX = "kanabun [dev]: ";

/**
 * Turn dev-time warnings on or off explicitly. Off by default. `kanabun dev`
 * enables them for you (via `globalThis.__KANABUN_DEV__`), so reach for this
 * only to force warnings on in another setup, or off to silence them.
 */
export function setDev(enabled: boolean): void {
  DEV = enabled;
}

/** Whether dev-time warnings are currently active (explicit flag or ambient). */
export function isDev(): boolean {
  return DEV || (globalThis as { __KANABUN_DEV__?: unknown }).__KANABUN_DEV__ === true;
}

/**
 * Route warnings somewhere other than the console (e.g. a dev overlay). Pass
 * `null` to restore the default `console.warn` sink.
 */
export function setWarnHandler(handler: ((message: string) => void) | null): void {
  sink = handler ?? consoleSink;
}

/**
 * Emit `message` once (deduplicated, prefixed) when dev mode is active. A no-op
 * otherwise, so the call sites stay cheap when warnings are off.
 */
export function warn(message: string): void {
  if (!isDev()) return;
  if (seen.has(message)) return;
  seen.add(message);
  sink(PREFIX + message);
}

/**
 * Test-only: restore the module to its pristine state (warnings off, dedupe
 * memory cleared, default console sink). Not re-exported from the package.
 */
export function __resetDev(): void {
  DEV = false;
  seen.clear();
  sink = consoleSink;
}
