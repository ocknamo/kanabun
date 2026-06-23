# Roadmap & remaining TODO

*English | [日本語](./roadmap.ja.md)*

A snapshot of what's built and what's left. For the *why* behind the design,
see [`decisions.md`](./decisions.md).

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Scaffold: Bun workspace, tsconfig, CI, coverage | ✅ done |
| 1 | Signals core: `signal`/`computed`/`effect`, batching, cleanup, ownership | ✅ done |
| 2 | JSX runtime + `render` (fine-grained reactive DOM) | ✅ done |
| 3 | Control flow: `<Show>`, `<For>` (keyed); **TodoMVC runs** | ✅ done |
| 4 | Component model & DX | ✅ done — `onMount`, `mergeProps`, `splitProps`, scoped `css`, `context` |
| 5 | Bun integration: `create` / `dev` / `build` CLI | ✅ done |
| 6 | Hardening & ecosystem (router, SSR, etc.) | 🟡 in progress — **router + error boundaries + dev-time warnings + SSR/hydration + async (`resource`/`<Suspense>`) + SSG (`kanabun generate`) + CSS HMR done**; rest optional |
| 7 | Islands / partial hydration + ecosystem primitives (`lazy`, `<Portal>`, `<Dynamic>`, head API) + authoring tooling (`kanabun lint`, dev overlay) | 🟡 in progress — **ecosystem primitives (`lazy`, `<Portal>`, `<Dynamic>`, `<Head>`/`<Title>`) + islands core (`<Island>` / `registerIsland` / `hydrateIslands`) + per-island bundle split (CLI `buildIslands` + `hydrateIslandsLazy`) + dev overlay done**; in-house linter planned. Design memos: [`decisions.md`](./decisions.md#islands--partial-hydration-phase-7--design-memo) (islands), [`decisions.md`](./decisions.md#dev-overlay-phase-7) (overlay), [`dx.md`](./dx.md#4-future-an-in-house-linter) (linter) |
| 8 | Heavyweight ecosystem: SSR streaming (`renderToStream`), reactive store (`createStore`), `@kanabun/testing` | 🔜 planned — deferred from Phase 7 (larger subsystems) |

Quality bar held throughout: **zero runtime dependencies**, `packages/core`
runtime-independent, 100% line/function coverage on all source files, `tsc`
clean, docs bilingual.

## Remaining TODO

### Phase 4 — component model ✅ done
- [x] **`context` (`createContext` / `useContext`).** Done — **function
  children** (`<Ctx.Provider value={v}>{() => <App/>}</Ctx.Provider>`),
  consistent with the "functions are lazy" convention `<Show>`/`<For>` use. The
  compiler option was rejected (founding constraint); plain eager children see
  only the default (asserted by a test). Implementation rides the owner tree (a
  parent link + a `context` map; `useContext` walks up). See
  [`decisions.md`](./decisions.md#context-phase-4).
- [x] **Scoped CSS.** Done — a runtime, Emotion-style `css\`…\`` helper that
  hashes the body to a class, scopes its rules, and injects one `<style>`
  (deduped). See [`decisions.md`](./decisions.md#scoped-css-phase-4) for the
  options weighed (CSS-modules and Svelte-attribute styles were rejected).

### Phase 6 — hardening & ecosystem (optional)
- [x] **Router** as a separate package (`@kanabun/router`), history-based. Done —
  `<Router>`/`<Routes>`/`<Route>`/`<Link>` + `useNavigate`/`useLocation`/`useParams`,
  over a pluggable history source (`createBrowserSource` / `createHashSource` /
  `createMemorySource` — hash routing works on GitHub Pages with no rewrites).
  `<Routes>` gives exclusive (first-match) routing with a shared `fallback` for
  404s. Rides core's signals + owner-tree context; zero dependencies, 100%
  covered, runtime independent. See [`decisions.md`](./decisions.md#router-phase-6).
  **Nested routing** (layouts + child routes) is done — a `*`-wildcard route is a
  *layout* matched on a prefix; it renders a nested `<Routes>` against the leftover
  path (no `<Outlet>`), and params merge down the chain. **Relative `<Link>` hrefs**
  are done — `<Link href="edit">` / `"../list"` / `"?tab=bio"` resolve against the
  current location with the same semantics a browser uses for an `<a href>` (a pure
  `resolvePath` helper in `location.ts`; `useNavigate()` resolves relatives too, and
  the rendered anchor shows the resolved absolute path while staying reactive).
  External hrefs are left untouched.
- [x] **SSR + hydration.** Done — `renderToString` (core, runtime-independent:
  installs a serializable server DOM so the eager JSX runtime can run with no
  real `document`, builds the tree once, returns `{ html, head }` with scoped-CSS
  collected, then disposes — `onMount` doesn't fire on the server). `hydrate`
  (client) mounts the live app over the server markup. SSG falls out of the same
  `renderToString` run at build time — see **SSG** below. The example
  (`examples/ssr`) is a runnable Bun SSR server + client hydration. Node-level
  node adoption is *not* done and is documented as needing a compiler/markers —
  see [`decisions.md`](./decisions.md#ssr-hydration--ssg-phase-6). Zero deps,
  100% covered, `packages/core` stays runtime-independent.
- [x] **SSG (`kanabun generate`).** Done — a thin CLI prerender loop
  (`packages/cli/src/generate.ts`) over the SSR primitives, no new render path.
  It imports an SSG **config** (`{ routes?, render(path), client?, title?,
  document? }`), runs `renderToString` per route, and writes
  `<outdir>/<route>/index.html` (`/` → `index.html`, `/about/` →
  `about/index.html`). An optional `client` entry is bundled once and referenced
  from every page so the static HTML hydrates; without it the output is
  static-only. A `base` (config or `--base`) prefixes the client script src for
  sub-path deploys (GitHub Pages). Never throws (mirrors `build`). Route
  enumeration is the explicit `routes` array for now (router-driven enumeration /
  `getStaticPaths` for dynamic params + build-time data baking are follow-ups).
  Runnable demo: `examples/ssg`. See
  [`decisions.md`](./decisions.md#kanabun-generate--the-ssg-command).
- [x] **CSS hot-replacement (HMR)** in the dev server. Done — a `.css` change is
  hot-swapped (the dev server pushes a targeted `css:<path>` message and the
  client re-fetches just the matching `<link rel="stylesheet">` in place, so all
  app state survives; if no stylesheet matches it falls back to a reload). Any
  non-CSS change is still a **full reload**. The message decision is a pure,
  unit-tested helper (`changeMessage`). See
  [`decisions.md`](./decisions.md#css-hmr-phase-6).
- [ ] **Component-level stateful HMR** in the dev server (state preserved across a
  *code* edit). Out of reach without a compiler in this runtime-JSX, no-VDOM
  design — there are no component boundaries or render markers to swap a module
  in against. Non-CSS edits stay a full reload (the deliberate Phase 5
  simplification); CSS edits are now hot-swapped (above). See
  [`decisions.md`](./decisions.md#css-hmr-phase-6).
- [x] **Error boundaries.** Done — `catchError` (core primitive) + `<ErrorBoundary
  fallback={…}>`. Catches errors thrown while *creating* or *reactively updating*
  children and renders a fallback instead of crashing; `reset` rebuilds the
  subtree. Rides the owner tree (an error handler is stored as context under a
  private symbol; a throw walks up to the nearest one, else rethrows). Zero
  dependencies, 100% covered, runtime independent. See
  [`decisions.md`](./decisions.md#error-boundaries-phase-6).
- [x] **Async / Suspense** primitives. Done — `resource(fetcher)` /
  `resource(source, fetcher)` turns an async function into reactive state: a value
  accessor plus `loading`/`error` accessors and `{ mutate, refetch }` actions. It
  is race-safe (a stale fetch never clobbers a newer one), re-runs when its
  reactive `source` changes, and idles while the source is unready (`false`/
  `null`/`undefined`). `<Suspense fallback>` shows the fallback while a child
  resource loads *for the first time*, then reveals the children (built once under
  the boundary, kept alive while hidden — like `<Show>` with an element child); a
  later `refetch()` keeps the last value on screen (read `loading()` for an inline
  spinner). Wrap the children in a **function** so the resources are created under
  the boundary, same convention as `<Show>`/context. Errors surface via
  `resource.error()` (not auto-routed to an `<ErrorBoundary>`). Rides core's
  signals + owner-tree context; zero dependencies, 100% covered, runtime
  independent. See [`decisions.md`](./decisions.md#async--suspense-phase-6).
- [x] **Dev-time warnings.** Done — opt-in runtime diagnostics (`setDev(true)`;
  `kanabun dev` enables them automatically via `globalThis.__KANABUN_DEV__`).
  Flags owner-less `effect()`/`onMount()`/`onCleanup()` and signal writes inside
  a computed; deduped, with a settable sink (`setWarnHandler`). The "reading a
  signal you meant to pass as a thunk" case isn't robustly detectable without a
  compiler — see [`decisions.md`](./decisions.md#dev-time-warnings-phase-6) for
  why, and for what *is* detectable. Zero dependencies, 100% covered, runtime
  independent.

### Phase 7 — Islands + ecosystem primitives + authoring tooling (planned)

**Islands.** Explicit, manual islands (no compiler, no resumability) — only marked components
hydrate; the static shell ships no client JS. Full rationale and scope
boundaries in [`decisions.md`](./decisions.md#islands--partial-hydration-phase-7--design-memo).
- [x] **`<Island>` boundary + registry (core).** Done — `<Island name props>`
  looks the component up in a registry (`registerIsland(name, Component)`) and, on
  the server, renders it inside a `<div data-island data-props>` wrapper (props
  JSON-serialized into the attribute, so first paint / SEO are unchanged). On the
  client, `hydrateIslands()` queries every `[data-island]`, deserializes the props,
  resolves the component from the same registry, and `hydrate`s only those —
  nothing else executes. `defineIslands({ Counter, … })` is the type-safe path: a
  typed map whose keys constrain `<Island name>` (a typo / unregistered name is a
  compile error) and whose components type `props`, over the same runtime.
  Reuses `renderToString` (server) + `hydrate` (per
  container) — no third render path. Props are JSON-serializable only (no
  closures/signals cross the boundary); each island is its own root (context /
  owner tree do not cross — share state via a module-level singleton signal).
  Runnable demo: `examples/islands` (a static shell + two independent counter
  islands). `packages/core/src/islands.ts`. See
  [`decisions.md`](./decisions.md#islands--partial-hydration-phase-7--design-memo).
- [x] **Per-island bundle split (CLI).** Done — `buildIslands({ islands })`
  (`packages/cli/src/islands.ts`) bundles each island as its own entry with
  `splitting: true` (shared code, e.g. the core runtime, hoisted into shared
  chunks) and writes a small unbundled bootstrap (`islands.js`) that maps each
  island name to a dynamic `import()` of its chunk and hands them to core's
  `hydrateIslandsLazy`. At runtime a page pulls in **only the chunks for the
  islands it contains** (an island registered but absent is never fetched). The
  bootstrap stays unbundled so the only bundler work is the static, multi-entry
  island build; core stays runtime-independent. Runnable demo:
  `examples/islands/serve-split.ts`. See
  [`decisions.md`](./decisions.md#islands--partial-hydration-phase-7--design-memo).
- Out of scope (documented): automatic island detection and node-level adoption
  (both need a compiler), and resumability (contradicts the runtime-JSX design).

**Authoring tooling.**
- [ ] **In-house linter (`kanabun lint`).** Static analysis to catch the slips
  the runtime can't — chiefly `{count()}` where `{count}` was meant in a
  child/attribute (needs to see the source before the call collapses to a value),
  plus related convention violations. **Not** an ESLint plugin (ESLint is an
  external dependency; kanabun ships zero deps) — a first-party CLI command in the
  Bun layer, reusing the pinned TypeScript parser already used for
  typechecking. Opt-in, dev-only authoring tooling, *not* a runtime compiler
  (keeps the founding constraint intact). See
  [`dx.md`](./dx.md#4-future-an-in-house-linter).
- [x] **Dev overlay.** Done — `kanabun dev` surfaces problems on-screen, not just
  in the console: a panel pinned to the bottom of the viewport collects dev
  warnings, uncaught errors, and unhandled promise rejections (count badge +
  dismiss button). It's the *consumer* of the warning seam: rather than reaching
  across module graphs to call core's `setWarnHandler`, it taps that sink's
  default destination — patching `console.warn`/`console.error` (still forwarding
  to the originals) plus `window` `error`/`unhandledrejection` listeners — so it
  sees every dev warning with no cross-bundle wiring and no core change. Like the
  CSS hot-swap client, it's a real, unit-tested function (`devOverlay`) serialised
  into the page via `.toString()` and installed by a classic inline `<script>`
  before the deferred app module (so the earliest errors are caught). Dev-only,
  lives in the CLI/Bun layer (`packages/cli/src/dev.ts`); core stays
  runtime-independent. `<ErrorBoundary>`-handled errors show their fallback in-app
  by design and reach the overlay only if logged. See
  [`decisions.md`](./decisions.md#dev-overlay-phase-7).

**Ecosystem primitives.** — all done in core (runtime-independent, zero deps, 100% covered).
- [x] **`lazy()`.** Done — defer a component behind a dynamic `import()` so a
  bundler code-splits at the boundary; integrates with the already-shipped
  `<Suspense>` (it loads on first render and suspends the nearest boundary). The
  module is loaded **once** and cached (remounting doesn't re-import); a failed
  import is held as the underlying `resource`'s rejection (not auto-routed to an
  `<ErrorBoundary>`, mirroring `resource`). `packages/core/src/lazy.ts`.
- [x] **`<Portal>`.** Done — render children into a different DOM node (default
  `document.body`, or a `mount` target) for modals / tooltips / toasts. The
  children stay **owned by the current reactive tree**: their reactivity is
  created under the owner that renders the `<Portal>`, and disposal follows that
  owner (not the DOM location) — so unmounting removes the portaled nodes. They're
  bracketed by two comment markers in the target so the exact range (including
  nodes a reactive child adds later) is removed on cleanup; nothing renders in the
  original place. `packages/core/src/portal.ts`.
- [x] **`<Dynamic>`.** Done — render a host (tag name or component) chosen at
  runtime and reactively swap it as the value changes (remaining props/children
  forwarded). `component` follows the **function-is-reactive** convention:
  `component="div"` is a static tag, `component={() => …}` is an accessor (it may
  return a tag name or a component). Because a component is itself a function, a
  *static* component is passed through an accessor too (`component={() => MyComp}`),
  which keeps the two unambiguous with no compiler. `packages/core/src/dynamic.ts`.
- [x] **Head / metadata API (`<Head>` / `<Title>`).** Done — per-page `<head>`
  content over the `head` channel `renderToString` already returns. `<Head>`
  appends its children to `document.head` (on the server, to the server document's
  `<head>`, so it lands in the serialized `head`); `<Title>` is sugar for a
  `<title>` in `<head>` (reactive text). Content is owned by the current tree —
  reactive attributes/text update in place and the nodes are removed on the
  owner's disposal (so per-page tags don't leak across pages). For SSR,
  `renderToString` reads `<head>` *before* disposal, so `<Head>`/`<Title>` cleanup
  doesn't strip it. `packages/core/src/head.ts`.

### Phase 8 — heavyweight ecosystem (deferred from Phase 7) (planned)
Larger pieces consciously kept out of Phase 7 — each is a substantial subsystem
(a new render path, a proxy layer, or a separate package) rather than a small
primitive. None is required for the founding goal; all must hold the same bar
(zero deps, `packages/core` runtime-independent, 100% coverage, `tsc` clean).
- [ ] **SSR streaming (`renderToStream`).** Today `renderToString` builds the
  whole tree eagerly and returns one buffered HTML string. Streaming would flush
  markup as it's produced and resolve `<Suspense>` boundaries out-of-order (ship
  the fallback, then patch in resolved content) for a better TTFB. Heavy because
  it needs an *async* render path distinct from the synchronous eager one, plus a
  client that stitches the streamed-in chunks — not a tweak to `renderToString`.
- [ ] **Reactive store (`createStore`).** A nested, proxy-based store for deep
  object/array state with path-level fine-grained updates (and a `produce`-style
  setter), beyond today's flat signals. Heavy because it adds a proxy layer and a
  new update API surface; must stay zero-dep and runtime-independent (core).
- [ ] **`@kanabun/testing` utilities.** A first-party test-helper package
  (render-into-mock, `fireEvent`, flush microtasks/effects, query helpers) over
  the in-repo DOM mock, so app authors can unit-test components without jsdom —
  the same mock the core suite uses, packaged for consumers. Separate package,
  dev-only.
- (Also tracked elsewhere, not Phase 8: SSG dynamic params / `getStaticPaths` +
  build-time data baking remain a **Phase 6 (SSG)** follow-up; the router VRT
  baseline is a CI chore under *Known minor items*.)

### DX & type precision
- [x] Tighten `JSX.IntrinsicElements`. **Event handlers** — `on*` props are
  typed as `EventHandler<E>` functions (a typed event), so "forgot the `() =>`"
  (`onClick={count.set(…)}`) is a compile error, while conditional handlers
  (`undefined`) and the `void`/`undefined` distinction are handled precisely.
  **Per-element attributes** are now typed too — `IntrinsicElements` maps common
  elements to their own shapes (`a`/`input`/`button`/…), every attribute typed
  `Attr<T>` (the value *or* a reactive accessor, honouring the convention), so a
  mistyped attribute (`disabled="yes"`, `<button type="email">`) is a compile
  error with per-element autocomplete. Unlisted elements / unknown attributes
  (`data-*`/`aria-*`) stay permissive via an `[attr]: any` fallback. See
  [`dx.md`](./dx.md#1-type-level-checks-compile-time).
- [x] Precise `splitProps` return type — a tuple of `Pick` per key group then a
  trailing `Omit` for the rest (`SplitProps<T, K>`, via a `const` type parameter
  so literal keys survive inference), instead of the old loose
  `Array<Partial<T>>`.

> The three layers that *do* catch mistakes (types, runtime dev warnings, tests)
> are consolidated in [`dx.md`](./dx.md) — including what can't be caught without
> a compiler and the linter that would close that gap.

### Tooling & publishing
- [ ] **Publish** `@kanabun/core` and `@kanabun/cli` to npm. Until then, the
  `create`-scaffolded `package.json` references `^0.0.0` placeholders and the
  quickstart runs from this repo.
- [ ] Versioning / release strategy.

> The in-house linter (`kanabun lint`) now lives in **Phase 7** (authoring
> tooling), alongside islands — see above.

### Known minor items (from reviews)
- [ ] Dev server does a `realpath` stat per request for containment, in addition
  to Bun's own resolution (double stat). Fine for a dev server; note only.
- [ ] `parseArgs` treats `--a --b` as `a=true` (no value consumed); acceptable
  for current flags, document if it grows.

## Open design decisions

None open for Phase 4 — it's complete. The remaining work is Phase 6 / DX
(optional), listed above.

(Resolved: **`context` children model** — **function children**, over a compiler
or deferring. And **scoped CSS** — a runtime Emotion-style `css` helper, over a
build step or CSS-modules/Svelte-attribute shapes. See `decisions.md`.)

These mirror the original brief's "hard parts": the signal semantics (Phase 1)
and keyed lists (Phase 3) are solved; stateful HMR (Phase 5/6) was consciously
deferred to full-reload.
