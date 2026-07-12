/**
 * Render a component into a mock container for a test. If no document is
 * installed yet, a fresh mock document is installed first (the renderer
 * resolves `globalThis.document` lazily, so the order matters) and restored
 * on `dispose()`; a document installed by the caller is reused and left alone.
 */
import { render } from "@kanabun/core";
import { createContainer, installDOM, serialize, type MockNode } from "./dom-mock";
import { within, type BoundQueries } from "./queries";

export interface RenderTestOptions {
  /** Render into this container instead of a fresh detached `<div>`. */
  container?: MockNode;
}

/** What `renderTest` hands back: the container-bound queries plus… */
export interface RenderTestResult extends BoundQueries {
  container: MockNode;
  /** The container serialized to HTML (comment markers omitted). */
  html(): string;
  /**
   * Dispose the reactive root, and restore `globalThis.document` if
   * `renderTest` installed it. Idempotent.
   */
  dispose(): void;
}

export function renderTest(
  code: () => unknown,
  options: RenderTestOptions = {},
): RenderTestResult {
  const hasDocument =
    (globalThis as { document?: unknown }).document !== undefined;
  const teardown = hasDocument ? undefined : installDOM();
  const container = options.container ?? createContainer();
  const disposeRoot = render(code, container as unknown as Element);
  let disposed = false;
  return {
    container,
    html: () => serialize(container),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeRoot();
      teardown?.();
    },
    ...within(container),
  };
}
