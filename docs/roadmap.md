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
| 6 | Hardening & ecosystem (router, SSR, etc.) | ⬜ not started (optional) |

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
- [ ] **Router** as a separate package (`@kanabun/router`), history-based.
- [ ] **SSR + hydration.** `renderToString` on the server, hydrate on the client.
- [ ] **Stateful HMR** in the dev server (currently full reload — the deliberate
  Phase 5 simplification).
- [ ] **Error boundaries.**
- [ ] **Async / Suspense** primitives (e.g. `resource`).
- [ ] **Dev-time warnings** (e.g. reading a signal you meant to pass as a thunk).

### DX & type precision
- [ ] Tighten `JSX.IntrinsicElements`: it's intentionally permissive (`[name]: any`)
  today; add real per-element attribute and event-handler types.
- [ ] Precise `splitProps` return type (tuple of `Pick`/`Omit`) instead of the
  current loose `Array<Partial<T>>`.

### Tooling & publishing
- [ ] **Publish** `@kanabun/core` and `@kanabun/cli` to npm. Until then, the
  `create`-scaffolded `package.json` references `^0.0.0` placeholders and the
  quickstart runs from this repo.
- [ ] Versioning / release strategy.

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
