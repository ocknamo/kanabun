import { signal, render } from "@kanabun/core";

function Counter() {
  const count = signal(0);

  // `{count}` (the accessor itself) is reactive; `count()` would be read once.
  return (
    <button type="button" onClick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}

const root = document.getElementById("app");
if (root) render(() => <Counter />, root);
