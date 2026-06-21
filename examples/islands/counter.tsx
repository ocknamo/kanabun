import { signal, css } from "@kanabun/core";

// Scoped styles for the island. On the server this is buffered (no `document`
// yet) and replayed into the rendered <head>; on the client it dedupes against
// the server-sent <style> by its `data-k` hash.
const button = css`
  font: inherit;
  padding: 0.5rem 1rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: #f7f7f7;
  cursor: pointer;

  &:hover {
    background: #ececec;
  }

  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    margin-left: 0.25rem;
  }
`;

/**
 * An interactive island. The server renders it once (reading `count()` for the
 * initial markup); the client re-mounts it via `hydrateIslands` so the click
 * handler and the reactive `{count}` binding come alive — while the static shell
 * around it ships and runs no JS.
 *
 * `props.start` arrives as plain JSON across the server→client boundary (no
 * closures/signals cross it), so it must be JSON-serializable.
 */
export function Counter(props: { start?: number }) {
  const count = signal(props.start ?? 0);
  return (
    <button type="button" class={button} onClick={() => count.update((n) => n + 1)}>
      count is <span class="count">{count}</span>
    </button>
  );
}
