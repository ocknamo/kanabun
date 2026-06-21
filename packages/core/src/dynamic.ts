/**
 * kanabun — `<Dynamic>`
 * ------------------------------------------------------------------
 * Render a host chosen at runtime — a tag name (`"div"`) or a component — and
 * reactively swap it as that choice changes. The remaining props (and children)
 * are forwarded to whatever is rendered.
 *
 *     <Dynamic component="h1">Title</Dynamic>          // an <h1>
 *     <Dynamic component={() => heading()} class="t">…</Dynamic>
 *     <Dynamic component={() => active() ? Tab : Panel} {...rest} />
 *
 * The `component` follows the framework's core convention — **a function is
 * reactive**. So:
 *   - `component="div"` (or any string) renders that tag, statically.
 *   - `component={() => …}` is an accessor: it is read reactively and may return
 *     a tag name *or* a component; when its value changes the host is swapped.
 *
 * Because a component is itself a function, pass a *static* component through an
 * accessor too (`component={() => MyComp}`) — this keeps the "function = lazy/
 * reactive" rule unambiguous (there is no compiler to tell the two apart).
 */
import { createElement } from "./dom";
import type { Props } from "./dom";
import type { Component, JSXChild } from "./jsx-runtime";

/** A resolved `<Dynamic>` host: a tag name or a component. */
export type DynamicComponent = string | Component;

export interface DynamicProps {
  /**
   * The host to render: a tag name, or an **accessor** returning a tag name or
   * a component (reactive — the host is swapped when its value changes). A
   * nullish value renders nothing.
   */
  component:
    | string
    | (() => DynamicComponent | null | undefined);
  /** Forwarded to the rendered element/component (children included). */
  [prop: string]: unknown;
}

/**
 * Render the `component` host with the remaining props forwarded. Returns a
 * reactive thunk so the host is rebuilt (and the previous one disposed) when an
 * accessor `component` changes.
 */
export function Dynamic(props: DynamicProps): () => JSXChild {
  return () => {
    const raw = props.component;
    const comp = (typeof raw === "function" ? raw() : raw) as
      | DynamicComponent
      | null
      | undefined;
    if (comp == null) return null;

    // Forward every prop except `component` itself.
    const rest: Props = {};
    for (const key in props) {
      if (key !== "component") rest[key] = props[key];
    }

    return typeof comp === "string"
      ? (createElement(comp, rest) as unknown as JSXChild)
      : (comp(rest) as JSXChild);
  };
}
