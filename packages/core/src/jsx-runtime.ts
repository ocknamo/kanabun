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

/** The typed `on*` event-handler props, shared by every intrinsic element. */
export interface DOMEventHandlers {
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
}

// ── Attribute value helpers ──────────────────────────────────────
/**
 * A reactive-or-static value. The DOM runtime reads a **function** as a reactive
 * binding (re-applied when its dependencies change) and any other value as
 * set-once — so a JSX attribute may be the value itself *or* an accessor of it
 * (`class="x"` and `class={() => …}` both type-check; `class={5}` does not).
 */
export type Reactive<T> = T | (() => T);

/** A typed attribute value: a {@link Reactive} value, or absent (`null`/`undefined`). */
export type Attr<T> = T | null | undefined | (() => T | null | undefined);

/** A single CSS value in a `style={{ … }}` object (reactive or static). */
export type StyleValue = Reactive<string | number | null | undefined>;
/** The object form of `style` — each property reactive on its own. */
export type StyleObject = Record<string, StyleValue>;

/** A `ref` target: a callback invoked with the element, or a box to fill. */
export type Ref = ((el: Element) => void) | { current: Element | null };

// ── Element attribute interfaces ─────────────────────────────────
/**
 * Attributes common to every HTML element: the typed `on*` handlers plus the
 * global attributes. A named, typed prop here is enforced (e.g. `tabIndex`
 * wants a number); the trailing `[attr]: any` index keeps `data-*`, `aria-*`,
 * and any not-yet-typed attribute permissive — TypeScript checks the declared
 * members against their types and only falls back to the index for the rest
 * (the same precedence the typed `on*` handlers have always relied on).
 */
export interface HTMLAttributes extends DOMEventHandlers {
  // Identity & presentation.
  id?: Attr<string>;
  class?: Attr<string>;
  className?: Attr<string>;
  style?: Attr<string> | StyleObject;
  title?: Attr<string>;
  // Common global attributes.
  hidden?: Attr<boolean>;
  inert?: Attr<boolean>;
  tabIndex?: Attr<number>;
  tabindex?: Attr<number>;
  dir?: Attr<"ltr" | "rtl" | "auto">;
  lang?: Attr<string>;
  role?: Attr<string>;
  slot?: Attr<string>;
  draggable?: Attr<boolean>;
  spellcheck?: Attr<boolean>;
  contentEditable?: Attr<boolean | "true" | "false" | "plaintext-only" | "inherit">;
  accessKey?: Attr<string>;
  autofocus?: Attr<boolean>;
  enterKeyHint?: Attr<string>;
  /** Populated with the created element (callback or `{ current }` box). */
  ref?: Ref;
  // `data-*`, `aria-*`, and anything not yet given a precise type stay loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [attr: string]: any;
}

export interface AnchorHTMLAttributes extends HTMLAttributes {
  href?: Attr<string>;
  target?: Attr<string>;
  rel?: Attr<string>;
  download?: Attr<string | boolean>;
  hrefLang?: Attr<string>;
  ping?: Attr<string>;
  referrerPolicy?: Attr<string>;
  type?: Attr<string>;
}

export interface ButtonHTMLAttributes extends HTMLAttributes {
  type?: Attr<"button" | "submit" | "reset">;
  disabled?: Attr<boolean>;
  name?: Attr<string>;
  value?: Attr<string | number>;
  form?: Attr<string>;
  formAction?: Attr<string>;
  formMethod?: Attr<string>;
}

export interface InputHTMLAttributes extends HTMLAttributes {
  type?: Attr<string>;
  value?: Attr<string | number>;
  checked?: Attr<boolean>;
  placeholder?: Attr<string>;
  disabled?: Attr<boolean>;
  readOnly?: Attr<boolean>;
  required?: Attr<boolean>;
  name?: Attr<string>;
  min?: Attr<string | number>;
  max?: Attr<string | number>;
  step?: Attr<string | number>;
  maxLength?: Attr<number>;
  minLength?: Attr<number>;
  pattern?: Attr<string>;
  multiple?: Attr<boolean>;
  accept?: Attr<string>;
  autoComplete?: Attr<string>;
  size?: Attr<number>;
}

export interface TextareaHTMLAttributes extends HTMLAttributes {
  value?: Attr<string | number>;
  placeholder?: Attr<string>;
  rows?: Attr<number>;
  cols?: Attr<number>;
  disabled?: Attr<boolean>;
  readOnly?: Attr<boolean>;
  required?: Attr<boolean>;
  name?: Attr<string>;
  maxLength?: Attr<number>;
  minLength?: Attr<number>;
  wrap?: Attr<string>;
}

export interface SelectHTMLAttributes extends HTMLAttributes {
  value?: Attr<string | number>;
  name?: Attr<string>;
  disabled?: Attr<boolean>;
  required?: Attr<boolean>;
  multiple?: Attr<boolean>;
  size?: Attr<number>;
}

export interface OptionHTMLAttributes extends HTMLAttributes {
  value?: Attr<string | number>;
  selected?: Attr<boolean>;
  disabled?: Attr<boolean>;
  label?: Attr<string>;
}

export interface FormHTMLAttributes extends HTMLAttributes {
  action?: Attr<string>;
  method?: Attr<string>;
  target?: Attr<string>;
  name?: Attr<string>;
  autoComplete?: Attr<string>;
  noValidate?: Attr<boolean>;
  encType?: Attr<string>;
}

export interface LabelHTMLAttributes extends HTMLAttributes {
  for?: Attr<string>;
  htmlFor?: Attr<string>;
}

export interface ImgHTMLAttributes extends HTMLAttributes {
  src?: Attr<string>;
  alt?: Attr<string>;
  width?: Attr<string | number>;
  height?: Attr<string | number>;
  loading?: Attr<"eager" | "lazy">;
  decoding?: Attr<"async" | "auto" | "sync">;
  srcSet?: Attr<string>;
  sizes?: Attr<string>;
  referrerPolicy?: Attr<string>;
}

export interface ScriptHTMLAttributes extends HTMLAttributes {
  src?: Attr<string>;
  type?: Attr<string>;
  async?: Attr<boolean>;
  defer?: Attr<boolean>;
  noModule?: Attr<boolean>;
  crossOrigin?: Attr<string>;
}

export interface LinkHTMLAttributes extends HTMLAttributes {
  href?: Attr<string>;
  rel?: Attr<string>;
  type?: Attr<string>;
  media?: Attr<string>;
  as?: Attr<string>;
  crossOrigin?: Attr<string>;
}

export interface MediaHTMLAttributes extends HTMLAttributes {
  src?: Attr<string>;
  controls?: Attr<boolean>;
  autoPlay?: Attr<boolean>;
  loop?: Attr<boolean>;
  muted?: Attr<boolean>;
  preload?: Attr<string>;
}

export interface VideoHTMLAttributes extends MediaHTMLAttributes {
  width?: Attr<string | number>;
  height?: Attr<string | number>;
  poster?: Attr<string>;
  playsInline?: Attr<boolean>;
}

export interface OlHTMLAttributes extends HTMLAttributes {
  start?: Attr<number>;
  reversed?: Attr<boolean>;
  type?: Attr<"1" | "a" | "A" | "i" | "I">;
}

export interface TableCellHTMLAttributes extends HTMLAttributes {
  colSpan?: Attr<number>;
  rowSpan?: Attr<number>;
  headers?: Attr<string>;
}

export interface ThHTMLAttributes extends TableCellHTMLAttributes {
  scope?: Attr<"row" | "col" | "rowgroup" | "colgroup">;
  abbr?: Attr<string>;
}

export interface ProgressHTMLAttributes extends HTMLAttributes {
  value?: Attr<string | number>;
  max?: Attr<string | number>;
}

export interface CanvasHTMLAttributes extends HTMLAttributes {
  width?: Attr<string | number>;
  height?: Attr<string | number>;
}

// ── JSX type surface ─────────────────────────────────────────────
// The structural pieces TypeScript needs to type-check TSX against this runtime.
// `IntrinsicElements` maps the common elements to their attribute shapes; the
// `[name]: HTMLAttributes` fallback keeps every other (and custom) element
// working with the global attributes (and its own `[attr]: any` escape hatch).
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

  /** Intrinsic (lowercase) elements, with per-element attribute types. */
  export interface IntrinsicElements {
    a: AnchorHTMLAttributes;
    audio: MediaHTMLAttributes;
    button: ButtonHTMLAttributes;
    canvas: CanvasHTMLAttributes;
    form: FormHTMLAttributes;
    img: ImgHTMLAttributes;
    input: InputHTMLAttributes;
    label: LabelHTMLAttributes;
    link: LinkHTMLAttributes;
    ol: OlHTMLAttributes;
    option: OptionHTMLAttributes;
    progress: ProgressHTMLAttributes;
    script: ScriptHTMLAttributes;
    select: SelectHTMLAttributes;
    td: TableCellHTMLAttributes;
    textarea: TextareaHTMLAttributes;
    th: ThHTMLAttributes;
    video: VideoHTMLAttributes;
    // Every other (and any custom) element: the global attributes.
    [name: string]: HTMLAttributes;
  }
}
