# kanabun

[![CI](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml/badge.svg)](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml)

*English | [日本語](./README.ja.md)*

> A Svelte-flavoured frontend framework built on **Bun + TypeScript**, with
> **zero runtime dependencies**.

The pitch: the "change a variable and the UI just follows" feeling of Svelte,
but compiled down to plain browser JS so your users' app carries no framework
runtime baggage. The only tools kanabun itself leans on are Bun (for the dev
experience) and TypeScript (for types) — nothing ships to the browser except
standard JS, and the development setup stays minimal too (one type-only dev
dependency; see [below](#dependencies--minimal-by-design)).

**Status:** early. Phases 1–3 are implemented and tested — reactive core, JSX
runtime + `render`, and control flow (`<Show>` / `<For>` with keyed updates).
**TodoMVC runs.**

---

## Why

Signals give you Svelte-like ergonomics without a virtual DOM or a diff
algorithm — you update only what changed. By leaning on **JSX** for templates
(a later phase), the heavy lifting of type-checking and editor support is
handed entirely to TypeScript, so there's no custom DSL, no LSP to build. That
keeps kanabun's own compiler small and its core dependency-free.

See [`docs/decisions.md`](docs/decisions.md) ([日本語](docs/decisions.ja.md)) for
the design rationale and the trade-offs that were considered and rejected.

---

## The reactive core (`@kanabun/core`)

A glitch-free, lazily-evaluated signals implementation. The public surface is
deliberately tiny:

```ts
import { signal, computed, effect, batch, untrack, onCleanup } from "@kanabun/core";

const count = signal(0);

// read by calling; write with .set / .update
count();                    // 0
count.set(1);
count.update((n) => n + 1); // 2

// derived values are memoized and lazy
const doubled = computed(() => count() * 2);

// effects run now and re-run when a dependency changes
const dispose = effect(() => {
  console.log("count is", count());
  return () => console.log("cleaning up"); // optional teardown (Svelte $effect style)
});

// group writes so observers see one atomic change
batch(() => {
  count.set(10);
  count.set(20); // effect runs once, with 20
});

dispose(); // stop the effect
```

| API | Purpose |
| --- | --- |
| `signal(value, opts?)` | Writable state. Read `s()`, write `s.set(v)` / `s.update(fn)`, read-without-subscribe `s.peek()`. |
| `computed(fn, opts?)` | Memoized derived value. Recomputes lazily and only if a dependency actually changed. |
| `effect(fn)` | Runs immediately, re-runs on dependency change. Returns a disposer. `fn` may return a cleanup. |
| `batch(fn)` | Coalesce multiple writes into a single notification/flush. |
| `untrack(fn)` | Read reactive values without subscribing. |
| `onCleanup(fn)` | Register teardown for the running effect/computed. |

`opts` accepts `{ equals }` — a custom comparator, or `false` to notify on
every write.

### Why "explicit getters" (`count()` not `count`)

Calling `count()` is what records the dependency — it's the subscription point,
not decoration. This is the SolidJS model. It means kanabun needs **no
compiler** for reactivity (Svelte's bare `count++` magic fundamentally requires
one), which keeps the core small and lets `tsc` and your editor understand
every line with zero custom tooling.

---

## Rendering (JSX)

Templates are JSX/TSX. TypeScript type-checks them against kanabun's own JSX
runtime (`jsxImportSource: "@kanabun/core"`), so there's no DSL and no LSP.
There's **no virtual DOM and no diffing**: `jsx(...)` builds real DOM eagerly,
and only the reactive bits are wired with fine-grained effects.

```tsx
import { signal, render } from "@kanabun/core";

function Counter() {
  const count = signal(0);
  return (
    <button type="button" onClick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}

render(() => <Counter />, document.getElementById("app")!);
```

Components run **once** (no re-execution); reactivity is per-expression.

### The reactive-expression convention

Because there's no compiler, you mark what's reactive explicitly: **a child or
attribute that is a function is reactive.**

```tsx
<span>{count}</span>             // reactive — the accessor is a function
<span>{() => count() * 2}</span> // reactive — a thunk
<span>{count()}</span>           // STATIC — read once when built
<div class={() => cls()} />      // reactive attribute
<button onClick={handler} />     // on* is always an event, never reactive
```

### Control flow: `<Show>` and `<For>`

`<Show>` is conditional; `<For>` is **keyed** list rendering — each item is
keyed by reference, so a node is created once per item and reused on
insert/remove/reorder (no full rebuild), with each item's reactive scope
disposed when it leaves.

```tsx
<Show when={() => user()} fallback={<p>Loading…</p>}>
  <Profile user={user()!} />
</Show>

<For each={() => todos()} fallback={<p>No todos</p>}>
  {(todo) => <li class={() => (todo.done() ? "done" : "")}>{todo.title}</li>}
</For>
```

Runnable examples: [`examples/counter/`](examples/counter/) and
[`examples/todomvc/`](examples/todomvc/) — serve either with
`bun examples/<name>/index.html`.

---

## Development

Requires only [Bun](https://bun.com/).

```sh
bun install            # installs only @types/bun (type defs); nothing ships
bun test               # run the test suite
bun run test:coverage  # run with coverage (text + lcov)
bun run typecheck      # bunx tsc --noEmit (TypeScript fetched on demand)
```

CI runs typecheck, tests, and coverage on every push and PR
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Dependencies — minimal by design

- **Runtime: zero.** `@kanabun/core` ships standard JS only; nothing is added
  to your app's bundle.
- **Development: one, type-only.** The single dev dependency is
  [`@types/bun`](https://www.npmjs.com/package/@types/bun), which provides the
  `bun:test` and Bun type surface. It is types, never shipped.
- **TypeScript** (the project's sanctioned tool) is fetched on demand by
  `bunx tsc` rather than vendored.
- CI infrastructure (GitHub Actions such as `actions/checkout` and
  `oven-sh/setup-bun`) is not part of the project's dependency graph.

### Layout

```
packages/
  core/        @kanabun/core — reactive core + DOM/JSX runtime
    src/
      reactive.ts         signals: signal/computed/effect/batch/createRoot
      dom.ts              render + fine-grained DOM bindings + keyed reconcile
      control-flow.ts     <Show>, <For>, mapArray (keyed)
      jsx-runtime.ts      jsx/jsxs/Fragment + JSX type namespace
      jsx-dev-runtime.ts  dev transform entry
    test/      *.spec.ts (+ dom-mock.ts, a tiny test-only DOM)
examples/
  counter/     a runnable reactive counter
  todomvc/     a runnable TodoMVC
docs/          design docs (English + 日本語)
```

The `core` package uses only standard JS / Web APIs (the DOM is a Web API); it
never touches Bun- or Node-specific APIs. Runtime-specific code will live in a
thin CLI/dev layer added in a later phase.

Tests are named `*.spec.ts`. The renderer is tested against a small in-repo DOM
mock, so no jsdom/happy-dom dependency is needed.

---

## License

MIT
