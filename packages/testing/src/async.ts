/**
 * Wait one macrotask turn. By the time it resolves, all queued microtasks
 * have flushed too — so `onMount` callbacks (queued via `queueMicrotask`) and
 * settled `resource` promises are observable after a single `await tick()`.
 * (kanabun effects themselves run synchronously and never need this.)
 */
export const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));
