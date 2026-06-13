# CLAUDE.md

Guidance for Claude when working in this repository.

kanabun is a Svelte-flavoured frontend framework built on **Bun + TypeScript**
with **zero runtime dependencies**. Signals + runtime JSX (no virtual DOM, no
compiler). See `docs/decisions.md` (and `.ja.md`) for the design rationale.

## ⚠️ Required workflow: review before reporting done

**Before reporting any implementation/fix task as complete, you MUST run the
`skeptical-reviewer` subagent** (`.claude/agents/skeptical-reviewer.md`) and act
on its findings:

- Fix every 🔴 (must-fix) before reporting completion.
- Address or explicitly justify 🟡 (recommended).
- Run it per meaningful step / phase, not only at the very end.

Do not declare a phase or task finished without a clean (or consciously
accepted) review.

## Conventions (the reviewer enforces these — so should you)

- **Zero dependencies.** No runtime deps, ever. The only permitted dev
  dependency is `@types/bun` (type-only). Do **not** add packages. TypeScript is
  fetched on demand via `bunx tsc` (not vendored).
- **`packages/core/` stays runtime-independent.** Standard JS / Web APIs only
  (the DOM is fine). No `Bun.*`, `process`, `node:*`, `fs`, etc. Runtime-specific
  code belongs in a future thin CLI/dev layer.
- **Signals use explicit getters.** Read `count()`, write `count.set(v)` /
  `count.update(fn)`. No compiler magic.
- **Reactivity convention:** a child/attribute that is a *function* is reactive
  (`{count}`, `{() => …}`); `{count()}` is read once; `on*` props are events.
- **Tests are named `*.spec.ts`** and live in `packages/core/test/`. Aim to keep
  source files at 100% coverage. The renderer is tested against the in-repo DOM
  mock (`test/dom-mock.ts`) — never add jsdom/happy-dom.
- **Docs are bilingual.** Keep English and 日本語 in sync (`README.md` /
  `README.ja.md`, `docs/decisions.md` / `docs/decisions.ja.md`).

## Commands

```sh
bun install            # installs only @types/bun
bun test               # run the suite
bun test --coverage    # coverage (threshold 0.9 in bunfig.toml; core is 100%)
bunx tsc --noEmit      # typecheck
bun build ./examples/<name>/main.tsx --target browser --outfile /tmp/out.js
```

Run all of these (and the example builds) before considering work done.

## Layout

- `packages/core/src/` — `reactive.ts` (signals, owner tree, lifecycle),
  `dom.ts` (render + keyed reconcile), `control-flow.ts` (`<Show>`/`<For>`),
  `props.ts` (`mergeProps`/`splitProps`), `jsx-runtime.ts` / `jsx-dev-runtime.ts`.
- `examples/` — runnable `counter` and `todomvc` (TSX). Not shipped; excluded
  from coverage. `app.tsx` holds the component; `main.tsx` mounts it.
- `docs/` — design decisions (EN + JA).

## Git

Develop on `claude/bun-svelte-framework-mpn6g0`. Commit with clear messages and
push when work is complete. Do not open a PR unless asked.
