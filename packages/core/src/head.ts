/**
 * kanabun — document head API (`<Head>` / `<Title>`)
 * ------------------------------------------------------------------
 * Ergonomic, per-page `<head>` content (title, meta, link) that works the same
 * for SSR/SSG and the client. It rides the existing head plumbing: on the server
 * the scoped-CSS helper already injects into the server document's `<head>`, and
 * `renderToString` returns that `<head>` — `<Head>` simply appends there too, so
 * its content lands in the serialized `head`. On the client it appends to the
 * live `document.head`.
 *
 *     <Head>
 *       <meta name="description" content={() => summary()} />
 *       <link rel="canonical" href={() => url()} />
 *     </Head>
 *     <Title>{() => `${post().title} — My Site`}</Title>
 *
 * Content is **owned by the current reactive tree**: reactive attributes/text
 * inside update in place, and the appended nodes are removed when the owner
 * disposes (e.g. navigating away), so per-page tags don't leak across pages.
 *
 * The children are built **once** (eagerly, like ordinary JSX) and appended —
 * put reactivity in *attributes* and *text* (`content={() => …}`), not in a
 * top-level function child that swaps whole elements. Render a single `<Title>`
 * per page (the browser uses the first `<title>`; one-per-page keeps it
 * unambiguous, and unmount removes it so the next page's title takes over).
 */
import { doc, normalize } from "./dom";
import { onCleanup } from "./lifecycle";
import { jsx } from "./jsx-runtime";
import type { JSXChild } from "./jsx-runtime";

export interface HeadProps {
  /** Elements to place in `<head>` (e.g. `<meta>`, `<link>`, `<title>`). */
  children?: unknown;
}

/**
 * Append `children` to `document.head`, removing them again when the owning
 * scope disposes. Renders nothing in its original place.
 */
export function Head(props: HeadProps): () => JSXChild {
  const head = doc().head as unknown as Node;
  const nodes = normalize(props.children);
  for (const node of nodes) head.appendChild(node);
  onCleanup(() => {
    for (const node of nodes) {
      if (node.parentNode === head) head.removeChild(node);
    }
  });
  return () => null;
}

export interface TitleProps {
  /** The document title (reactive or static). */
  children?: unknown;
}

/**
 * Set the document title. Sugar for a `<title>` placed in `<head>` via
 * {@link Head}; the text may be reactive (`<Title>{() => t()}</Title>`).
 */
export function Title(props: TitleProps): () => JSXChild {
  return Head({ children: jsx("title", { children: props.children }) });
}
