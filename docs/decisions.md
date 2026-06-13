# Design decisions

This document records the choices that shape kanabun, and — just as
importantly — the alternatives that were weighed and set aside. It captures the
outcome of the initial product/design interview.

## Product framing

- **Motivation:** a *practical tool* — something usable for real projects, not
  only a learning exercise.
- **Definition of success (≈1 year):** TodoMVC runs on it and the docs are
  complete enough that others can try it.
- **First dogfooding target:** a TodoMVC-style demo is enough to validate the
  design; a specific real app can come later.
- **Near-term scope:** make the **core rock-solid** (Phase 1) before breadth.

## Core technical decisions

### 1. Reactivity via signals (not a VDOM)

Update only what changed; no virtual DOM, no diff algorithm to implement. The
core is a pure reactive graph that is fully unit-tested without any DOM.

### 2. Explicit getters, Solid-style — and therefore **no compiler**

The reactivity surface is `const count = signal(0)`, read with `count()` and
written with `count.set(v)`.

This was the single most consequential decision, because it resolves a
contradiction in the original brief, which asked for both:

- a *Svelte-style feel* (`let count = $state(0); count++`), and
- *no compiler*.

These cannot coexist. Detecting a plain local-variable assignment like
`count++` at runtime is impossible — Svelte 5's `$state` only looks like magic
because its **compiler** rewrites that code into tracked `get`/`set` calls. So
the "Svelte feel" is inherently a compiler product.

Three resolutions were considered:

| Option | Ergonomics | Compiler | Verdict |
| --- | --- | --- | --- |
| **A. Explicit getter (Solid)** | `count()` / `count.set()` | none | **Chosen** |
| B. Proxy object (Vue) | `s.count` / `s.count++` | none | Rejected: Proxy edge cases (destructuring breaks tracking, nested/array/Map handling) make "rock-solid" harder, and reads still need a getter at the template boundary. |
| C. Svelte-style (`count++`) | best | **required** | Rejected for now: pulls a whole compiler in *before* the core is solid — the opposite of the chosen priority. |

Option **A** was chosen because it is the only one that lines up with every
other answer — *no compiler*, *core first*, *focused effort* — and it is the
strategy SolidJS has already proven. The `()` is a small, honest cost: it *is*
the subscription, visible in the source.

This does not foreclose option C forever: a future compiler could add `$state`
sugar on top of the same runtime. A is the floor, not the ceiling.

### 3. Templates via JSX (a later phase)

When templates arrive they will be JSX/TSX, so TypeScript natively type-checks
elements, attributes, props, and embedded expressions, and editors get
completion and highlighting for free. kanabun supplies only the JSX type
definitions and a tiny `jsx`/`jsxs`/`Fragment` runtime — **no LSP, no custom
DSL**. (tsconfig is already wired to `jsxImportSource: "@kanabun/core"`.)

### 4. Bun for tooling, but the core stays runtime-independent

`@kanabun/core` uses standard JS / Web APIs only, so it can ship anywhere. Bun
is used purely for the developer experience (test runner, and later the
bundler/dev-server) and is confined to a thin CLI/dev layer that never
contaminates the core.

## Reactive core semantics (Phase 1)

The propagation algorithm is the push–pull "coloring" scheme (à la
Reactively/Solid). Two semantics were nailed down deliberately, because they
are the hardest to change later:

- **Glitch-free:** in a diamond (`a → b, a → c, (b,c) → d`), a single write to
  `a` recomputes each node at most once and never exposes an inconsistent
  intermediate (no transient wrong value at `d`). Verified by tests.
- **Automatic subscription cleanup:** dependencies are re-collected on every
  run, so a computation that stops reading a source is unsubscribed from it
  (no leaks, dynamic dependencies just work). Verified by tests.

Disposal is explicit at the leaf: `effect` returns a disposer, and `onCleanup`
/ returned-cleanup handle teardown. Ownership trees (auto-disposing nested
effects) are deferred to the component model in a later phase.

## Roadmap (abridged)

- **Phase 0 — scaffold:** Bun project, workspace split (`core` vs future
  `cli`), `bun test`. ✅
- **Phase 1 — signals core:** `signal` / `computed` / `effect`, batching,
  cleanup; glitch-free + leak-free, fully unit-tested. ✅
- **Phase 2 — JSX runtime + render:** `jsx`/`jsxs`/`Fragment`, `render`; a
  working counter.
- **Phase 3 — control flow & lists:** `<Show>`, `<For>` with keyed updates;
  TodoMVC runs.
- **Phase 4 — component model & DX:** reactive props, context, lifecycle,
  bindings, scoped CSS.
- **Phase 5 — Bun integration:** `create` / `dev` / `build` CLI; HMR (full
  reload first).
- **Phase 6 — hardening (optional):** SSR/hydration, router, stateful HMR, etc.
