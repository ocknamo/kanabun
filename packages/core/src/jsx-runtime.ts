/**
 * kanabun — JSX automatic runtime
 * ------------------------------------------------------------------
 * This is the entry point the TypeScript/Bun JSX transform calls when
 * `jsxImportSource` is "@kanabun/core". It builds real DOM eagerly (via the
 * DOM runtime) — there is no virtual DOM and no custom compiler.
 *
 * The `JSX` namespace below is what gives TSX its type-checking and editor
 * support for free: TypeScript resolves element/attribute/child types from
 * here, so we never write an LSP.
 */
import { createElement } from "./dom";
import type { Props } from "./dom";

/** Anything that may appear in a JSX child position. */
export type JSXChild =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | JSXChild[]
  | (() => JSXChild);

// A component accepts its own props shape; the factory must accept any of them,
// so `type` is intentionally loose here (the JSX transform enforces real prop
// types at the call site via the JSX namespace below).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Component = (props: any) => unknown;

export function jsx(
  type: string | Component,
  props: Props,
  _key?: unknown,
): unknown {
  if (typeof type === "function") return type(props ?? {});
  return createElement(type, props ?? null);
}

// `jsxs` is used when the children are a static array; same behaviour here.
export const jsxs = jsx;

/** `<>...</>` — returns its children for the DOM runtime to flatten. */
export function Fragment(props: { children?: unknown }): unknown {
  return props.children;
}

// ── JSX type surface ─────────────────────────────────────────────
// Intentionally permissive for now (attributes are loosely typed); tightening
// element/attribute types is a later DX phase. The structural pieces below are
// what TypeScript needs to type-check TSX against this runtime.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  /** What an evaluated JSX expression produces. */
  export type Element = JSXChild;

  /** Valid component/tag types in a `<Foo />` position. */
  export type ElementType = string | ((props: never) => Element);

  /** Tells TS which prop carries children. */
  export interface ElementChildrenAttribute {
    children: Record<string, never>;
  }

  /** Implicit attributes available on every element (e.g. `key`). */
  export interface IntrinsicAttributes {
    key?: string | number;
  }

  /** Intrinsic (lowercase) elements. Permissive until the DX phase. */
  export interface IntrinsicElements {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [name: string]: any;
  }
}
