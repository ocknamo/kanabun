/**
 * Wait one macrotask turn. By the time it resolves, all queued microtasks
 * have flushed too — so `onMount` callbacks (queued via `queueMicrotask`) and
 * settled `resource` promises are observable after a single `await tick()`.
 * (kanabun effects themselves run synchronously and never need this.)
 */
export const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** A promise whose settlement the test controls — see {@link deferred}. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * A promise with its `resolve`/`reject` exposed, for driving async code
 * (a `resource` fetcher, a `lazy` loader) from a test: hand out `d.promise`,
 * assert the loading state, then settle it and `await tick()`.
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
