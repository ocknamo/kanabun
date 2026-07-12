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
- **Development:** two pinned, exact-versioned dev dependencies are permitted as
  deliberate exceptions: `@types/bun` (type-only; supplies the `bun:test` / Bun
  type surface) and `typescript` (the project's sanctioned tool). A hand-written
  ambient shim was prototyped to reach literally zero, but `@types/bun` was
  chosen instead: accurate, maintained types beat a shim that must be extended
  every time a new test matcher is used.
- **TypeScript** is the project's sanctioned tool (per the founding charter,
  "Bun and TypeScript only"). It was previously fetched on demand via `bunx tsc`,
  which floated to the latest release on every run — so a new TS version could
  break typechecks with no code change, and offline/restricted environments
  couldn't typecheck at all. It is now a **pinned** dev dependency for
  reproducibility; `bunx tsc` resolves the committed local binary. (This is a
  dev-time choice only — nothing reaches the browser, so the zero-*runtime*-
  dependency stance is unchanged.)
- **Bun** is pinned in `.bun-version` (a single source of truth that CI passes
  to `oven-sh/setup-bun` via `bun-version-file`), so local and CI runs agree on
  the runtime version.
- **CI infrastructure** (GitHub Actions like `actions/checkout`,
  `oven-sh/setup-bun`) is not part of the project's dependency graph and is out
  of scope for this rule.

The net effect: `bun install` pulls only `@types/bun` and `typescript` (both
pinned), and nothing reaches the browser but standard JS.

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

A reactive slot whose value resolves to **another function** (a reactive child
returned by a component — e.g. `<Show>{() => <Suspense>…</Suspense>}`) gives that
inner function its *own* nested slot rather than reading it inline. Each function
level is therefore insulated: a dependency change re-runs only the level that
read it, never rebuilding the subtree above. Without this, an inner component's
reactive reads would leak into the outer slot's tracking and rebuild the whole
subtree on every change — and for a suspending child (which re-creates its
resource on rebuild) that is an infinite load/render loop.

### Testing the DOM without a DOM dependency

The renderer needs a DOM, but Bun ships none and jsdom/happy-dom would violate
the zero-dependency stance. So the renderer resolves `globalThis.document`
lazily and tests install a tiny in-repo DOM mock (`packages/testing/src/dom-mock.ts`,
shipped to app authors as `@kanabun/testing` — see the Phase 8 memo). The
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
  an update over a WebSocket on file change — a targeted **CSS hot-swap** for
  `.css` edits, a **full reload** for everything else (see
  [CSS HMR](#css-hmr-phase-6)). The request handler is factored out
  (`createDevHandler`) so it's unit tested without standing up a socket.
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
- **No wrapper required (a former caveat, now lifted).** A nested `<Routes>` works
  the same whether it sits inside a host element (a layout's chrome —
  `<div class="users-layout">`) or is returned *bare* straight up to the parent
  route. Core now gives every reactive thunk its own insert slot (see "functions
  are reactive" above), so a bare nested router no longer leaks its `$matched`
  read into the parent's tracking: an inner navigation re-selects only the child
  and keeps the layout mounted. (Previously the bare form rebuilt the layout on
  every inner navigation, so a host-element wrapper was mandatory.)

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

## Dev overlay (Phase 7)

`kanabun dev` now surfaces problems **on-screen**, not just in the console: a
panel pinned to the bottom of the viewport collects dev warnings, uncaught
errors, and unhandled promise rejections, with a running count and a dismiss
button. It is the *consumer* of the warning seam above.

- **Lives entirely in the CLI/Bun layer; core is untouched.** Like the CSS
  hot-swap client (`swapCss`), the overlay is a real, unit-tested function
  (`devOverlay`) serialised into the dev page via `.toString()` and installed by
  a classic inline `<script>` *before* the deferred app module — so it captures
  even the earliest warnings/errors (this assumes the app starts via a
  deferred/`type="module"` script, as the standard template does; a non-deferred
  classic `<script>` placed earlier could run before the overlay installs).
  `packages/core` stays runtime-independent (it gains nothing for the overlay).
- **It taps the warning sink's default destination rather than reaching across
  bundles.** The inline overlay script and the bundled core are separate module
  graphs, so the overlay can't call core's `setWarnHandler` directly. It doesn't
  need to: dev warnings already route through a sink that *defaults to*
  `console.warn`, so the overlay patches `console.warn`/`console.error` (still
  forwarding to the originals — nothing is swallowed) and thereby sees every dev
  warning with no cross-bundle wiring and no core change. Uncaught errors and
  rejections come from `window` `error` / `unhandledrejection` listeners.
- **`<ErrorBoundary>`-handled errors** show their fallback in-app by design and
  aren't separately logged, so they reach the overlay only if the app/boundary
  logs them — routing every caught error there would need a core seam, out of
  scope for a dev-only overlay.

Held to the same bar: 100% line/function coverage on `dev.ts`, clean `tsc`, zero
dependencies.

## SSR, hydration & SSG (Phase 6)

The framing decision: **SSG is not a separate feature — it is SSR run at build
time instead of request time.** The two share one server-side primitive
(`renderToString`) and one client-side primitive (`hydrate`); the only
difference is *when* `renderToString` runs and whether its output is cached to
disk. Designing SSG as its own thing would mean a second render path. Instead:

```
core:  renderToString(() => <App/>)  → HTML string, no DOM, signals read once
       hydrate(() => <App/>, root)   → mount the live tree over server markup
                                       (clears + re-renders; no node adoption)
SSR  = renderToString at request time, returned in the response
SSG  = renderToString at build time, written to .html files (+ optional hydrate)
```

So the build order is SSR/hydration first; SSG then reduces to a thin CLI
prerender loop, with **no new rendering logic**.

- **`renderToString` lives in core and never touches `document`.** The live
  `render` (`dom.ts`) walks the tree wrapping dynamic bits in `effect`s against
  a real DOM. The server has no DOM and needs no reactivity — markup is produced
  once — so `renderToString` is a separate walk that **reads a reactive value
  exactly once** (calls the accessor, does not subscribe) and concatenates
  strings. It is pure standard JS (no `Bun.*`/`fs`/`document`), so it stays in
  `packages/core` and keeps the runtime-independence rule. Writing files for SSG
  is the only step that needs `fs`, and that lives in the CLI/Bun layer.
- **Hydration is "mount over markup", not node-level adoption — and that is a
  consequence of the founding constraints, not laziness.** The server HTML
  paints first (fast first paint, SEO); then `hydrate` clears it and mounts the
  live reactive tree in its place. Because the bytes are identical there is no
  visual flash. What it does *not* do is adopt the existing server nodes (reuse
  them in place, only wiring listeners/effects). Here's why that's not feasible:
  the JSX runtime builds DOM **eagerly and bottom-up** — `jsx("div", {children:
  [jsx("span", …)]})` evaluates the inner `jsx` (and its `createElement`) before
  the outer one, so a child node is constructed before anything knows where in
  the server tree it belongs. Node-level adoption needs a top-down cursor over
  the server DOM, which in turn needs either compiler-emitted hydration markers
  or template cloning (how Solid does it). Both are ruled out by the "no
  compiler" constraint, so adoption is documented future work, not a v1
  promise. The cost we accept is losing in-place node reuse (and transient focus
  state in the mounted subtree) — not correctness or first paint.
- **Scoped CSS collects into the server `<head>` — the shared gotcha.** `css`'s
  `inject` appends a `<style data-k>` to `document.head`. On the server the
  installed `ServerDocument` *has* a `<head>`, so styles emitted **during** the
  render collect there for free and `renderToString` returns them as its `head`
  string. The wrinkle is import-time styles: a module-level `` css`…` `` runs
  before `renderToString` installs its document, when there is no `document` at
  all — so `inject` buffers those in a `pending` map instead of throwing, and
  `renderToString` replays them (`flushStyles`) once its document is in place.
  The `data-k` hash on each tag means the client dedupes against the
  server-sent `<style>` on hydration rather than injecting a duplicate. Shared
  by SSR *and* SSG — neither has a live browser `<head>` at module-eval time.
- **Hydration is identical for SSR and SSG.** Nothing in the client path cares
  whether the markup came from a request or a build. SSG adds no hydration code.
- **SSG-only concerns** (deferred until the SSR primitives land): enumerating
  *which* paths to prerender (a route list from the router, or an explicit array;
  dynamic params want a `getStaticPaths`-style enumerator); and baking *data* at
  build time, since there is no per-request server — this is where Async/Suspense
  (`resource`) and a serialized data snapshot matter. A fully static page (events
  only, no fetched data) needs neither. The existing hash-router / GitHub Pages
  story composes cleanly with prerendering each route to an `index.html`.

### `kanabun generate` — the SSG command

The prerender loop promised above ships as **`kanabun generate [entry]`**
(`packages/cli/src/generate.ts`): the Bun layer that turns the two core
primitives into static files. It imports an SSG **config** module, and for each
route calls `renderToString(() => render(path))`, wraps the markup in an HTML
document, and writes `<outdir>/<route>/index.html` (`/` → `index.html`,
`/about/` → `about/index.html`).

- **The config is the SSG contract.** `{ routes?, render(path), client?, title?,
  document? }`. `render` returns the view for a path; `routes` defaults to
  `["/"]`; `client` (resolved relative to the config file) is bundled **once**
  with `Bun.build` and referenced from every page so the static HTML hydrates; a
  custom `document` overrides the built-in shell. A config with no `client` is
  static-only — no client JS ships.
- **No new render path — pure orchestration.** `generate` is just
  `renderToString` (core) + `Bun.build` + `fs`, exactly the "thin CLI prerender
  loop" framed above. The render stays runtime-independent in core; only the file
  writing and client bundling live in the CLI.
- **Never throws, like `build`.** A bad entry, a failed client bundle (`Bun.build`
  throws an `AggregateError`, unpacked by `errorMessages` — the same path
  `build` relies on), or a throwing `render` is reported as
  `{ success: false, logs }`.
- **Route enumeration is explicit (the `routes` array) for now.** Pulling the
  list from `@kanabun/router` and a `getStaticPaths`-style enumerator for dynamic
  params remain the documented follow-ups, as does build-time data baking (a
  serialized `resource` snapshot). `examples/ssg` is the runnable demo — two
  routes, scoped CSS, a hydrated counter.
- **A `base` path makes the output deployable under a sub-path.** A project site
  (e.g. GitHub Pages at `/repo/`) serves assets from a prefix, so the absolute
  `/main.js` src would 404. `base` (config or the `--base` flag; the flag wins)
  is normalized to a single leading + trailing slash and prefixes the client
  `<script>` src; it's also exposed on `DocumentContext` so a custom `document`
  can build correct asset/link URLs. App-internal links staying base-relative is
  the app's (or a future router-relative-`<Link>`) concern, not `generate`'s.

Held to the same bar: zero dependencies, `packages/core` runtime-independent,
100% line/function coverage, `tsc` clean, docs bilingual.

### `serve` / `preview` — the SSR serve layer (Phase 6 follow-up)

For a while SSR was asymmetric with SSG: `generate` gave SSG a config + command,
but every SSR entry hand-rolled ~55 lines of `Bun.serve` + `Bun.build` + an HTML
shell + `process.env.PORT` (and the repo grew four copies of the shell and three
of the traversal-guarded static-file loop). The examples doubled as a
demonstration that Bun-specific code lives outside core — a point worth one
demo, not four copies of boilerplate every user would have to re-write. The fix
applies the `generate` decision symmetrically:

- **The SSR config mirrors the SSG config.** `serve(config)` /
  `createSSRHandler(config)` (`packages/cli/src/serve.ts`) take `{ render(path),
  client?, islands?, title?, base?, document? }` — the `SSGConfig` shape minus
  `routes` (a server renders whatever path arrives), plus `islands`. The same
  mental model drives both: SSG runs `render` at build time, SSR per request.
- **One document template.** The built-in HTML shell moved to
  `packages/cli/src/document.ts` (`DocumentContext` + `defaultDocument`) and is
  shared by `generate` and `serve`, so prerendered and per-request pages are
  identical. One lexical containment helper (`resolveWithin` in `paths.ts`)
  replaced the three hand-rolled static-serving guards (dev / SSG preview /
  islands preview).
- **`client` is bundled once at startup** (kept in memory) — the old examples
  re-ran `Bun.build` per request. An `islands` map instead builds per-island
  chunks (`buildIslands`) into a temp dir and serves them next to the pages, so
  `examples/islands/serve-split.ts` collapsed to a config too.
- **Startup failures throw** (unlike `build`/`generate`'s `{ success: false }`):
  there is no result object to report through, and a server that can't build its
  client should not start. Render-time errors surface per request.
- **`preview`** (`packages/cli/src/preview.ts`) is `generate` into a temp dir (or
  `--outdir`) + the static-file handler — the SSG counterpart for "just let me
  look at it", and what the visual-regression lane boots. Both ship as commands
  (`kanabun serve [ssr.tsx]` / `kanabun preview [ssg.tsx]`) and as library
  exports; the default port comes from `$PORT` (then 3000) so entries never read
  `process.env` themselves.

The examples (`examples/ssr/server.tsx`, `examples/islands/server.tsx`,
`examples/islands/serve-split.ts`, `examples/ssg/serve.ts`) are now ~10-line
configs; the runtime-independence demo lives in this layer's own docs instead.

## Async / Suspense (Phase 6)

`resource` turns an async function into reactive state, and `<Suspense>` shows a
fallback while it loads. Like the rest of Phase 6, both ride existing machinery
(signals + the owner-tree context) and add no new primitives to the core.

- **A resource is three signals + a version counter.** `value`, `loading`, and
  `error` are plain signals; reading the resource (`data()`) reads `value`, and
  `data.loading()` / `data.error()` are accessors over the other two — explicit
  getters, no property-getter magic (the framework's convention). A monotonically
  increasing `version` is captured per load; when a fetch settles it is dropped
  unless its version is still current. That single check makes the resource
  **race-safe**: a slow first request can't clobber the value a faster, newer
  request (or a `mutate`) already wrote.
- **The source is reactive; an unready source idles.** `resource(source, fetcher)`
  wraps the fetch in an `effect` that reads `source()`, so a changing source
  refetches. A source of `false`/`null`/`undefined` means "not ready" — it cancels
  any in-flight load (bump `version`) and stays idle, mirroring Solid. With no
  source, `resource(fetcher)` loads once (the source is a constant `true`).
- **The fetcher call is deferred a microtask.** `load` does
  `Promise.resolve().then(() => fetcher(…))` so a *synchronous* throw becomes a
  rejection (uniform error handling) and `loading` is observably `true` before the
  resolution — even for a fetcher that returns a value synchronously.
- **Errors surface via `error()`, not the owner tree.** A rejected fetch sets
  `error` rather than throwing into the reactive graph. Routing it to the nearest
  `<ErrorBoundary>` would mean throwing during a reactive *read*, which the eager,
  bottom-up runtime can't tie back to the right boundary cleanly — the same
  no-cursor limitation that shapes hydration. Exposing `error()` is predictable
  and lets the UI choose; an explicit `<ErrorBoundary>` story for resources can
  come with a compiler/markers later.
- **`<Suspense>` builds its children once, then *chooses* — exactly like
  `<ErrorBoundary>`.** It provides a `SuspenseContext` (a tiny
  increment/decrement registry over a `pending` counter) and builds the children
  **once, in their own `createRoot`, under that context**. A resource created in
  the subtree finds the registry via `useContext` and increments it while loading,
  so the render thunk merely reads `pending()` and returns the fallback or the
  (already built, kept-alive) children. Building once is essential: were the
  children rebuilt lazily when `pending` hit zero, hiding them would dispose the
  resource, which would decrement, which would reveal them, which would recreate
  the resource — an infinite loop. Keeping them alive while hidden is just `<Show>`
  with an element child.
- **Only the first load suspends.** A resource registers with the boundary only
  until its first success (`resolvedOnce`); later `refetch()`s set `loading` but
  don't re-increment, so the last value stays on screen (read `loading()` for an
  inline spinner). This is the common "show stale content while revalidating"
  behaviour, again matching Solid.
- **Children are a function (lazy), same as `<Show>`/context/`<ErrorBoundary>`.**
  Wrap them in a thunk so the resources are *created under* the boundary (and thus
  see its context); a plain eager child is built before `<Suspense>` runs and
  registers with nothing.

Held to the same bar: zero dependencies, `packages/core` runtime-independent,
100% line/function coverage, `tsc` clean, docs bilingual.

## CSS HMR (Phase 6)

The dev server used to do one thing on any file change: a **full reload**. The
common inner-loop edit — tweaking styles — therefore threw away the very app
state you were styling against (an open menu, a filled form, a deep route). CSS
hot-replacement fixes exactly that case without crossing the line the design
draws elsewhere.

- **Why CSS only, and not component HMR.** True stateful HMR re-evaluates a
  changed *module* and swaps it into the live tree while preserving state. That
  needs **component boundaries and render markers** to know *what* to swap and
  *where* — which is precisely what a compiler/transform provides (React Fast
  Refresh, Vite). kanabun is runtime JSX with **no compiler** and **no VDOM**:
  the render is eager and bottom-up, so there are no boundaries to swap against
  (the same reason node-level hydration adoption is out — see
  [SSR](#ssr-hydration--ssg-phase-6)). A `.css` file, by contrast, isn't tied to
  any of that — it's a `<link>` the browser can simply re-fetch. So CSS HMR is
  the slice of "stateful HMR" that is *actually reachable* here, and it covers
  the highest-frequency edit.
- **Mechanism.** The file watcher classifies each change with a pure
  `changeMessage(filename)` helper: a `.css` path becomes `css:/<path>`
  (OS separators normalised to URL form), anything else stays `reload`. The
  injected client runtime, on a `css:` message, walks `link[rel="stylesheet"]`,
  and for each whose URL **pathname** matches the changed path, clones it with a
  fresh cache-busting query and removes the old link once the clone loads (no
  flash). App state is untouched because nothing re-executes. **Fallback:** if no
  stylesheet matches (e.g. the `.css` is imported through a JS module rather than
  linked), it falls back to a full reload, so an edit is never silently dropped.
- **Why a pure helper.** Pulling the decision out of the watcher callback into
  `changeMessage` keeps it unit-testable without standing up a socket or a real
  file-system event (the socket path is still covered by a live test that writes
  a `.css` and asserts the `css:` message arrives), matching how
  `createDevHandler` is factored out from the server.
- **Scoped `css\`…\`` is intentionally not hot-swapped.** It's content-hashed to
  a class, so editing the body changes the class — which requires re-running the
  module, i.e. the component HMR that needs a compiler. Those edits remain a full
  reload. External stylesheets are the part that can be swapped statefully.

Held to the same bar: zero dependencies, the CLI is the only Bun-dependent
layer, 100% line/function coverage, `tsc` clean, docs bilingual.

## Islands / partial hydration (Phase 7) — design memo

> Status: **core built** (`packages/core/src/islands.ts`); the per-island bundle
> split (CLI) is still planned. The memo below records the approach; the "As
> built" note at the end records where the implementation landed.

The framing decision: **partial hydration in kanabun is an explicit "islands"
model, not automatic analysis or resumability.** A page is mostly static
server-rendered HTML; only the components marked as *islands* ship and run on
the client. Each island is its own independent mount point — the static shell
around it has no client JS.

- **Why islands fit this architecture better than full-page hydration does.**
  Today `hydrate` clears the container and re-renders the whole tree (no
  node-level adoption — see "SSR, hydration & SSG" above for why eager
  bottom-up JSX rules adoption out without a compiler). Islands turn that
  limitation into a non-issue: each island is a *small, independent* container
  that clears and re-renders its own subtree against the identical server bytes
  (no flash), while everything outside any island is never re-rendered and
  never shipped. We sidestep the adoption problem instead of solving it — and
  we do it **without a compiler**, honouring the founding constraint. The same
  two primitives (`renderToString` on a subtree, `hydrate` on a container) are
  reused; islands are a composition of them, not a third render path.
- **The boundary is explicit and manual — by necessity, like the rest.** With
  no compiler there is nothing to *detect* which components are interactive, so
  the author marks them: an `<Island name="Counter" props={…}>…</Island>`
  boundary (closer to Astro's `client:*` directives than to a framework that
  infers islands). On the server it serializes to a wrapper element carrying
  the island name and its props — e.g. `<div data-island="Counter"
  data-props='{"start":0}'>…children…</div>` — and the children render normally
  into it (so first paint / SEO are unchanged). A client **registry** maps
  `name → Component`; the client entry queries every `[data-island]`,
  deserializes its props, and mounts only those. Nothing else executes.
- **Props cross the boundary as data, not closures.** The server→client gap is
  a serialization gap: island props must be JSON-serializable. Closures,
  signals, and DOM refs cannot cross it — an island that needs live data
  imports/subscribes to it on the client side, or receives plain values and
  builds its own reactive state. This is a real constraint to document loudly,
  not a bug.
- **Each island is its own root; context and owner tree do not cross.** Islands
  mount independently, so an island cannot `useContext` a value a server-side
  ancestor provided — the owner tree was torn down at the serialization
  boundary. Cross-island shared state is expressed the ordinary JS way: a
  module-level singleton signal/store that the islands import (module scope is
  shared on the client even though the owner trees are not).
- **The actual payload win lives in the CLI, not core.** Core can *express*
  islands (boundary + registry + props (de)serialization) and that alone makes
  hydration partial in *execution*. But the point of islands is to ship *less
  JavaScript*, and that requires the build layer (`packages/cli`, the Bun-only
  layer) to **code-split per island** so a page pulls only the chunks for the
  islands it contains. Without that split you still ship all island code.
  Bundle splitting is inherently Bun/bundler work, so the CLI is the correct
  home for it; core stays runtime-independent.
- **Scope boundaries.** *In core (small):* an `<Island>` boundary, a registry,
  and JSON props (de)serialization, all reusing existing primitives. *In the
  CLI:* per-island chunking + a client bootstrap that loads and mounts the
  islands present on the page. *Explicitly out of scope:* automatic island
  detection (needs a compiler), node-level adoption (same), and resumability
  (no re-execution at all — a fundamentally compiler/serialization-heavy model
  that contradicts the runtime-JSX design). The order mirrors Phase 6: the core
  boundary first (with a runnable `examples/ssr` island demo), the CLI split
  second.

Held to the same bar: zero dependencies, `packages/core` runtime-independent,
100% line/function coverage, `tsc` clean, docs bilingual.

**As built (core).** The boundary is **registry-driven on both sides**, which
keeps the name → component mapping a single source of truth: `registerIsland(
name, Component)` populates a module-level registry, and `<Island name props>`
looks the component up there (rather than taking it as a child) before rendering
`<div data-island data-props>…rendered…</div>`. That symmetry is the point — the
server renders by name, the client hydrates by the same name, and the props are
written once. The registration module is imported for its side effect by **both**
the server render and the client entry (module scope is the shared channel; the
owner trees are not). `hydrateIslands({ root?, registry? })` queries
`[data-island]` (defaulting to the whole `document`), `JSON.parse`s `data-props`
(absent → `{}`), resolves the component, and `hydrate`s each container; it returns
a disposer that tears every mounted island down. An unregistered name throws on
both sides (a loud, early failure rather than a silent no-op). Nested islands are
detected against the original tree (before the first `hydrate` detaches them),
skipped, and flagged with a dev warning — the "islands are flat" rule can't be
expressed structurally without a compiler, so the runtime guards it instead of
mounting onto a detached node.

**Compile-time names (`defineIslands`).** The string-keyed `registerIsland` +
global `<Island name>` resolves names at runtime, so a typo only fails when the
page renders. `defineIslands({ Counter, … })` closes that gap: it takes a typed
map and returns an `<Island>` / `hydrateIslands` pair bound to it, with
`<Island name>` constrained to the map's keys (`const` type parameter so the
literal keys survive) and `props` typed per component — an unregistered name is a
**compile error**. It reuses the same `lookup`/`hydrateIslands` internals (the map
is just passed as the explicit registry), so there is one runtime path; the
factory only adds types. The string API stays for dynamic registration. The demo
(`examples/islands`) is an SSR shell with two independent counter islands wired
through `defineIslands`.

**As built (CLI — the payload win).** `buildIslands({ islands })`
(`packages/cli/src/islands.ts`) bundles each island as its own entrypoint with
`splitting: true` (so shared code — notably the core runtime — is hoisted into
shared chunks rather than duplicated) and writes a tiny **unbundled** bootstrap
(`islands.js`) that maps each island name to a dynamic `import()` of its chunk and
hands them to core's `hydrateIslandsLazy`. At runtime the bootstrap scans
`[data-island]` and calls only the present islands' loaders, so a page downloads
just the chunks for the islands it actually contains.

Two design choices worth recording. (1) **The bootstrap is generated but not
bundled** — it's plain ES modules the browser resolves, so the only bundler work
is the static, multi-entry island build. This was also forced by a constraint:
Bun's in-process `Bun.build` (under `bun test`) rejects dynamic-import bundling,
so a generated *bundled* bootstrap couldn't be unit-tested; a multi-entry build +
unbundled bootstrap is both cleaner and fully coverable. (2) **`hydrateIslandsLazy`
lives in core**, not the CLI — it's the runtime half (scan + lazy-load + hydrate),
runtime-independent like the rest of islands; the CLI only generates the loader
map and runs the bundler. Unlike `hydrateIslands` (which throws on an unknown
name), a missing loader is skipped with a dev warning — it's the production client
entry, so one mis-wired island shouldn't blank the page. The runnable demo is
`examples/islands/serve-split.ts` (build → SSR → serve; the network tab shows only
the present islands' chunks load).

## Ecosystem primitives (Phase 7)

Four small, self-contained primitives that ride the existing core (signals, the
owner tree, `insert`, the SSR head channel) — no new render path, no
dependencies, `packages/core` stays runtime-independent.

### `lazy()` — `<Suspense>`'s missing partner

`lazy(() => import("./X"))` returns a component that loads its module on first
render and renders it once resolved. It is built on `resource`: the loader
becomes a resource fetcher, so a `lazy` component **suspends the nearest
`<Suspense>`** exactly like any other resource (the wiring already existed). No
second mechanism. The module promise is **cached** (`cached ??= loader()`) so the
import runs at most once across every instance and remount; a rejected promise is
cached too, so a later mount surfaces the same error rather than silently
retrying (matching `resource`, which does not auto-route to an `<ErrorBoundary>`).
Render it under a `<Suspense>` via a **function** child, the same convention every
resource follows.

### `<Portal>` — owned by the tree, not the DOM location

Teleports children into another DOM node (default `document.body`). The design
constraint is that the children stay **owned by the reactive tree that rendered
the `<Portal>`**: their effects are created under that owner (so context and
disposal flow normally), even though the nodes live elsewhere. Removal is the
only thing the DOM location complicates — so the content is bracketed by two
comment markers in the target and the whole range is removed on the owner's
cleanup. That captures nodes a *reactive* child inserts after mount too (a single
end-marker + `insert(target, children, end)` keeps all dynamic content inside the
range). On the server the target is the server document's `<body>`, which
`renderToString` does not serialize — so portals are a **client concern**; the
`<body>` field on the server/mock document just keeps the default target from
being absent. For per-page `<head>` content use `<Head>` (below).

### `<Dynamic>` — a runtime-chosen host, and the function-ambiguity it forces

`<Dynamic component={…}>` renders a tag name or a component picked at runtime and
swaps it reactively. The hard part in a no-compiler, eager-props framework is that
**a component is itself a function**, and so is a reactive accessor — there is no
way to tell `component={MyComp}` (a static component) from `component={() => …}`
(an accessor) by inspection. Rather than a fragile heuristic, `<Dynamic>` applies
the framework's deepest convention unchanged — *a function is reactive* — and
types `component` as `string | (() => tag | component)`. So a tag is passed bare
(`component="div"`), and everything reactive (including a static component) goes
through an accessor (`component={() => MyComp}`). This is unambiguous, needs no
compiler, and reads the same as `<Show>`/`<For>` children. The returned thunk
rebuilds the host on change; the enclosing `insert` effect disposes the previous
host's scope on each swap (the same disposal `<Show>`/`<For>` rely on).

### Head / metadata API (`<Head>` / `<Title>`)

`<Head>` appends its children to `document.head`; `<Title>` is sugar for a
`<title>` there (reactive text). It reuses the SSR head channel: on the server the
scoped-`css` helper already injects into the server document's `<head>` and
`renderToString` returns it, so `<Head>` just appends to the same place and its
content lands in the serialized `head`. Two decisions:

- **Children are built once and appended (not a reactive top-level slot).** Head
  content is structural (`<title>`, `<meta>`, `<link>`) with reactivity in its
  *attributes/text* (`content={() => …}`), so `<Head>` uses `normalize` to build
  the nodes once and appends them — marker-free, so the serialized `<head>` stays
  clean (no comment nodes). The trade-off (documented): a *function* child is read
  once, unlike `<Show>`'s lazy children; put reactivity in attributes/text.
- **SSR reads `<head>` before disposal.** `<Head>`/`<Title>` remove their nodes on
  the owner's cleanup (so per-page tags don't leak across client navigations). But
  `renderToString` disposes the root at the end of the render — which would strip
  the head before serialization. So it now serializes `<head>` *inside* the render
  scope, before `dispose()`. This is a no-op for the `css` helper (it never
  removes its styles), so existing SSR output is unchanged.

Held to the same bar: zero dependencies, `packages/core` runtime-independent,
100% line/function coverage, `tsc` clean, docs bilingual.

## `@kanabun/testing` (Phase 8)

App authors need to unit-test components, and the zero-dependency stance rules
out jsdom/happy-dom for them just as it does for us. But the answer already
existed in-repo: the tiny DOM mock the core suite runs against. Phase 8's
`@kanabun/testing` packages that mock — plus the helpers every spec was
hand-rolling around it — for consumers. Decisions:

- **The mock moved packages** (`packages/core/src/dom-mock.ts` →
  `packages/testing/src/dom-mock.ts`). Publishing is per-package
  (`files: ["src"]`), so `@kanabun/testing` could not ship a relative import
  into core's source tree; the file had to live inside the package that
  exports it. Dependency direction stays acyclic: testing declares core as a
  peer dependency (for `renderTest`'s `render`), and core's *specs* import
  testing — specs aren't part of the shipped dependency graph. (Those specs do
  ship inside core's `files: ["src"]` tarball referencing a package consumers
  may not have installed; harmless, since nothing imports a spec at runtime.)
- **The mock is product code now.** It was a coverage-ignored fixture; as a
  shipped package it is covered like any other source (100% lines/functions,
  with its own spec pinning the edge branches). Only the router's `WindowLike`
  fakes (`router-test-utils.ts`) remain coverage-ignored fixtures.
- **Runtime-independent, hooks stay in user land.** The package must run under
  any test runner, so it never imports `bun:test` — which also means it cannot
  register `beforeEach`/`afterEach` itself. `installDOM()` returns a teardown
  for callers who wire hooks; `renderTest` covers the common case instead: if
  no `document` exists it installs the mock (before rendering — the renderer
  resolves `globalThis.document` lazily) and restores it on `dispose()`; a
  caller-installed document is reused and left alone.
- **The existing suites are the first consumers.** Every DOM-using core and
  router spec imports these helpers instead of hand-rolling them (the
  copy-pasted `tick`s, the five identical `byTag`s, TodoMVC's recursive query
  toolkit, the router's `findTag`/`leftClick`) — so the published API is
  exercised by the framework's own tests, not just its own spec files. Direct
  vs subtree lookups are split by name (`childByTag` vs `queryByTag`) because
  both shapes existed in the suites and silently swapping semantics during the
  migration was the real risk.
- **`fireEvent` wraps, `dispatch` stays.** The mock's synchronous
  `MockNode.dispatch` is the primitive every migrated spec already calls;
  `fireEvent` just adds the common payloads (a real `leftClick`, `keydown` with
  a `key`) on top.

Two follow-up stages (agreed at ship time) landed later:

- **Stage 1 absorbed the last hand-rolled helpers**: `deferred()` (the
  controllable promise `async`/`lazy` specs copy-pasted), `docHead()`/`docBody()`
  (typed accessors over the installed document; a missing document throws a
  pointer at `installDOM`), `childById`/`queryById` (named symmetrically with
  the tag lookups), the scoped-CSS inspectors `styles()`/`ruleFor()`, and
  `captureWarnings()` (a collecting sink over core's `setWarnHandler`; restore
  with `setWarnHandler(null)`). Two decisions fell out of the no-`bun:test`
  rule: `ruleFor` *throws* unless exactly one rule matches (the original
  asserted with `expect`, which a shipped, runner-independent helper can't),
  and `captureWarnings` can't register cleanup hooks — nor can it clear core's
  process-wide warning dedupe, which stays out of reach by design (`__resetDev`
  is core-internal); its docstring says so.
- **Stage 2 added testing-library-style ergonomics — partially, on purpose.**
  A two-tier API over the same lookups: `queryBy*` returns `undefined` (assert
  absence), `getBy*` throws `Unable to find …` carrying the serialized tree
  (a failed lookup reads as a real failure, not `.toBeDefined()` on
  `undefined`). Both tiers return the *first* match in document order — unlike
  testing-library, a multiple match does not throw (the roadmap asked for a
  miss to throw; multiple-match detection buys little against a mock this
  small and is documented as the deviation it is). `getByText`/`queryByText`
  match an element's **own text** — its direct text-node children joined,
  child elements excluded (testing-library's `getNodeText`) — so the innermost
  element wins and wrapping ancestors don't also match; string equality or a
  RegExp, no whitespace normalization (the mock stays literal). `within(root)`
  binds every subtree query, and `renderTest` spreads those bound to its
  container (`RenderTestResult extends BoundQueries`). Still deliberately
  unadopted: `getByRole` (needs an implicit-ARIA table — conflicts with the
  minimal mock), `findBy*`/`waitFor` (reactivity is synchronous; `await
  tick()` suffices), and user-event (the mock has no bubbling/default
  actions — `fireEvent`'s honesty is the point).

Held to the same bar: zero dependencies, runtime-independent, 100%
line/function coverage, `tsc` clean, docs bilingual.

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
- **Phase 6 — hardening (optional):** **router + error boundaries + dev-time
  warnings + SSR/hydration + async (`resource`/`<Suspense>`) + SSG + CSS HMR
  done** (above). Remaining: component-level stateful HMR (needs a compiler),
  etc. (optional).
- **Phase 7 — islands / partial hydration (planned):** an explicit `<Island>`
  boundary + client registry so only marked components hydrate; the per-island
  bundle split (the real payload win) lives in the CLI. Design memo above. 🔜
