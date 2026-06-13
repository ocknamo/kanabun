/**
 * kanabun — JSX automatic runtime (development build).
 *
 * Bun/TypeScript import from here in dev mode. We don't use the extra dev
 * metadata (source location, etc.), so this simply delegates to `jsx`.
 */
import { jsx, Fragment } from "./jsx-runtime";
import type { Component } from "./jsx-runtime";
import type { Props } from "./dom";

export function jsxDEV(
  type: string | Component,
  props: Props,
  key?: unknown,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown,
): unknown {
  return jsx(type, props, key);
}

export { Fragment };
export type { JSX } from "./jsx-runtime";
