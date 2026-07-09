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

Under `kanabun dev` these don't just hit the console: a **dev overlay** collects
them (plus uncaught errors and unhandled promise rejections) into an on-screen
panel, so a warning isn't lost in a noisy console. It's a CLI-layer consumer of
the same sink — see [`decisions.md`](./decisions.md#dev-overlay-phase-7).

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

## 4. An in-house linter (`kanabun lint`)

The `{count()}` slip is exactly the kind of thing **static analysis** can catch
that runtime checks can't — it needs to see the *source* (`count` is a signal,
and it's being called in a reactive position) before the call collapses to a
value. So kanabun ships a **first-party `kanabun lint`**, *not* an ESLint plugin:
ESLint (and its plugin ecosystem) is an external dependency, and kanabun ships
**zero dependencies** — adopting it would break the founding constraint. Instead
the linter lives in the CLI / Bun layer (`packages/cli/src/lint.ts`) and reuses
the **TypeScript parser** the project already leans on for typechecking (the
pinned `typescript` dev dep, loaded with a plain `import("typescript")`), so it
adds no runtime dependency — it's opt-in, dev-only authoring tooling, not a
runtime compiler the framework depends on.

```sh
kanabun lint                 # lint **/*.tsx under the current directory
kanabun lint "src/**/*.tsx"  # explicit globs
```

It flags the reactive-position call (`{count()}` → suggests `{count}` /
`{() => …}`), reporting `file:line:col  rule  message` and exiting non-zero on
findings (a CI gate). Like `build`/`generate` it never throws — an internal
failure comes back as a logged error, not a crash.

### Implementation

- **Shape.** A `kanabun lint [globs]` subcommand
  (`packages/cli/src/lint.ts`); `lint()` enumerates files (`Bun.Glob`, skipping
  `node_modules`) and `lintSource(source, file)` analyzes one TSX string — the
  latter is exported so the rules unit-test from fixture strings with no
  filesystem. Diagnostics style mirrors `packages/cli/src/errors.ts`.
- **Parser (⚠️ paused on TypeScript 7).** The rule originally parsed each file
  **in-process** with the TypeScript compiler API via a plain
  `import("typescript")` that resolves to the project's pinned `typescript` dev
  dependency (`ts.createSourceFile(…, ScriptKind.TSX)`) — no auto-install
  gamble, consistent with "TS is a pinned dev dep", and adding nothing to the
  runtime. **TypeScript 7 (the native port) removed that in-process API:** the
  parser now lives in the native binary, reachable only through a spawned server
  API (`typescript/unstable/sync`), with AST types/guards split under
  `typescript/unstable/ast` — there is no in-process `createSourceFile` any more.
  So as of the TS 7 toolchain bump the linter is **paused**: `lint()` reports an
  internal failure (never a false clean pass) and `lintSource()` throws the
  explanation, while the public surface (`lint` / `lintSource` /
  `formatFindings` and the result types) is preserved so the port stays a
  drop-in. See "TS 7 outlook" below for the migration.
- **Flagship rule — `reactive-call-in-jsx`.** Walk each JSX child / non-`on*`
  attribute and scan that reactive-position expression for a zero-arg call
  (`count()`, `store.sig()`) whose callee is an accessor-like identifier or
  member access — skipping any subtree under a nested arrow/function (already a
  deferred thunk, so its calls stay reactive). `on*` props are events (mirroring
  `dom.ts`), never scanned. This catches `{count()}`, `{count() + 1}`,
  `class={theme()}`, and an accessor read nested in an object/`style` value.
  - This is the **syntactic** level: AST only, no `TypeChecker`. It can't tell an
    accessor call from an intentional static one-shot read or a plain zero-arg
    helper (`{getId()}`), so those are reported too — acceptable for opt-in
    tooling. (That also includes a bare `{item()}` read inside a `<For>` /
    `<Show>` render callback: with no compiler it still reads once, so the rule
    points you at the reactive `{item}`.) The **semantic** level (resolve the
    callee's type via
    `ts.createProgram` + a `TypeChecker`, flag only `Accessor`/`Signal` calls →
    near-zero false positives) is a documented follow-up.
- **Later rules.** `static-thunk` (a `() => …` child/attribute that reads no
  signal — needlessly lazy) and `on-handler-not-a-function` (largely subsumed by
  the typed `on*` props in §1, kept for plain-JS users).
- **Tests.** While paused, the specs pin the "unavailable on TS 7" contract
  (`lint()` fails with the explanation, `lintSource()` throws) and cover the
  parser-independent `formatFindings` from hand-built findings, holding the
  repo's coverage bar. The rule's fixture tests (source string → parse → assert
  findings) return with the native-API port; no new runtime dependency.
- **TS 7 (native) outlook — the migration.** TS 7 turned the earlier caveat into
  reality: the native port exposes **no in-process compiler API**. Parsing is
  only available through the server API (`typescript/unstable/sync`) — spawn an
  `API`, feed sources via a virtual filesystem (`typescript/unstable/fs`), then
  walk the returned `SourceFile` with the guards from `typescript/unstable/ast/is`
  and the node methods (`forEachChild`, `getStart`, `getLineAndCharacterOfPosition`
  are still methods). So the port is: (1) obtain the `SourceFile` from the server
  API instead of `ts.createSourceFile`, and (2) swap the `ts.isX(...)` guard calls
  for the free functions from `typescript/unstable/ast/is`. The walk itself is
  unchanged. The cost is that `lint` gains a **subprocess** (the native server) —
  a departure from pure in-process JS parsing — so it should land once the native
  API has stabilised and been verified under Bun. **Semantic mode** (resolve the
  callee's type via a `Checker` from the same server API, flag only
  `Accessor`/`Signal` calls → near-zero false positives) is the natural follow-on
  and is exactly the checker workload the Go-native compiler accelerates (~10×),
  scaling with the *consumer's* codebase, not this repo.
