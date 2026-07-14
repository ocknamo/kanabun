# CLAUDE.md

Guidance for Claude when working in this repository.

kanabun is a Svelte-flavoured frontend framework built on **Bun + TypeScript**
with **zero runtime dependencies**. Signals + runtime JSX (no virtual DOM, no
compiler). See `docs/decisions.md` (and `.ja.md`) for the design rationale.

## ⚠️ Required workflow: review before reporting done

**Before reporting any implementation/fix task as complete, you MUST run the
`skeptical-reviewer` subagent** and act on its findings: fix every 🔴 before
reporting, address or justify every 🟡. Run it per meaningful step / phase, not
only at the very end.

**After the task and `skeptical-reviewer` are both complete, run the
`pr-finalizer` subagent.**

## ⚠️ Visual changes: use the `snapshot` skill

**When a task touches the rendered look — CSS / styling, layout, or any visual
change — use the `snapshot` skill** to confirm the result. Tests and `bun build`
stay green even when styles don't actually apply, so don't trust them alone.

## Conventions (the reviewer enforces these — so should you)

- **Zero dependencies.** No runtime deps, ever. The only permitted dev
  dependencies are `@types/bun` (type-only) and `typescript` (the project's
  sanctioned tool) — both pinned to exact versions for reproducible typechecks.
  Do **not** add any other packages.
- **Pinned toolchain.** Bun is pinned in `.bun-version` (single source of truth;
  CI's setup-bun reads it via `bun-version-file`). TypeScript is a pinned dev
  dependency — `bunx tsc`
  resolves the local binary, so typechecks no longer float to the latest TS.
- **`packages/core/` stays runtime-independent.** Standard JS / Web APIs only
  (the DOM is fine). No `Bun.*`, `process`, `node:*`, `fs`, etc. Runtime-specific
  code belongs in a future thin CLI/dev layer.
- **Signals use explicit getters.** Read `count()`, write `count.set(v)` /
  `count.update(fn)`. No compiler magic.
- **Reactivity convention:** a child/attribute that is a *function* is reactive
  (`{count}`, `{() => …}`); `{count()}` is read once; `on*` props are events.
- **Tests are named `*.spec.ts`** and live next to the source they cover (e.g.
  `dom.spec.ts` sits beside `dom.ts` in `packages/core/src/`). Aim to keep source
  files at 100% coverage. The renderer is tested against the in-repo DOM mock,
  which ships as `@kanabun/testing` (`packages/testing/src/dom-mock.ts`; specs
  import the mock and helpers from `@kanabun/testing`) — never add
  jsdom/happy-dom.
- **Docs are bilingual.** Keep English and 日本語 in sync (`README.md` /
  `README.ja.md`, `docs/decisions.md` / `docs/decisions.ja.md`).

## Commands

```sh
bun test               # run the suite
bun test --coverage    # coverage (threshold in bunfig.toml; core is 100%)
bunx tsc --noEmit      # typecheck
bun build ./examples/<name>/main.tsx --target browser --outfile /tmp/out.js
```

Run all of these (and the example builds) before considering work done.

## Layout

- `packages/core/` — the runtime. Runtime-independent: no Bun/Node APIs.
- `packages/cli/` — the `kanabun` command. The **only** Bun-dependent layer;
  `Bun.*`, `node:*`, `process` live here, never in core.
- `packages/testing/` — `@kanabun/testing`: the DOM mock + test helpers
  (`renderTest`, queries, `fireEvent`, `tick`). Runtime-independent (no
  `bun:test` import) and covered like product code.
- `examples/` — runnable examples (TSX), excluded from coverage. `main.tsx`
  mounts; larger examples split the component into `app.tsx`.
- `docs/` — design decisions, roadmap, and handoff (EN + JA). Check `roadmap.md`
  for what's left and `docs/handoff.md` before starting.
- `plugins/kanabun/` — the Claude Code plugin distributed from this repo
  (marketplace manifest: `.claude-plugin/marketplace.json`). User-facing skills
  like `spa-quickstart` live here, not in `.claude/skills/` (which is for
  skills used *within* this repo). Validate with `claude plugin validate`.

## Git

Commit with clear messages and push when work is complete. Do not open a PR
unless asked.
