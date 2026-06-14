import { signal, render, css } from "@kanabun/core";

// Scoped styles: `css` hashes the body to a unique class, injects one
// <style> into <head>, and returns the class name to apply. No compiler.
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

function Counter() {
  const count = signal(0);

  // `{count}` (the accessor itself) is reactive; `count()` would be read once.
  // `class` is a static string, so it's applied once.
  return (
    <button type="button" class={button} onClick={() => count.update((n) => n + 1)}>
      count is <span class="count">{count}</span>
    </button>
  );
}

const root = document.getElementById("app");
if (root) render(() => <Counter />, root);
