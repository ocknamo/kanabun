/**
 * kanabun — `<Portal>`
 * ------------------------------------------------------------------
 * Render children into a *different* DOM node (by default `document.body`) — for
 * modals, tooltips, toasts and the like, which must escape the parent's overflow
 * / stacking context. The children stay **owned by the current reactive tree**:
 * their reactivity is created under whatever owner renders the `<Portal>`, and
 * disposal follows that owner (not the DOM location), so navigating away or
 * tearing down the component removes the portaled nodes too.
 *
 *     <Portal>
 *       <div class={overlay}>…</div>
 *     </Portal>
 *     <Portal mount={tooltipLayer}>{() => <Tip />}</Portal>
 *
 * The portaled content is inserted between two comment markers in the target so
 * the exact set of nodes can be removed again on disposal — including any nodes a
 * reactive child adds later. `<Portal>` renders nothing in its original place.
 *
 * SSR note: the target is a live DOM node, so on the server the portaled content
 * lands in the server document's `<body>` and is **not** part of the serialized
 * app markup (`renderToString` returns the mounted subtree + `<head>`). Portals
 * are a client concern; for per-page `<head>` content use {@link ./head!Head}.
 */
import { doc, insert } from "./dom";
import { onCleanup } from "./lifecycle";
import type { JSXChild } from "./jsx-runtime";

export interface PortalProps {
  /** Where to render the children. Defaults to `document.body`. */
  mount?: Element;
  /** The content to teleport. Wrap in a function for a lazily-built subtree. */
  children?: unknown;
}

/**
 * Teleport `children` into `mount` (default `document.body`) while keeping them
 * owned by the current reactive scope. Returns an empty placeholder for the
 * `<Portal>`'s own position.
 */
export function Portal(props: PortalProps): () => JSXChild {
  const target = (props.mount ?? doc().body) as unknown as Node;
  const start = doc().createComment("portal");
  const end = doc().createComment("/portal");
  target.appendChild(start);
  target.appendChild(end);

  // `insert` places (and keeps reactive) the children just before `end`, so the
  // whole portaled range lives in `[start, end]`.
  insert(target, props.children, end);

  // On disposal of the owning scope, remove every node from `start` to `end`
  // inclusive — capturing nodes a reactive child inserted after mount too.
  onCleanup(() => {
    let node: Node | null = start;
    while (node !== null) {
      const next: Node | null = node.nextSibling;
      target.removeChild(node);
      if (node === end) break;
      node = next;
    }
  });

  return () => null;
}
