import { signal, css } from "@kanabun/core";

// Scoped styles. On the server this is registered before any `document`
// exists, so it's buffered and replayed into the rendered <head>; on the
// client it dedupes against the server-sent <style> (same `data-k` hash).
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
 * A counter shared by the server (`renderToString`) and the client (`hydrate`).
 * The server reads `count()` once to produce markup; the client wires the click
 * handler and the reactive `{count}` binding to make it interactive.
 */
export function App() {
  const count = signal(0);
  return (
    <button type="button" class={button} onClick={() => count.update((n) => n + 1)}>
      count is <span class="count">{count}</span>
    </button>
  );
}
