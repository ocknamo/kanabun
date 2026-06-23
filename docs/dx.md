# Developer support: catching mistakes

*English | [日本語](./dx.ja.md)*

kanabun has **no compiler**. The reactivity convention — *a function is reactive,
a called value is read once, `on*` is an event* — is enforced by discipline, not
a build step. That's the founding trade-off (see
[`decisions.md`](./decisions.md#2-explicit-getters-solid-style--and-therefore-no-compiler)),
and it means a class of slips can't be caught the way a compiler-based framework
would. This page collects what *does* catch them, in three layers:

| Layer | When | Catches | Cost |
| --- | --- | --- | --- |
| **Types** | edit / `tsc` | `on*` handler shape (wrong/forgotten function), mistyped element attributes | none (compile-time) |
| **Dev warnings** | runtime, opt-in | owner-less effects/lifecycle, impure computeds | ~0 when off |
| **Tests / `snapshot`** | CI | "it doesn't update" symptoms | the test you write |

## 1. Type-level checks (compile time)

`on*` props are **always** event listeners (the DOM runtime special-cases them —
they're never reactive thunks), so they're typed as functions in
`JSX.IntrinsicElements`. That makes the classic "forgot the `() =>`" slip a
compile error — the earliest, cheapest place to catch it, with no runtime cost
and no false positives:

```tsx
<button onClick={count.set(count() + 1)}>   // ✗ type error: this runs once at
                                             //   render and yields `void`, not a
                                             //   handler — clicking does nothing
<button onClick={count() }>                  // ✗ type error: `number` isn't a fn
<button onClick={() => count.set(count() + 1)}>  // ✓
<button onClick={enabled ? handler : undefined}>  // ✓ conditional handler is fine
```

The precision comes from the type system distinguishing `void` from `undefined`:
a setter call (`count.set(…)`) has type `void`, which is **not** assignable to a
handler — even an optional one — so it's rejected, while a genuine `undefined`
(a conditional handler) is allowed. A runtime check can't tell those apart; the
types can. The event is typed too, so a handler reading `e.key` must sit on a
keyboard event (`EventHandler<KeyboardEvent>`), enforced by `strictFunctionTypes`.

**Per-element attributes are typed too.** `JSX.IntrinsicElements` maps common
elements to their own attribute shapes (`<a href>`, `<input checked>`,
`<button disabled>`, …), and every attribute is typed `Attr<T>` — its value
**or** a reactive accessor of it (`class="x"` and `class={() => …}` both pass,
`class={5}` doesn't), honouring the "a function is reactive" convention. So a
mistyped attribute (`disabled="yes"`, `tabIndex="3"`, a `<button type="email">`)
is a compile error, with editor autocomplete per element. Unlisted elements and
unknown attributes (`data-*` / `aria-*`) stay permissive via an `[attr]: any`
escape hatch — the same precedence the `on*` handlers rely on, so typed names are
enforced while the rest stays loose.

**Limits.** This only helps if you run `tsc` / use an editor, and an `any`-typed
value defeats it (including any attribute still covered only by the `[attr]: any`
fallback). And crucially it **cannot** be extended to the
`{count()}`-in-a-child/attribute slip: there, both `{count}` (reactive) and
`{count()}` (static) are legitimate APIs, so the type must accept both. `on*` is
special precisely because only one shape (a function) is ever valid.

## 2. Runtime dev warnings (opt-in)

For the mistakes the types can't see, `setDev(true)` enables a small set of
**runtime diagnostics** (see
[`decisions.md`](./decisions.md#dev-time-warnings-phase-6)). They're **off by
default** — production and tests stay silent and there's no hot-path cost when
off — and `kanabun dev` turns them on automatically (it injects
`globalThis.__KANABUN_DEV__`). Warnings are deduplicated and routed through a
settable sink (`setWarnHandler`).

```ts
import { setDev } from "@kanabun/core";
setDev(true); // or rely on `kanabun dev`
```

What they flag (each detected from state the reactive core already tracks, with
low false-positive risk):

- **`effect()` created outside any owner** — it won't be auto-disposed (a likely
  leak). Create it inside `render`/`createRoot`, or keep and call the disposer.
- **`onCleanup()` outside an owner** — the callback would silently never run.
- **`onMount()` outside an owner** — it runs, but isn't tied to a lifecycle.
- **Writing a signal while a computed is evaluating** — a side effect inside
  something meant to be pure (move it to an effect or an event handler).

## 3. What still isn't caught — and how to cope

The headline slip — writing `{count()}` where you meant `{count}` in a **child or
attribute** — is invisible to both layers above. By the time the runtime sees the
value, `count()` has collapsed to a plain value indistinguishable from a literal,
and (as above) the type can't forbid it because the static form is valid. The
symptom is simply **"the UI doesn't update."**

Backstops:

- **Tests** that assert a value *changes* after an interaction turn the slip into
  a failing test (e.g. click, then expect the new text).
- The **`snapshot` skill** captures before/after screenshots, surfacing a UI that
  silently stopped reacting.

## 4. Future: an in-house linter

The `{count()}` slip is exactly the kind of thing **static analysis** can catch
that runtime checks can't — it needs to see the *source* (`count` is a signal,
and it's being called in a reactive position) before the call collapses to a
value. The plan is a **first-party `kanabun lint`**, *not* an ESLint plugin:
ESLint (and its plugin ecosystem) is an external dependency, and kanabun ships
**zero dependencies** — adopting it would break the founding constraint. Instead
the linter lives in the CLI / Bun layer and reuses the **TypeScript parser** the
project already leans on for typechecking (the pinned `typescript` dev dep), so
it adds no runtime dependency — it's opt-in, dev-only authoring tooling, not a
runtime compiler the framework depends on.

It would flag the reactive-position call (`{count()}` → suggest `{count}` /
`{() => …}`) and related convention violations (a thunk that reads no signals, an
`on*` thunk, …). This keeps the runtime small while still offering compiler-grade
guardrails to those who want them. Tracked under *Tooling & publishing* in
[`roadmap.md`](./roadmap.md).

### Design sketch (not yet implemented)

Recorded so the next session can pick it up; nothing here ships yet.

- **Shape.** A `kanabun lint [globs]` subcommand in the CLI/Bun layer
  (`packages/cli/src/lint.ts`), reporting `file:line:col  message` and exiting
  non-zero on findings (a CI gate). Mirrors the diagnostics style of
  `packages/cli/src/errors.ts`.
- **Parser.** The TypeScript compiler API, via a plain `import("typescript")`
  that resolves to the project's pinned `typescript` dev dependency — no
  auto-install gamble, and consistent with "TS is a pinned dev dep" (it still
  adds nothing to the runtime). If running outside an install (e.g. a global
  CLI), fall back to spawning TS as a child process.
- **Flagship rule — `reactive-call-in-jsx`.** Walk each JSX child / non-`on*`
  attribute; flag a zero-arg call (`count()`, `obj.sig()`) sitting *directly* in
  that reactive position (not wrapped in an arrow). Two precision levels:
  - *Semantic* (preferred): resolve the callee's type via the checker and flag
    only `Accessor`/`Signal` calls → near-zero false positives. Needs
    `ts.createProgram` + a `TypeChecker`.
  - *Syntactic*: AST only, heuristic on the call shape → lighter, but
    false-positives on intentionally-static function calls.
- **Later rules.** `static-thunk` (a `() => …` child/attribute that reads no
  signal — needlessly lazy) and `on-handler-not-a-function` (largely subsumed by
  the typed `on*` props in §1, kept for plain-JS users).
- **Tests.** Fixture sources as strings → parse → assert findings, held to the
  repo's 100% line/function coverage bar; no new runtime dependency.
