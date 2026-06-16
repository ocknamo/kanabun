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

// ── Event handlers ───────────────────────────────────────────────
/**
 * A DOM event listener for an `on*` prop. Typed by the event it receives, so a
 * handler that reads `e.key` (KeyboardEvent) or `e.clientX` (MouseEvent) is
 * checked. A no-arg handler (`() => …`) is always assignable — it just ignores
 * the event.
 *
 * Because `on*` props are **always** functions (never reactive thunks — the DOM
 * runtime special-cases them), typing them as functions has no downside and
 * catches the classic "forgot the `() =>`" slip at compile time:
 *
 *     <button onClick={count.set(count() + 1)}>   // ✗ runs once at render;
 *                                                  //   value is `void`, not a fn
 *     <button onClick={() => count.set(count() + 1)}>  // ✓
 */
export type EventHandler<E extends Event = Event> = (event: E) => void;

/**
 * The attributes every intrinsic element accepts. Event handlers are typed
 * (see {@link EventHandler}); all other attributes stay intentionally
 * permissive (`[attr]: any`) until the per-element DX phase — an explicitly
 * named prop takes precedence over the index signature, so the typed `on*`
 * handlers are enforced while unknown attributes are still allowed.
 */
export interface HTMLAttributes {
  // Mouse / pointer.
  onClick?: EventHandler<MouseEvent>;
  onDblClick?: EventHandler<MouseEvent>;
  onMouseDown?: EventHandler<MouseEvent>;
  onMouseUp?: EventHandler<MouseEvent>;
  onMouseEnter?: EventHandler<MouseEvent>;
  onMouseLeave?: EventHandler<MouseEvent>;
  onMouseMove?: EventHandler<MouseEvent>;
  onMouseOver?: EventHandler<MouseEvent>;
  onMouseOut?: EventHandler<MouseEvent>;
  onContextMenu?: EventHandler<MouseEvent>;
  onWheel?: EventHandler<WheelEvent>;
  onPointerDown?: EventHandler<PointerEvent>;
  onPointerUp?: EventHandler<PointerEvent>;
  onPointerMove?: EventHandler<PointerEvent>;
  onPointerEnter?: EventHandler<PointerEvent>;
  onPointerLeave?: EventHandler<PointerEvent>;
  // Keyboard.
  onKeyDown?: EventHandler<KeyboardEvent>;
  onKeyUp?: EventHandler<KeyboardEvent>;
  onKeyPress?: EventHandler<KeyboardEvent>;
  // Form / input.
  onInput?: EventHandler<Event>;
  onChange?: EventHandler<Event>;
  onSubmit?: EventHandler<Event>;
  onReset?: EventHandler<Event>;
  // Focus.
  onFocus?: EventHandler<FocusEvent>;
  onBlur?: EventHandler<FocusEvent>;
  onFocusIn?: EventHandler<FocusEvent>;
  onFocusOut?: EventHandler<FocusEvent>;
  // Clipboard.
  onCopy?: EventHandler<ClipboardEvent>;
  onCut?: EventHandler<ClipboardEvent>;
  onPaste?: EventHandler<ClipboardEvent>;
  // Misc.
  onScroll?: EventHandler<Event>;
  // Everything else (attributes, `ref`, uncommon handlers) stays loose for now.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [attr: string]: any;
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

  /** Intrinsic (lowercase) elements. Event handlers typed; attributes loose. */
  export interface IntrinsicElements {
    [name: string]: HTMLAttributes;
  }
}
