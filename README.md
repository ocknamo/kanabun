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
`splitProps`, scoped `css`, `context`), error boundaries, SSR
(`renderToString` / `hydrate`) + SSG (`kanabun generate`), async data
(`resource` / `<Suspense>`), ecosystem primitives (`lazy`, `<Portal>`,
`<Dynamic>`, `<Head>` / `<Title>`), islands (`<Island>` / `registerIsland` /
`hydrateIslands`), a router (`@kanabun/router`), and a CLI
(`create` / `dev` / `build` / `generate`) are implemented and tested.
**TodoMVC runs; `kanabun dev` and `kanabun build` work.**

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

### Error boundaries

`<ErrorBoundary>` catches errors thrown while **creating** or **reactively
updating** its children and renders a `fallback` instead of crashing the app.
Wrap the children in a function (the same lazy convention) so their creation is
guarded too. The `fallback` may be a node, or `(err, reset) => node` where
`reset` clears the error and rebuilds the children.

```tsx
import { ErrorBoundary } from "@kanabun/core";

<ErrorBoundary fallback={(err, reset) => (
  <div>
    <p>Something broke: {String(err)}</p>
    <button onClick={reset}>Retry</button>
  </div>
)}>
  {() => <Widget />}
</ErrorBoundary>;
```

Under the hood the error handler is stored on the owner tree (like context); a
throw walks up to the nearest boundary, or rethrows to the host if there is none.
`catchError(tryFn, handler)` is the same mechanism as a primitive, for catching
imperatively.

### Async data: `resource` and `<Suspense>`

`resource` turns an async function into reactive state — a value accessor plus
`loading()` / `error()` accessors and `{ mutate, refetch }` actions. It is
race-safe (a stale fetch never overwrites a newer one) and re-runs whenever its
optional reactive `source` changes (a `false` / `null` / `undefined` source means
"not ready — don't fetch yet").

```tsx
import { resource, Suspense } from "@kanabun/core";

function Profile(props: { id: () => number }) {
  // Refetches whenever id() changes; data() is undefined until it resolves.
  const [user, { refetch }] = resource(props.id, (id) => fetchUser(id));
  return (
    <div>
      <h1>{() => user()?.name ?? ""}</h1>
      {() => (user.loading() ? <span>refreshing…</span> : null)}
      <button onClick={refetch}>Reload</button>
    </div>
  );
}

// <Suspense> shows the fallback while a child resource loads for the *first*
// time, then reveals the children. A later refetch() keeps the last value on
// screen (read loading() for an inline spinner). Wrap children in a function so
// the resources are created under the boundary.
<Suspense fallback={<p>Loading…</p>}>
  {() => <Profile id={id} />}
</Suspense>;
```

Errors surface via `resource.error()` (they aren't auto-routed to an
`<ErrorBoundary>`), so the UI can decide how to show them.

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

Runnable examples: [`examples/counter/`](examples/counter/),
[`examples/todomvc/`](examples/todomvc/), [`examples/router/`](examples/router/)
and [`examples/primitives/`](examples/primitives/) (a tour of `lazy` / `<Portal>`
/ `<Dynamic>` / `<Head>`) — serve any with `bun examples/<name>/index.html` (uses
Bun 1.3+ HTML-entry dev server). The SSR example ([`examples/ssr/`](examples/ssr/))
and the islands example ([`examples/islands/`](examples/islands/)) run as servers:
`bun examples/ssr/server.tsx` / `bun examples/islands/server.tsx`.

---

## SSR & hydration (`renderToString` / `hydrate`)

Render to an HTML string on the server (or at build time), then make it
interactive on the client. `renderToString` needs no real DOM — it installs a
serializable server DOM, builds the tree once (reactive values are read once,
not subscribed; `onMount` does not fire), and returns the markup plus the
scoped-CSS to inline in `<head>`.

```tsx
// server (or a build-time prerender)
import { renderToString } from "@kanabun/core";
const { html, head } = renderToString(() => <App />);
const page = `<!doctype html><html><head>${head}</head>` +
             `<body><div id="app">${html}</div>` +
             `<script type="module" src="/main.js"></script></body></html>`;

// client (main.tsx)
import { hydrate } from "@kanabun/core";
hydrate(() => <App />, document.getElementById("app")!);
```

**SSG is the same `renderToString`, run at build time** and written to `.html`
files instead of returned per request — shipped as the **`kanabun generate`**
command (see below). `hydrate` mounts the live app over the server markup (the
page already painted, so no flash); it does not adopt the existing nodes in
place — that needs a compiler/markers, which the no-compiler constraint rules
out. See [`docs/decisions.md`](docs/decisions.md#ssr-hydration--ssg-phase-6).

---

## CLI (`@kanabun/cli`)

The `kanabun` command is the only Bun-dependent layer — it wraps Bun's bundler
and server so there's no esbuild/Vite dependency. `@kanabun/core` stays
runtime-independent.

```sh
kanabun create my-app     # scaffold a new project
kanabun dev               # dev server for ./index.html, full reload on change
kanabun build             # bundle ./index.html to ./dist for the browser
kanabun generate ssg.tsx  # prerender routes to static .html (SSG)
```

`dev` serves the HTML entry, bundles TS/TSX on the fly, and live-reloads over a
WebSocket (stateful HMR is deferred — full reload for now). `build` wraps
`bun build --target browser`.

`generate` is SSG: it imports an SSG config (`{ routes?, render(path), client?,
title?, base?, document? }`), runs `renderToString` per route, and writes
`<outdir>/<route>/index.html`. An optional `client` entry is bundled once and
referenced from every page so the static HTML hydrates into a live app; without
it the output is static-only. `base` (or `--base`, e.g. `/repo/`) prefixes the
client `<script>` src so the output deploys under a sub-path (GitHub Pages). See
[`examples/ssg/`](examples/ssg/).

---

## Router (`@kanabun/router`)

A history-based router in a separate package — built entirely on the core's
signals and owner-tree context, so it adds **zero dependencies** and stays
runtime-independent (browser globals are resolved lazily; tests and SSR use an
in-memory history source).

```tsx
import { Router, Route, Link, useParams } from "@kanabun/router";

function User() {
  const params = useParams();             // reactive route params
  return <h2>User {() => params().id}</h2>;
}

function App() {
  return (
    <Router>
      {() => (                            // function child: lazy, like <Show>
        <>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/users/1">User 1</Link>
          </nav>
          <Routes fallback={<p>404</p>}>  {/* first match wins; else fallback */}
            <Route path="/" children={<p>home</p>} />
            <Route path="/users/:id" children={() => <User />} />
          </Routes>
        </>
      )}
    </Router>
  );
}
```

`<Route>` matches a pattern (`/`, `/users/:id`, `/files/*rest`) and, like
`<Show>`, memoizes the match to a boolean so content is built once per match
while params keep updating. A standalone `<Route>` renders independently; wrap
them in `<Routes>` for **exclusive** routing — the first matching route wins and
a shared `fallback` covers the unmatched case (a natural 404). Only `<Route>`
children render inside `<Routes>`, so keep shared chrome (nav, headings) outside
it. `<Link>`
intercepts plain left-clicks (modified clicks and external links fall through).
`useNavigate` / `useLocation` / `useParams` read the nearest `<Router>`. The
`source` prop swaps the history backend: omit it for the browser history,
`createHashSource()` for static hosts like **GitHub Pages** (routes live in the
URL hash, so deep links and refreshes work with no server rewrites),
`createMemorySource()` for tests/SSR, or your own `RouterSource`.

**Nested routing.** Give a route a `*`-wildcard tail (`path="/users/*"`) and it
becomes a *layout* that matches on a prefix. Its component renders a nested
`<Routes>` against the leftover path — placed inside a host element (the layout's
own chrome), which *is* the outlet (no `<Outlet>` component). Params merge down
the chain, so a descendant `useParams()` reads the whole nested capture (`{ org,
id }`):

```tsx
<Routes>
  <Route path="/users/*" component={() => <UsersLayout />} />
</Routes>;

function UsersLayout() {
  return (
    <div class="users-layout">
      <UserList />                          {/* stays mounted across detail nav */}
      <Routes fallback={<p>Pick a person.</p>}>
        <Route path="/:id" children={() => <User />} />
      </Routes>
    </div>
  );
}
```

---

## API reference

**`@kanabun/core`**

| Group | Exports |
| --- | --- |
| Reactivity | `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` |
| Lifecycle | `onMount`, `onCleanup` |
| Rendering | `render`, `hydrate`, `jsx`, `jsxs`, `Fragment` (and low-level `createElement`, `insert`, `reconcileNodes`) |
| Server (SSR/SSG) | `renderToString` (→ `{ html, head }`; no DOM needed) |
| Control flow | `Show`, `For`, `mapArray` |
| Error handling | `ErrorBoundary`, `catchError` |
| Async | `resource`, `Suspense` |
| Ecosystem primitives | `lazy` (code-split), `Portal` (teleport), `Dynamic` (runtime host), `Head` / `Title` (document head) |
| Islands | `defineIslands` (typed registry — compile-time name/props), `Island` (boundary), `registerIsland`, `hydrateIslands` (partial hydration) |
| Props | `mergeProps`, `splitProps` |
| Context | `createContext`, `useContext` |
| Styling | `css` (scoped CSS) |
| Dev warnings | `setDev`, `setWarnHandler` (opt-in; `kanabun dev` enables them) |
| Types | `Accessor`, `Signal`, `SignalOptions`, `Disposer`, `Context`, `Props`, `JSXChild`, `JSX`, `EventHandler`, `HTMLAttributes`, `ShowProps`, `ForProps`, `ErrorBoundaryProps`, `RenderToStringResult`, `Resource`, `SuspenseProps`, `LazyModule`, `PortalProps`, `DynamicProps`, `HeadProps`, `TitleProps`, `IslandProps`, `IslandBoundaryProps`, `IslandComponent`, `IslandRegistry`, `HydrateIslandsOptions`, `IslandsMap`, `DefinedIslands` |

**`@kanabun/cli`** (the `kanabun` command; also importable as a library)

| Function | Purpose |
| --- | --- |
| `build(opts)` | Bundle for the browser; returns `{ success, outputs, logs }` (never throws). |
| `dev(opts)` | Start the dev server; returns `{ url, port, stop() }`. |
| `createDevHandler(opts)` | The dev `fetch` handler, for embedding/testing. |
| `create(name, opts?)` / `templateFiles(name)` | Scaffold a project / get its files. |
| `parseArgs(argv)` / `run(argv)` | Parse and dispatch CLI arguments. |

**`@kanabun/router`**

| Group | Exports |
| --- | --- |
| Components | `Router`, `Routes`, `Route`, `Link` |
| Hooks | `useNavigate`, `useLocation`, `useParams` |
| Sources | `createBrowserSource`, `createHashSource`, `createMemorySource` |
| Matching | `matchPath`, `matchRoute`, `parsePath` |
| Types | `RouterProps`, `RoutesProps`, `RouteProps`, `RouteHandle`, `RouteThunk`, `LinkProps`, `Navigate`, `NavigateOptions`, `RouterSource`, `MemorySource`, `WindowLike`, `RouterLocation`, `RouteParams`, `RouteMatch` |

---

## Roadmap

Phases 0–5 are done (TodoMVC runs; CLI works), Phase 6 ships a router
(`@kanabun/router`), error boundaries, dev-time warnings, SSR/hydration, async /
Suspense, and SSG (`kanabun generate`), and Phase 7 adds the ecosystem
primitives (`lazy`, `<Portal>`, `<Dynamic>`, `<Head>` / `<Title>`) and the islands
core (`<Island>` / `registerIsland` / `hydrateIslands`). What's left — the
per-island bundle split (CLI) + authoring tooling (`kanabun lint`, dev overlay),
and stateful HMR — and the open design decisions are tracked in
[`docs/roadmap.md`](docs/roadmap.md) ([日本語](docs/roadmap.ja.md)).

Because there's no compiler, mistake-catching leans on three layers — typed
`on*` handlers, opt-in runtime dev warnings (`setDev`), and tests. They're
consolidated in [`docs/dx.md`](docs/dx.md) ([日本語](docs/dx.ja.md)).

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
  router/      @kanabun/router — history-based router (runtime-independent)
    src/        location.ts (parse/match), source.ts (history sources), router.ts (components + hooks)
examples/
  counter/     a runnable reactive counter
  todomvc/     a runnable TodoMVC
  router/      a runnable multi-page router demo
  primitives/  a tour of lazy / <Portal> / <Dynamic> / <Head>
  islands/     a static shell + two independently-hydrated islands
  ssr/ ssg/    server-rendered + statically-generated demos
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
