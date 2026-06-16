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
| **Types** | edit / `tsc` | `on*` handler shape (wrong/forgotten function) | none (compile-time) |
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

**Limits.** This only helps if you run `tsc` / use an editor, and an `any`-typed
value defeats it. Per-element *attribute* types are still permissive
(`[attr]: any`) — tightening them is a later DX phase (see
[`roadmap.md`](./roadmap.md)). And crucially it **cannot** be extended to the
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

## 4. Future: a dedicated linter

The `{count()}` slip is exactly the kind of thing **static analysis** can catch
that runtime checks can't — it needs to see the *source* (`count` is a signal,
and it's being called in a reactive position) before the call collapses to a
value. A future **ESLint plugin / kanabun lint** could flag it (and related
convention violations: a thunk that reads no signals, an `on*` thunk, etc.)
without violating the no-compiler runtime constraint — a linter is **opt-in
authoring tooling**, not a runtime compiler the framework depends on. This keeps
the runtime small while still offering compiler-grade guardrails to those who
want them. Tracked under *Tooling & publishing* in
[`roadmap.md`](./roadmap.md).
