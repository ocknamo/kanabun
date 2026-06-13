# kanabun

> A Svelte-flavoured frontend framework built on **Bun + TypeScript**, with
> **zero runtime dependencies**.

The pitch: the "change a variable and the UI just follows" feeling of Svelte,
but compiled down to plain browser JS so your users' app carries no framework
runtime baggage. The only things kanabun itself leans on are Bun (for the dev
experience) and TypeScript (for types) — nothing ships to the browser except
standard JS.

**Status:** early. Phase 1 (the reactive core) is implemented and tested.

---

## Why

Signals give you Svelte-like ergonomics without a virtual DOM or a diff
algorithm — you update only what changed. By leaning on **JSX** for templates
(a later phase), the heavy lifting of type-checking and editor support is
handed entirely to TypeScript, so there's no custom DSL, no LSP to build. That
keeps kanabun's own compiler small and its core dependency-free.

See [`docs/decisions.md`](docs/decisions.md) for the design rationale and the
trade-offs that were considered and rejected.

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
one), which keeps the core ~350 lines of standard JS and lets `tsc` and your
editor understand every line with zero custom tooling.

---

## Development

Requires [Bun](https://bun.com/).

```sh
bun install
bun test            # run the test suite
bun run typecheck   # tsc --noEmit across the workspace
```

### Layout

```
packages/
  core/        @kanabun/core — runtime-independent reactive core (this is done)
    src/
    test/
```

The `core` package never touches Bun- or Node-specific APIs; runtime-specific
code will live in a thin CLI/dev layer added in a later phase.

---

## License

MIT
