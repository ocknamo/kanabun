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

## Control-flow decisions (Phase 3)

### Keyed lists in two layers

The hard part — efficient array updates — is split into two small, independently
testable pieces:

- `mapArray` (in `<For>`) keeps **node identity stable per item**, keyed by
  reference: a node is created once per item, reused on reorder/insert, and each
  item runs in its own `createRoot` so a removed item's reactivity is disposed.
- `reconcileNodes` (in the DOM runtime) syncs the DOM to a target node list by
  identity, removing what's gone and moving only nodes that are genuinely out of
  place (back-to-front anchoring).

Composed, they give keyed updates with no full rebuild. The algorithm isn't the
LIS-optimal minimum number of moves (Solid's udomdiff is), but it's O(n),
correct, and plenty for TodoMVC; it can be upgraded behind the same seam later.

### `<Show>` / `<For>` are components, not magic

They're ordinary components that run once and return a reactive thunk, so they
ride the exact same insertion path as any other reactive child — no special
casing in the renderer. `<Show>` memoizes its condition to a boolean so children
aren't swapped while the condition merely changes among truthy values.

`<Show>` disposal follows the "functions are lazy" convention rather than a
compiler: a plain element child (`<Show><Child/></Show>`) is created once and
only *detached* while hidden — its reactivity stays live — whereas a function
child (`<Show>{() => <Child/>}</Show>`) is created lazily, so hiding disposes
the child's scope (via the owner tree) and showing recreates it. Both behaviours
are pinned by tests, so the trade-off is explicit rather than accidental.

## Scoped CSS (Phase 4)

Scoped styling had to fit the founding constraints — **runtime only, no
compiler, zero dependencies** — which rules out Svelte's build-time selector
rewriting. Three runtime shapes were weighed:

| Option | Shape | Verdict |
| --- | --- | --- |
| **A. Emotion-style `css\`…\`** | hashes the body to a class, scopes rules under it, returns the class name | **Chosen** |
| B. CSS-modules-style `css({ name: rules })` | object of declarations → map of hashed class names | Rejected: most robust (no selector parsing) but awkward for pseudo-classes, nesting, and media queries. |
| C. Svelte-style attribute scoping | normal selectors + a `data-` attribute injected onto elements | Rejected: needs a real CSS parser **and** JSX-tree attribute injection — heavy, and at odds with the "thin, rock-solid runtime" priority. |

**A** wins because it matches the roadmap's own description ("hash a class +
inject a `<style>`") and the framework's ethos: a unique content hash means two
distinct style blocks can never collide, so there is **no selector rewriting
against the live DOM and no build step** — only string scoping. `class` stays a
plain string, so the JSX runtime needs no changes; reactive toggling reuses the
existing function-is-reactive convention (`class={() => on() ? a : b}`). It's
also the only option the popular *styled-components* editor tooling lights up
for free (it keys off a tag literally named `css`), and that tooling is an
editor extension, not a project dependency — so the zero-dep rule is untouched.

The scoping is a deliberately **bounded** transform (so it stays testable at
100%): top-level declarations land under `.k-hash`; nested blocks scope `&` to
the class or, without `&`, become a descendant; comma lists scope each part
(commas inside `()`/`[]` are preserved); conditional group at-rules
(`@media`/`@supports`/`@container`/`@document`/`@layer`) recurse and re-scope
their inner rules, while other at-rules (`@keyframes`, `@font-face`) pass through
verbatim because they are inherently global. The one acknowledged limitation:
brace matching is lexical, so a literal `{`/`}` inside a string or comment isn't
understood — component styles essentially never need that, and a global
stylesheet covers the rest. Dedup is by hash, checked against the live `<head>`,
so it survives across renders without a module-level cache to reset.

## Context (Phase 4)

`createContext` / `useContext` had one real design fork, flagged in the roadmap:
in a **runtime, no-compiler** model JSX children are evaluated *eagerly* (they
are constructor arguments), so a `<Provider>` cannot set a value before its
children read it. Three answers were weighed:

| Option | Shape | Verdict |
| --- | --- | --- |
| **A. Function children** | `<Ctx.Provider value={v}>{() => <App/>}</Ctx.Provider>` — the thunk runs *after* the value is set | **Chosen** |
| B. Pull in a compiler | rewrite JSX so children are lazy automatically | Rejected: the framework's founding "no compiler" constraint. |
| C. Keep deferring | ship without context | Rejected: it was the last open Phase 4 item. |

**A** wins because it reuses the convention the framework already has —
"**functions are lazy**", exactly how `<Show>`/`<For>` treat their children. No
new mental model, no compiler, no dependency. The cost is explicit: plain
(eager) children only ever see the *default*, which is asserted by a test so the
limitation can't silently regress.

Implementation rides the existing **owner tree** (Solid-style). Each reactive
node gains a parent link (`owner`) and an optional `context` map; `useContext`
walks up from the current owner and returns the nearest provided value (or the
default). The Provider creates one owner scope holding the value, owned by the
enclosing owner so it disposes with it. Two subtleties shaped the code:

- **Deferred thunks.** A component child like `<For>` returns a *thunk* that the
  outer `insert` runs later, inside an effect created *outside* the Provider's
  scope. So the Provider wraps such a returned thunk to **re-enter its owner
  scope on every call** (ownership only — tracking is untouched, so the `<For>`
  keeps its dependencies). Without this, rows would walk an owner chain that
  misses the value. Direct DOM children need no wrapping: their bindings' effects
  are created synchronously while the scope is active.
- **`createRoot` parent link.** `createRoot` now records its parent owner
  (`owner.owner = prevOwner`). This is what lets a `<For>` row — which runs in
  its own root — still resolve a Provider above the list. It does not change
  disposal (a root is still an explicit boundary); it only makes the owner tree
  walkable upward for context.

## CLI decisions (Phase 5)

`@kanabun/cli` is the **only** Bun-dependent layer; the core never imports
Bun/Node APIs. The `kanabun` command has three subcommands:

- `build` wraps `Bun.build({ target: "browser" })` — no esbuild/Vite. It never
  throws: an unresolvable entry or a compile error comes back as
  `{ success: false, logs }`.
- `dev` is a thin server on Bun's built-in `Bun.serve`: it serves the HTML
  entry (injecting a live-reload snippet), bundles TS/TSX on demand, and pushes
  a **full reload** over a WebSocket on file change. Stateful HMR is deferred
  (per the roadmap's "reload first") because it's the heaviest, least-leveraged
  piece. The request handler is factored out (`createDevHandler`) so it's unit
  tested without standing up a socket.
- `create` scaffolds a runnable project from an embedded template (no network).

The CLI is held to the same bar as the core: 100% coverage, including a live
dev-server test (start on an ephemeral port, fetch HTML + bundled JS, and assert
a WebSocket reload fires on file change).

## Router (Phase 6)

`@kanabun/router` is a history-based, separate package. It honours the same
founding constraints as the core — **zero dependencies, no compiler, runtime
independent** — and introduces no new machinery: it rides the existing signals,
the owner-tree context, and the "functions are lazy" convention `<Show>`/`<For>`
already use.

- **A history-source seam.** A `RouterSource` is the thin boundary between the
  router's reactive state and *where* the URL actually lives. `createBrowserSource`
  drives `window.history`/`location`/`popstate` (resolving `window` **lazily**, so
  importing the module never needs a DOM); `createHashSource` stores the route in
  the URL hash (`#/path`) for static hosts with no rewrite rules (GitHub Pages,
  S3, file servers) — deep links and refreshes just work; `createMemorySource` is
  an in-process implementation for tests and non-browser/SSR hosts. The seam is
  what makes the router 100% unit-testable without jsdom **and** what made hash
  routing a ~20-line addition rather than a rewrite — `<Router>` is unchanged.
- **A reactive current location.** `<Router>` owns a single signal tracking the
  current path, subscribes to the source (torn down via `onCleanup`), and parses
  it with `computed` into a `RouterLocation` (`pathname`/`search`/`hash`/`query`).
  `push`/`replace` don't notify — the router updates itself synchronously after
  navigating, so only back/forward fire the subscription.
- **`<Route>` borrows `<Show>`'s semantics.** The match is memoized to a
  **boolean**, so content is built once on match (and disposed on mismatch) while
  the params still update reactively underneath — a param change within the same
  route does not rebuild. The matcher (`matchPath`) is a pure function handling
  static / `:param` / trailing `*wildcard` segments.
- **`<Routes>` for exclusive matching (and 404).** Standalone `<Route>`s are
  independent toggles (every match renders), which is wrong for a catch-all. So
  `<Routes>` renders the **first** matching child and a shared `fallback` when
  none match. The trick, with no compiler and eager JSX: a `<Route>` returns a
  *thunk that also carries its match state* (`$matched` / `$content` — functions
  can hold properties), so it still renders standalone, while `<Routes>` reads
  those fields to pick one — mirroring Solid's `<Switch>`/`<Match>`. Naming
  follows React Router (`<Routes fallback>`) over Solid's `<Switch>`.
- **Disposal via an explicit `createRoot` slot.** The context wrap that lets
  deferred reads resolve the router runs the whole route subtree under the
  *stable* Router owner, so a re-running insert effect's `disposeOwned` never
  reaches the previous route — it would leak on every switch. Both `<Route>` and
  `<Routes>` therefore render content through a small "disposable slot" that owns
  it in its own `createRoot` and tears the old one down on switch/unmount — the
  same explicit-disposal pattern `<For>`/`mapArray` use.
- **Params, two ways.** The accessor is passed directly to `component`/function
  children, *and* exposed via a `RouteContext` so descendants can read
  `useParams()`. The latter reuses core's context, so those descendants must live
  under **function** (lazy) children — the same eager-children limitation context
  already documents (eager children only ever see the default, here an empty obj).
- **`<Link>`.** An `<a>` that navigates client-side. Only a plain left-click is
  intercepted; modified clicks, non-left buttons, a `target` other than `_self`,
  and external/`mailto:` links fall through to the browser's default behaviour.

The router is held to the same bar: 100% line/function coverage and a clean
`tsc`. `examples/router` is verified in a real browser (the `snapshot` skill) for
client-side navigation (no reload), `:id` resolution, the live `useLocation`
readout, and scoped CSS. (A committed VRT baseline for the example is a
follow-up — it must be captured in the pinned Playwright container.)

### Nested routing (Phase 6)

Layouts + child routes, again with **no new machinery** — relative matching rides
the same owner-tree context the flat router already uses.

- **A wildcard tail makes a route a layout.** `matchRoute` (the matcher, now
  exported alongside `matchPath`) returns, besides the params, a `rest`: for a
  `*`-wildcard pattern (`/users/*`) that's the **prefix** match's leftover path,
  kept *raw* so a nested router decodes its own params; for an exact pattern it's
  `null`. A `<Route>` matches against the leftover its nearest matched ancestor
  left (a new `RelPathContext`, default = the full pathname), so a route's
  patterns are written **relative** to where it's nested.
- **The nested router *is* the outlet.** Rather than a `<Outlet>` placeholder fed
  by a child-route config (which would need the child `<Route>`s constructed
  before their parent matched — the eager-children problem), a layout just renders
  a nested `<Routes>`/`<Route>` *inside its own component body*, which runs under
  the parent route's context, so the nested routes see the leftover path. This is
  more consistent with kanabun's "components are functions placed where they
  render" model, and needs no extra component.
- **Params merge down the chain.** A nested `<Route>` unions its captures over its
  ancestor's (`{ ...parent, ...local }`), so a descendant `useParams()` reads the
  whole chain (`{ org, id }`). The stable empty reference is preserved at the top
  level for unmatched reads.
- **One caveat, the same one core already has.** The nested `<Routes>` must sit
  inside a host element (a layout's chrome — `<div class="users-layout">`), so it
  gets its own reactive insert boundary. A *bare* thunk returned straight up to
  the parent route is flattened into the parent's tracking (functions reaching
  `reconcile` are read once), which would rebuild the layout on every inner
  navigation. The flat example already follows this (its `<Routes>` lives inside
  `<div class={shell}>`); layouts naturally have a wrapper, so it costs nothing.

`examples/router` demonstrates it: a `/users/*` layout keeps the master list
mounted while a nested `<Routes>` swaps the detail pane. *Relative `<Link>` hrefs
(resolving against the current route) remain a follow-up — hrefs are absolute.*

## Error boundaries (Phase 6)

`catchError` (a core primitive) and `<ErrorBoundary>` (the component) let a
subtree fail without taking the whole app down. Like context, they introduce no
new machinery — they ride the **owner tree** that already exists.

- **An error handler is just owner-tree context.** `catchError(tryFn, handler)`
  creates an owner scope whose `context` carries `handler` under a private
  `ERROR` symbol — exactly how `createContext`'s `Provider` stores a value. When
  a computation throws, the propagation core walks **up the owner chain** for the
  nearest such handler (`handleError`), mirroring how `useContext` walks up for a
  value. No handler found ⇒ the error is rethrown, so an unguarded failure still
  reaches the host instead of being silently swallowed.
- **One catch point in the core.** A derivation's `update()` wraps its `fn()` in
  a single `try`/`catch`. On a throw it drops the half-collected dependencies,
  marks itself CLEAN (so a re-validating pull can't loop on it), and routes the
  error. This is the *only* change to the reactive core, and it's a no-op on the
  happy path — the glitch-free propagation is untouched.
- **Both creation *and* update errors are caught.** An error thrown while a
  descendant effect/computed *re-runs* is caught in that `update()` and routed.
  An error thrown while *building* the children (a component function that throws
  outright) is caught synchronously by `catchError`'s own `try`/`catch`. Because
  the guarded scope is registered on the owner tree, effects created under it
  route to the handler even when they first run *later*, in a subsequent flush.
- **`<ErrorBoundary>` builds its children once, then only *chooses*.** The
  component builds the guarded children **eagerly, in their own `createRoot`**,
  wrapped in `catchError` whose handler sets a `failure` signal. Its render thunk
  then merely reads `failure` and returns the (already built) children or the
  fallback — it does **not** rebuild on every render. That isolation is what makes
  *nesting* safe: a nested boundary's reactive reads run inside the parent's slot,
  so were the children rebuilt in the render thunk, an inner failure would re-run
  the parent, recreate the inner boundary (clearing its caught error), and
  re-throw forever. Building once breaks that loop. `reset` rebuilds (disposing
  the old, broken `createRoot` subtree first); the rebuild is wrapped in `batch`
  so disposing, clearing the error, and rebuilding settle before the boundary
  re-renders. The `fallback` is either a static node or `(err, reset) => node`,
  matching React's ergonomics without a compiler.
- **Children are a function (lazy), same as `<Show>`/context.** Wrap children in
  a thunk so their *creation* is guarded too; a plain (eager) child is built
  before the boundary runs, so only its later updates would be caught.

Held to the same bar: 100% line/function coverage and a clean `tsc`, zero
dependencies, runtime independent.

## Dev-time warnings (Phase 6)

Because there's **no compiler**, a class of mistakes can't be caught at build
time. `setDev(true)` enables a small set of **runtime diagnostics** as the
fallback — the things the "functions are reactive / getters are explicit"
convention makes easy to get wrong.

- **Opt-in, off by default.** Production and the test suite stay silent unless
  they opt in, so there's no console noise and no cost on the hot path when off
  (`warn` early-returns). `kanabun dev` flips it on automatically by injecting a
  classic inline `<script>globalThis.__KANABUN_DEV__ = true</script>` before the
  (deferred) app module — the served page and the bundled core share `globalThis`,
  so no cross-bundle import wiring is needed. `setDev(true)` forces it on in any
  other setup.
- **Deduplicated, with a settable sink.** Each distinct message is emitted at
  most once (a re-running effect can't flood the console), and warnings route
  through `setWarnHandler` so a future dev overlay can intercept them; `null`
  restores `console.warn`. Only `console`/`globalThis` are touched, so the module
  stays runtime-independent.
- **What it catches** (each detectable from state the core already tracks, with
  low false-positive risk):
  - **`effect()` created outside any owner** — it won't be auto-disposed (the
    `render`/`createRoot` owner is missing), a likely leak. `computed` is *not*
    flagged: a module-level derived value is legitimate and has no side effects.
  - **`onCleanup()` outside an owner** — the callback would silently never run.
  - **`onMount()` outside an owner** — it runs, but isn't tied to a lifecycle
    (`onCleanup` inside it is ignored).
  - **Writing a signal while a computed is evaluating** — a side effect inside
    something meant to be pure (detected via the active `listener` being a
    non-effect derivation). Effects are allowed to write, so they're exempt.
- **Why not "you called `{count()}` where you meant `{count}`"?** That's the
  motivating example, but it isn't robustly detectable at runtime: by the time
  the JSX child is built, `count()` has already collapsed to a plain value,
  indistinguishable from a literal — and reading a signal during synchronous
  render is often legitimate. Catching it reliably needs a compiler, which the
  founding constraints rule out. The warnings above target what *can* be detected
  from the reactive graph without guessing.

Held to the same bar: 100% line/function coverage and a clean `tsc`, zero
dependencies, runtime independent.

## Roadmap (abridged)

- **Phase 0 — scaffold:** Bun project, workspace split (`core` vs future
  `cli`), `bun test`, CI + coverage. ✅
- **Phase 1 — signals core:** `signal` / `computed` / `effect`, batching,
  cleanup; glitch-free + leak-free, fully unit-tested (100% coverage). ✅
- **Phase 2 — JSX runtime + render:** `jsx`/`jsxs`/`Fragment`, `render`,
  `createRoot`; fine-grained reactive DOM, a working counter (100% coverage). ✅
- **Phase 3 — control flow & lists:** `<Show>`, `<For>` with keyed updates
  (two-layer `mapArray` + `reconcileNodes`); TodoMVC runs (100% coverage). ✅
- **Phase 4 — component model & DX:** reactive props, children, bindings, and
  `ref` already work from Phases 2–3; added `onMount`, `mergeProps` /
  `splitProps`, scoped `css`, and `context` (`createContext` / `useContext`,
  function-children — see below). ✅
- **Phase 5 — Bun integration:** `create` / `dev` / `build` CLI; dev server with
  full-reload over WebSocket. Bun-only layer, 100% covered. ✅
- **Phase 6 — hardening (optional):** **router done** (`@kanabun/router`, above).
  Remaining: SSR/hydration, stateful HMR, etc. (optional).
