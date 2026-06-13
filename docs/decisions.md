# Design decisions

*English | [日本語](./decisions.ja.md)*

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

### 5. Zero dependencies — at runtime *and* in development

The "zero dependency" stance extends past the shipped bundle to the dev
environment itself:

- **Runtime:** zero. The core imports nothing.
- **Development:** a single, type-only dependency — `@types/bun` — is permitted
  as a deliberate exception (it supplies the `bun:test` / Bun type surface). A
  hand-written ambient shim was prototyped to reach literally zero, but
  `@types/bun` was chosen instead: accurate, maintained types beat a shim that
  must be extended every time a new test matcher is used.
- **TypeScript** is the project's sanctioned tool (per the founding charter,
  "Bun and TypeScript only"), fetched on demand via `bunx tsc` rather than
  vendored into `package.json`.
- **CI infrastructure** (GitHub Actions like `actions/checkout`,
  `oven-sh/setup-bun`) is not part of the project's dependency graph and is out
  of scope for this rule.

The net effect: `bun install` pulls only `@types/bun`, and nothing reaches the
browser but standard JS.

## Conventions & tooling

- **Test files** are named `*.spec.ts`.
- **Package manager / runner** is Bun. Use `bun test`, `bun run typecheck`
  (`bunx tsc --noEmit`), not npm/yarn equivalents.
- **Coverage** is measured by Bun's built-in `--coverage` (text + lcov), with a
  0.9 threshold configured in `bunfig.toml`. The core currently sits at 100%.
- **CI** (`.github/workflows/ci.yml`) runs typecheck, tests, and coverage on
  every push and pull request.
- **Adding any dependency** is a red flag to be justified explicitly — the
  `skeptical-reviewer` agent (`.claude/agents/`) checks for this before a task
  is reported complete.

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
/ returned-cleanup handle teardown.

Ownership was added when Phase 2 needed it (rather than deferred further):
`createRoot(fn => …)` establishes a scope; computations created inside it are
disposed together, and an effect that re-runs disposes the children it created
on its previous run (no leaks). This was added as an *additive* layer that
leaves the Phase 1 propagation — and its tests — untouched.

## Rendering decisions (Phase 2)

### Runtime JSX, no compiler

`jsx`/`jsxs`/`Fragment` build **real DOM eagerly** at call time — a
hyperscript-with-signals model. There is no virtual DOM, no diffing, and no
custom compiler: this honours the "runtime only" decision while still getting
JSX's type-checking and editor support for free (TypeScript resolves types from
our `JSX` namespace via `jsxImportSource`). Components run **once** (the Solid
model); only reactive expressions re-run.

### The reactive-expression convention: functions are reactive

Without a compiler, the source must say what's reactive. The rule: **a child or
attribute whose value is a function is reactive** (wrapped in an `effect` and
anchored by a comment marker so it keeps its position); anything else is set
once. `on*` props are always events. So `{count}` and `{() => count() * 2}` are
reactive, while `{count()}` is read once. This is the one bit of ceremony the
no-compiler choice costs, and it is small and explicit.

### Testing the DOM without a DOM dependency

The renderer needs a DOM, but Bun ships none and jsdom/happy-dom would violate
the zero-dependency stance. So the renderer resolves `globalThis.document`
lazily and tests install a tiny in-repo DOM mock (`test/dom-mock.ts`). The
`document` is never required at import time, keeping the core loadable anywhere.
The example is additionally built in CI via `bun build` to exercise the real
JSX transform end-to-end.

## Roadmap (abridged)

- **Phase 0 — scaffold:** Bun project, workspace split (`core` vs future
  `cli`), `bun test`, CI + coverage. ✅
- **Phase 1 — signals core:** `signal` / `computed` / `effect`, batching,
  cleanup; glitch-free + leak-free, fully unit-tested (100% coverage). ✅
- **Phase 2 — JSX runtime + render:** `jsx`/`jsxs`/`Fragment`, `render`,
  `createRoot`; fine-grained reactive DOM, a working counter (100% coverage). ✅
- **Phase 3 — control flow & lists:** `<Show>`, `<For>` with keyed updates;
  TodoMVC runs.
- **Phase 4 — component model & DX:** reactive props, context, lifecycle,
  bindings, scoped CSS.
- **Phase 5 — Bun integration:** `create` / `dev` / `build` CLI; HMR (full
  reload first).
- **Phase 6 — hardening (optional):** SSR/hydration, router, stateful HMR, etc.
