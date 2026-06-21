/**
 * The lazily-loaded module for the `lazy()` demo. A bundler code-splits this
 * into its own chunk, so it is only fetched when `<LazyPanel>` first renders —
 * open the Network tab and click "Load the panel" to see the chunk arrive.
 *
 * It returns the panel via a **default export**, which is what `lazy()` expects:
 *   const LazyPanel = lazy(() => import("./lazy-panel"));
 */
import { signal, css } from "@kanabun/core";

const panel = css`
  margin-top: 0.75rem;
  padding: 1rem;
  border-radius: 8px;
  background: #eef6ff;
  border: 1px solid #cfe3ff;

  p {
    margin: 0 0 0.5rem;
    color: #234;
  }

  button {
    font: inherit;
    padding: 0.35rem 0.8rem;
    border-radius: 6px;
    border: 1px solid #9cc4ff;
    background: #fff;
    cursor: pointer;
  }
`;

/**
 * A small interactive panel — proof that a lazily-loaded component is fully live
 * (its own signal) once it arrives, not a static blob.
 */
export default function LazyPanel() {
  const likes = signal(0);
  return (
    <div class={panel}>
      <p>
        I shipped in a separate chunk, loaded on demand. I even have my own
        state.
      </p>
      <button onClick={() => likes.update((n) => n + 1)}>
        {() => `👍 ${likes()}`}
      </button>
    </div>
  );
}
