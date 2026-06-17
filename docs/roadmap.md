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
| 6 | Hardening & ecosystem (router, SSR, etc.) | 🟡 in progress — **router + error boundaries + dev-time warnings + SSR/hydration + async (`resource`/`<Suspense>`) + SSG (`kanabun generate`) done**; rest optional |
| 7 | Islands / partial hydration | 🔜 planned — design memo in [`decisions.md`](./decisions.md#islands--partial-hydration-phase-7--design-memo) |

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
  path (no `<Outlet>`), and params merge down the chain. *Relative `<Link>` hrefs
  remain a follow-up.*
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
- [ ] **Stateful HMR** in the dev server (currently full reload — the deliberate
  Phase 5 simplification).
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

### Phase 7 — Islands (partial hydration) (planned)
Explicit, manual islands (no compiler, no resumability) — only marked components
hydrate; the static shell ships no client JS. Full rationale and scope
boundaries in [`decisions.md`](./decisions.md#islands--partial-hydration-phase-7--design-memo).
- [ ] **`<Island>` boundary + registry (core).** A boundary that serializes to a
  `<div data-island data-props>` wrapper on the server; a client registry
  (`name → Component`) + entry that queries `[data-island]`, deserializes props,
  and mounts only those. Reuses `renderToString` (subtree) + `hydrate`
  (container) — no third render path. Props are JSON-serializable only (no
  closures/signals cross the boundary); each island is its own root (context /
  owner tree do not cross — share state via a module-level singleton signal).
- [ ] **Per-island bundle split (CLI).** The actual payload win: `packages/cli`
  code-splits per island so a page loads only the chunks for the islands it
  contains, plus a client bootstrap that mounts them. Bun/bundler work, so it
  stays in the CLI layer; core remains runtime-independent.
- Out of scope (documented): automatic island detection and node-level adoption
  (both need a compiler), and resumability (contradicts the runtime-JSX design).

### DX & type precision
- [~] Tighten `JSX.IntrinsicElements`. **Event handlers done** — `on*` props are
  typed as `EventHandler<E>` functions (a typed event), so "forgot the `() =>`"
  (`onClick={count.set(…)}`) is a compile error, while conditional handlers
  (`undefined`) and the `void`/`undefined` distinction are handled precisely. See
  [`dx.md`](./dx.md#1-type-level-checks-compile-time). **Remaining:** per-element
  *attribute* types (still `[attr]: any`).
- [ ] Precise `splitProps` return type (tuple of `Pick`/`Omit`) instead of the
  current loose `Array<Partial<T>>`.

> The three layers that *do* catch mistakes (types, runtime dev warnings, tests)
> are consolidated in [`dx.md`](./dx.md) — including what can't be caught without
> a compiler and the linter that would close that gap.

### Tooling & publishing
- [ ] **Publish** `@kanabun/core` and `@kanabun/cli` to npm. Until then, the
  `create`-scaffolded `package.json` references `^0.0.0` placeholders and the
  quickstart runs from this repo.
- [ ] Versioning / release strategy.
- [ ] **In-house linter (`kanabun lint`).** Static analysis to catch the slips
  the runtime can't — chiefly `{count()}` where `{count}` was meant in a
  child/attribute (needs to see the source before the call collapses to a value),
  plus related convention violations. **Not** an ESLint plugin (ESLint is an
  external dependency; kanabun ships zero deps) — a first-party CLI command in the
  Bun layer, reusing the on-demand TypeScript parser already used for
  typechecking. Opt-in, dev-only authoring tooling, *not* a runtime compiler
  (keeps the founding constraint intact). See
  [`dx.md`](./dx.md#4-future-an-in-house-linter).

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
