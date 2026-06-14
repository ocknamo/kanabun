# kanabun

[![CI](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml/badge.svg)](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ocknamo/kanabun/badges/coverage.json)](https://github.com/ocknamo/kanabun/actions/workflows/ci.yml)

*English | [日本語](./README.ja.md)*

> A Svelte-flavoured frontend framework built on **Bun + TypeScript**, with
> **zero runtime dependencies**.

The pitch: the "change a variable and the UI just follows" feeling of Svelte,
but compiled down to plain browser JS so your users' app carries no framework
runtime baggage. The only tools kanabun itself leans on are Bun (for the dev
experience) and TypeScript (for types) — nothing ships to the browser except
standard JS, and the development setup stays minimal too (one type-only dev
dependency; see [below](#dependencies--minimal-by-design)).

**Status:** early but usable. Reactive core, JSX runtime + `render`, control
flow (`<Show>` / `<For>` keyed), DX primitives (`onMount`, `mergeProps`,
`splitProps`, scoped `css`, `context`), and a CLI (`create` / `dev` / `build`) are implemented and
tested. **TodoMVC runs; `kanabun dev` and `kanabun build` work.**

---

## Quickstart

Everything below runs from a clone of this repo — the packages aren't published
to npm yet (see the [roadmap](docs/roadmap.md)).

```sh
bun install            # installs only @types/bun
bun test               # the full suite
```

Run an example with live reload, or bundle it for the browser:

```sh
# dev server (full reload on change)
bun packages/cli/bin/kanabun.ts dev   examples/todomvc/index.html

# production bundle
bun packages/cli/bin/kanabun.ts build examples/counter/index.html --outdir dist
```

Scaffold a new app (the intended `kanabun create` workflow):

```sh
bun packages/cli/bin/kanabun.ts create my-app
```

A minimal component:

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

### Component helpers

- `onMount(fn)` — run once after the initial render (next microtask).
- `onCleanup(fn)` — teardown for the current scope.
- `mergeProps(...objs)` / `splitProps(props, [...keys])` — combine/divide props
  while preserving reactivity (forwarding getters).

### Context

`createContext(default)` returns a handle you provide with `<Ctx.Provider>` and
read with `useContext(Ctx)`. There's no compiler, so a Provider's children must
be a **function** — the same "functions are lazy" convention `<Show>`/`<For>`
use — so the value is set before descendants read it. Pass an accessor as the
value to make it reactive.

```tsx
import { createContext, useContext, signal } from "@kanabun/core";

const Theme = createContext("light");

function Toolbar() {
  const theme = useContext(Theme); // "dark" below, else the default "light"
  return <div class={theme}>…</div>;
}

const theme = signal("dark");
// function child (required) — runs after the value is provided:
<Theme.Provider value={theme}>{() => <Toolbar />}</Theme.Provider>;
```

`useContext` walks up the owner tree and returns the nearest provided value, or
the context's default if no Provider is above the reader. (Plain, non-function
children are built before the Provider runs, so they only ever see the default.)

### Scoped CSS

`css` is a runtime, no-compiler helper (Emotion-style): it hashes the style body
to a unique class (`k-<hash>`), scopes every rule under it, injects one `<style>`
into `<head>` (deduped by hash), and returns the class name to apply. A unique
hash means styles can never collide, so there's no selector rewriting or build
step — just string scoping.

```tsx
import { css } from "@kanabun/core";

const button = css`
  padding: 0.5rem 1rem;
  &:hover { background: #ececec; }   // & -> the scope class
  .icon  { margin-right: 4px; }      // bare selector -> descendant (.k-x .icon)
  @media (min-width: 40rem) { padding: 1rem; } // inner rules re-scoped
`;

<button class={button}>Save</button>;
```

`class` is a plain string, so apply it directly; toggle reactively with the
usual function form, e.g. `class={() => active() ? `${base} ${on}` : base}`.
Supported: top-level declarations, `&`/descendant nesting, comma lists, and
`@media`/`@supports`/`@container`/`@document`/`@layer` (their inner rules are
re-scoped). Other at-rules (`@keyframes`, `@font-face`, …) pass through verbatim
since they're inherently global. A declaration before a nested block must end
with `;` (as in Sass / native CSS nesting), and brace matching is lexical, so a
literal `{`/`}` inside a string/comment isn't understood — use a global
stylesheet for that.

Runnable examples: [`examples/counter/`](examples/counter/) and
[`examples/todomvc/`](examples/todomvc/) — serve either with
`bun examples/<name>/index.html` (uses Bun 1.3+ HTML-entry dev server).

---

## CLI (`@kanabun/cli`)

The `kanabun` command is the only Bun-dependent layer — it wraps Bun's bundler
and server so there's no esbuild/Vite dependency. `@kanabun/core` stays
runtime-independent.

```sh
kanabun create my-app     # scaffold a new project
kanabun dev               # dev server for ./index.html, full reload on change
kanabun build             # bundle ./index.html to ./dist for the browser
```

`dev` serves the HTML entry, bundles TS/TSX on the fly, and live-reloads over a
WebSocket (stateful HMR is deferred — full reload for now). `build` wraps
`bun build --target browser`.

---

## API reference

**`@kanabun/core`**

| Group | Exports |
| --- | --- |
| Reactivity | `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` |
| Lifecycle | `onMount`, `onCleanup` |
| Rendering | `render`, `jsx`, `jsxs`, `Fragment` (and low-level `createElement`, `insert`, `reconcileNodes`) |
| Control flow | `Show`, `For`, `mapArray` |
| Props | `mergeProps`, `splitProps` |
| Context | `createContext`, `useContext` |
| Styling | `css` (scoped CSS) |
| Types | `Accessor`, `Signal`, `SignalOptions`, `Disposer`, `Context`, `Props`, `JSXChild`, `JSX`, `ShowProps`, `ForProps` |

**`@kanabun/cli`** (the `kanabun` command; also importable as a library)

| Function | Purpose |
| --- | --- |
| `build(opts)` | Bundle for the browser; returns `{ success, outputs, logs }` (never throws). |
| `dev(opts)` | Start the dev server; returns `{ url, port, stop() }`. |
| `createDevHandler(opts)` | The dev `fetch` handler, for embedding/testing. |
| `create(name, opts?)` / `templateFiles(name)` | Scaffold a project / get its files. |
| `parseArgs(argv)` / `run(argv)` | Parse and dispatch CLI arguments. |

---

## Roadmap

Phases 0–5 are done (TodoMVC runs; CLI works). What's left — `context`, router,
SSR, stateful HMR — and the open design decisions are tracked in
[`docs/roadmap.md`](docs/roadmap.md) ([日本語](docs/roadmap.ja.md)).

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
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)). On push to `main`
it also derives the coverage percentage from the lcov report
(`scripts/coverage-badge.ts`) and publishes a shields.io endpoint JSON to the
orphan `badges` branch, which the coverage badge above reads — so the badge is
self-hosted, with no external coverage service. A separate
visual-regression gate screenshots the examples in a pinned Playwright
container and diffs them against committed baselines — see
[`tests/visual/README.md`](tests/visual/README.md). Playwright is CI-only
tooling, never a project dependency.

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
  core/        @kanabun/core — reactive core + DOM/JSX runtime (runtime-independent)
    src/
      reactive.ts         signals: signal/computed/effect/batch/createRoot, onMount, context
      dom.ts              render + fine-grained DOM bindings + keyed reconcile
      control-flow.ts     <Show>, <For>, mapArray (keyed)
      props.ts            mergeProps / splitProps
      css.ts              scoped CSS (hash + scope + inject a <style>)
      jsx-runtime.ts      jsx/jsxs/Fragment + JSX type namespace
      jsx-dev-runtime.ts  dev transform entry
  cli/         @kanabun/cli — the `kanabun` command (Bun-only layer)
    src/        build.ts, create.ts, dev.ts, index.ts (argv + dispatch)
    bin/        kanabun.ts
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
