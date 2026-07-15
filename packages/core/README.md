# @kanabun/core

The runtime for [kanabun](https://github.com/ocknamo/kanabun) — a
Svelte-flavoured frontend framework built on **Bun + TypeScript** with
**zero runtime dependencies**. Signals + a runtime JSX renderer: no virtual
DOM, no compiler. Runtime-independent (standard JS / Web APIs only), so it
ships safely to any browser.

## Install

```sh
bun add @kanabun/core
```

## Usage

```tsx
import { signal, render } from "@kanabun/core";

function Counter() {
  const count = signal(0);
  return (
    <button onclick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}

render(Counter, document.getElementById("app")!);
```

Signals use explicit getters: read `count()`, write `count.set(v)` /
`count.update(fn)`. A child or attribute that is a *function* (`{count}`,
`{() => …}`) is reactive; `{count()}` is read once.

## What's inside

Reactive core (`signal`, `computed`, `effect`, `batch`, `untrack`), JSX
runtime + `render` / `hydrate`, control flow (`<Show>`, `<For>`,
`ErrorBoundary`), async (`resource`, `<Suspense>`), DX primitives (`onMount`,
`mergeProps`, `splitProps`, scoped `css`, `context`), and SSR
(`renderToString`).

## License

MIT
