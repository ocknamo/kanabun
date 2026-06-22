/**
 * kanabun — islands (explicit partial hydration)
 * ------------------------------------------------------------------
 * Partial hydration the no-compiler way: a page is mostly static
 * server-rendered HTML, and only the components marked as *islands* ship and run
 * on the client. Each island is its own independent mount point; the static
 * shell around it has no client behaviour.
 *
 * With no compiler there is nothing to *detect* which components are
 * interactive, so the author marks them explicitly (closer to Astro's
 * `client:*` directives than to a framework that infers islands). The
 * recommended, type-safe way is {@link defineIslands} — declare the map once and
 * the returned `<Island name>` checks the name (and props) at compile time:
 *
 *     // islands.ts — shared by the server render and the client entry.
 *     export const { Island, hydrateIslands } = defineIslands({ Counter });
 *
 *     // in the page: `name` is "Counter"; a typo is a compile error.
 *     <Island name="Counter" props={{ start: 0 }} />
 *
 * The lower-level {@link registerIsland} + global {@link Island} pair takes a
 * plain string name (resolved at runtime — handy for dynamic registration):
 *
 *     registerIsland("Counter", Counter);
 *     <Island name="Counter" props={{ start: 0 }} />
 *
 * On the **server**, `<Island>` looks the component up in the registry and
 * renders it inside a wrapper that carries the island's name and props:
 *
 *     <div data-island="Counter" data-props='{"start":0}'>…rendered…</div>
 *
 * so first paint / SEO are unchanged. On the **client**, {@link hydrateIslands}
 * queries every `[data-island]`, deserializes its props, looks the component up
 * in the same registry, and {@link hydrate}s only those — nothing else executes.
 * It reuses the two existing primitives (`renderToString` on the server,
 * `hydrate` per container on the client); islands are a *composition* of them,
 * not a third render path.
 *
 * Constraints, by necessity (documented loudly, not bugs):
 *   - **Props cross the boundary as data.** They are serialized to an HTML
 *     attribute and `JSON.parse`d on the client, so they must be
 *     JSON-serializable — no closures, signals, or DOM refs.
 *   - **Each island is its own root.** The owner tree was torn down at the
 *     serialization boundary, so an island cannot `useContext` a value a
 *     server-side ancestor provided. Share state the ordinary JS way: a
 *     module-level singleton signal/store the islands import (module scope is
 *     shared on the client even though the owner trees are not).
 *   - **Islands are flat.** A registered island component should not itself
 *     render an `<Island>`; `hydrateIslands` mounts each `[data-island]`
 *     independently.
 *
 * The *payload* win — shipping only the JS for the islands a page contains —
 * lives in the CLI (per-island bundle splitting), since that is bundler work;
 * this core layer makes hydration partial in **execution** and stays
 * runtime-independent. See `docs/decisions.md` → "Islands / partial hydration".
 */
import { doc, hydrate } from "./dom";
import { warn } from "./dev";
import { jsx } from "./jsx-runtime";
import type { Component, JSXChild } from "./jsx-runtime";
import type { Disposer } from "./reactive";

/** A component eligible to be an island. Its props must be JSON-serializable. */
export type IslandComponent = Component;

/** An island's props — JSON-serializable values only (they cross the wire). */
export type IslandProps = Record<string, unknown>;

/** A name → component map, the explicit alternative to the module registry. */
export type IslandRegistry = Record<string, IslandComponent>;

// The default, module-level registry. Module scope is shared across a bundle, so
// registering once is visible to both `<Island>` (server) and `hydrateIslands`
// (client) when the registration module is imported by each entry.
const registry = new Map<string, IslandComponent>();

/**
 * Register `component` under `name` so `<Island name>` (server) and
 * {@link hydrateIslands} (client) can resolve it. Import the registration module
 * from **both** the server render and the client entry so the name resolves on
 * each side.
 */
export function registerIsland(name: string, component: IslandComponent): void {
  registry.set(name, component);
}

// `<Island>` (server) always resolves against the module registry — only
// `hydrateIslands` (client) can be handed an `explicit` map — so the lookup is
// shared with `explicit` left `undefined` on the server path.
function lookup(name: string, explicit: IslandRegistry | undefined): IslandComponent {
  const component = explicit ? explicit[name] : registry.get(name);
  if (!component) {
    throw new Error(
      `kanabun: no island registered as "${name}" — call ` +
        `registerIsland("${name}", Component) before rendering (the registration ` +
        "module must be imported on the server and the client).",
    );
  }
  return component;
}

export interface IslandBoundaryProps {
  /** The registered island name (the server marks it; the client resolves it). */
  name: string;
  /**
   * JSON-serializable props passed to the island on both server and client.
   * They are serialized into a DOM attribute and re-parsed on the client, so
   * treat them as **server-authored data**: they round-trip through markup the
   * client can read, so don't put secrets or authorization decisions in them.
   */
  props?: IslandProps;
}

// Build the `<div data-island data-props>` wrapper around the resolved island.
// Shared by the string-keyed `Island` and the typed `defineIslands` boundary, so
// the two emit an identical serialized shape (no drift if the format changes).
function renderBoundary(
  name: string,
  props: IslandProps,
  explicit: IslandRegistry | undefined,
): JSXChild {
  const Component = lookup(name, explicit);
  return jsx("div", {
    "data-island": name,
    "data-props": JSON.stringify(props),
    children: jsx(Component, props),
  }) as JSXChild;
}

/**
 * A hydration boundary. Renders the registered component inside a
 * `<div data-island data-props>` wrapper so the server markup is interactive
 * once {@link hydrateIslands} runs on the client. Use it in a page rendered with
 * `renderToString` (server) — the same markup hydrates on the client.
 */
export function Island(boundary: IslandBoundaryProps): JSXChild {
  return renderBoundary(boundary.name, boundary.props ?? {}, undefined);
}

export interface HydrateIslandsOptions {
  /**
   * Limit hydration to islands inside this root (default: the whole
   * `document`). Useful for tests, or to hydrate a fragment.
   */
  root?: ParentNode;
  /**
   * An explicit name → component registry (default: the module registry built
   * by {@link registerIsland}).
   */
  registry?: IslandRegistry;
}

/**
 * Hydrate every island in the page (or under `options.root`). For each
 * `[data-island]` element it reads the name + JSON props, resolves the component
 * from the registry, and {@link hydrate}s it into that element — making only the
 * islands interactive while the static shell ships and runs no JS.
 *
 * Returns a disposer that tears down every island it mounted.
 */
export function hydrateIslands(options: HydrateIslandsOptions = {}): Disposer {
  const disposers: Disposer[] = [];
  for (const { el, name, props } of collectIslands(options.root)) {
    const Component = lookup(name, options.registry);
    disposers.push(hydrate(() => jsx(Component, props), el));
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** A `[data-island]` element with its resolved name and parsed props. */
interface IslandMatch {
  el: Element;
  name: string;
  props: IslandProps;
}

/**
 * Find the islands to hydrate under `root` (default: the whole document), with
 * their name + parsed props. Nested islands are dropped (with a dev warning):
 * hydrating an outer island re-renders its subtree and detaches a nested one, so
 * the snapshot is taken against the original tree *before* any mount mutates it.
 * Shared by {@link hydrateIslands} and {@link hydrateIslandsLazy}.
 */
function collectIslands(root: ParentNode | undefined): IslandMatch[] {
  const scope = (root ?? doc()) as unknown as {
    querySelectorAll(selector: string): Iterable<Element>;
  };
  const all = [...scope.querySelectorAll("[data-island]")];
  const nested = new Set(all.filter(hasIslandAncestor));
  const matches: IslandMatch[] = [];
  for (const el of all) {
    // Islands are flat: each `[data-island]` mounts independently. Skip nested
    // ones rather than mount onto a soon-to-be-detached node, and nudge in dev —
    // the constraint can't be expressed structurally without a compiler.
    if (nested.has(el)) {
      warn(
        `a nested <Island> ("${el.getAttribute("data-island")}") is skipped — ` +
          "islands must be flat (an island component must not render another <Island>).",
      );
      continue;
    }
    const raw = el.getAttribute("data-props");
    matches.push({
      el,
      name: el.getAttribute("data-island")!,
      props: (raw ? JSON.parse(raw) : {}) as IslandProps,
    });
  }
  return matches;
}

/** Whether `el` sits inside another `[data-island]` (i.e. it's a nested island). */
function hasIslandAncestor(el: Element): boolean {
  for (let p = el.parentNode as Element | null; p; p = p.parentNode as Element | null) {
    if (typeof p.getAttribute === "function" && p.getAttribute("data-island") !== null) {
      return true;
    }
  }
  return false;
}

// ── Typed registry (compile-time name + props checking) ──────────────
/**
 * A name → component map declared up front for {@link defineIslands}, so its keys
 * are known to the type system. Structurally identical to {@link IslandRegistry}
 * (the dynamic, runtime-resolved map); the distinct name marks the
 * static-declaration role at the `defineIslands` call site.
 */
export type IslandsMap = IslandRegistry;

/** The typed `<Island>` + `hydrateIslands` returned by {@link defineIslands}. */
export interface DefinedIslands<M extends IslandsMap> {
  /**
   * Like the global {@link Island}, but `name` is constrained to the keys of the
   * declared map and `props` to the matching component's props — so a typo or an
   * unregistered name is a **compile error**, not a runtime throw.
   */
  Island: <K extends keyof M & string>(boundary: {
    name: K;
    props?: Parameters<M[K]>[0];
  }) => JSXChild;
  /** Like the global {@link hydrateIslands}, but bound to this map (no `registry`). */
  hydrateIslands: (options?: Omit<HydrateIslandsOptions, "registry">) => Disposer;
}

/**
 * Declare the islands as a typed map and get back an `<Island>` / `hydrateIslands`
 * pair bound to it. Because the keys are known statically, `<Island name>` is
 * checked at compile time (an unregistered name won't type-check) and `props` is
 * typed per component — closing the gap the string-keyed {@link registerIsland}
 * API leaves open. Export the pair from a module both the server and client
 * import:
 *
 *     // islands.ts (shared)
 *     export const { Island, hydrateIslands } = defineIslands({ Counter, Clock });
 *
 *     // a page (server): name + props are type-checked
 *     <Island name="Counter" props={{ start: 0 }} />
 *     <Island name="Typo" />            // ✗ compile error
 *
 *     // client entry
 *     hydrateIslands();
 */
export function defineIslands<const M extends IslandsMap>(islands: M): DefinedIslands<M> {
  const TypedIsland = <K extends keyof M & string>(boundary: {
    name: K;
    props?: Parameters<M[K]>[0];
  }): JSXChild =>
    renderBoundary(boundary.name, (boundary.props ?? {}) as IslandProps, islands);
  return {
    Island: TypedIsland,
    hydrateIslands: (options: Omit<HydrateIslandsOptions, "registry"> = {}): Disposer =>
      hydrateIslands({ ...options, registry: islands }),
  };
}

// ── Lazy hydration (per-island code splitting) ───────────────────────
/**
 * Loads an island's component on demand — its module is fetched only when the
 * island is present on the page. Resolves either the component directly or a
 * module that default-exports it (so `() => import("./Counter")` works).
 */
export type IslandLoader = () => Promise<IslandComponent | { default: IslandComponent }>;

/** A name → loader map — the lazy counterpart of {@link IslandRegistry}. */
export type IslandLoaders = Record<string, IslandLoader>;

/**
 * Hydrate islands by **loading each present island's chunk on demand** — the
 * runtime half of per-island code splitting (the CLI's `buildIslands` generates
 * a bootstrap that calls this). It scans `[data-island]`, and for each one calls
 * only that island's `loaders[name]()`, so a page downloads just the chunks for
 * the islands it actually contains; an island registered but absent is never
 * fetched.
 *
 * Unlike {@link hydrateIslands} (which throws on an unknown name, resolving a
 * static registry up front), a missing loader here is **skipped with a dev
 * warning** rather than thrown: this is the production client entry, and one
 * mis-wired island shouldn't blank the rest of the page.
 *
 * Returns a disposer that tears down every island it mounted; mounts still
 * in-flight when it runs are cancelled (they won't mount afterwards).
 */
export function hydrateIslandsLazy(
  loaders: IslandLoaders,
  options: Omit<HydrateIslandsOptions, "registry"> = {},
): Disposer {
  const disposers: Disposer[] = [];
  let disposed = false;
  for (const { el, name, props } of collectIslands(options.root)) {
    const loader = loaders[name];
    if (!loader) {
      warn(
        `no loader for island "${name}" — it won't hydrate (was it included in ` +
          "the islands build?).",
      );
      continue;
    }
    void loader().then((mod) => {
      // The disposer may have run while the chunk was loading; don't mount then.
      if (disposed) return;
      const Component =
        typeof mod === "object" && mod !== null && "default" in mod ? mod.default : mod;
      disposers.push(hydrate(() => jsx(Component, props), el));
    });
  }
  return () => {
    disposed = true;
    for (const dispose of disposers) dispose();
  };
}
