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
 * `client:*` directives than to a framework that infers islands):
 *
 *     // shared by the server render and the client entry — register once.
 *     import { registerIsland } from "@kanabun/core";
 *     import { Counter } from "./Counter";
 *     registerIsland("Counter", Counter);
 *
 *     // in the page: marks a hydration boundary.
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
  /** JSON-serializable props passed to the island on both server and client. */
  props?: IslandProps;
}

/**
 * A hydration boundary. Renders the registered component inside a
 * `<div data-island data-props>` wrapper so the server markup is interactive
 * once {@link hydrateIslands} runs on the client. Use it in a page rendered with
 * `renderToString` (server) — the same markup hydrates on the client.
 */
export function Island(boundary: IslandBoundaryProps): JSXChild {
  const props = boundary.props ?? {};
  const Component = lookup(boundary.name, undefined);
  return jsx("div", {
    "data-island": boundary.name,
    "data-props": JSON.stringify(props),
    children: jsx(Component, props),
  }) as JSXChild;
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
  const root = (options.root ?? doc()) as unknown as {
    querySelectorAll(selector: string): Iterable<Element>;
  };
  const disposers: Disposer[] = [];
  for (const el of root.querySelectorAll("[data-island]")) {
    const name = el.getAttribute("data-island")!;
    const Component = lookup(name, options.registry);
    const raw = el.getAttribute("data-props");
    const props = (raw ? JSON.parse(raw) : {}) as IslandProps;
    disposers.push(hydrate(() => jsx(Component, props), el));
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}
