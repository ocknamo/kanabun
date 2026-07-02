/**
 * The shared HTML document template.
 *
 * Every place the CLI wraps server-rendered markup in a full page — `kanabun
 * generate` (SSG) and `serve` (SSR) — goes through the same
 * {@link DocumentContext} + {@link defaultDocument} pair, so a page prerendered
 * at build time and one rendered per request produce the same shell. A config's
 * `document(ctx)` overrides the built-in template with the same context.
 */

/** Context handed to a custom `document` template (SSG config or SSR config). */
export interface DocumentContext {
  /** The serialized app markup for this route (place in the mount container). */
  html: string;
  /** Collected scoped-CSS `<style>` tags to place in `<head>`. */
  head: string;
  /** The route path being rendered (e.g. `"/"`, `"/about/"`). */
  path: string;
  /** The `<script>` tag for the client bundle, or `""` when there is no client. */
  script: string;
  /**
   * The normalized public base path (always leading + trailing slash, e.g.
   * `"/"` or `"/repo/"`). Use it to prefix asset/link URLs in a custom
   * template when the site is served from a sub-path.
   */
  base: string;
}

/** The built-in HTML document used when the config supplies no `document`. */
export function defaultDocument(ctx: DocumentContext, title: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>${title}</title>\n${ctx.head}\n` +
    `</head>\n<body>\n<div id="app">${ctx.html}</div>\n${ctx.script}\n` +
    `</body>\n</html>\n`
  );
}
