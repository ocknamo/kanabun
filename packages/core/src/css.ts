/**
 * kanabun — scoped CSS (runtime, no compiler)
 * ------------------------------------------------------------------
 * `css` is an Emotion-style helper: it takes a block of CSS, hashes the body to
 * a stable class name (`k-<hash>`), scopes every rule under that class, injects
 * a single `<style>` into `<head>` (deduped by hash), and returns the class
 * name to apply.
 *
 *     const button = css`
 *       color: red;
 *       padding: 0.5rem 1rem;
 *       &:hover { color: blue; }     // -> .k-xxxx:hover
 *       .icon  { margin-right: 4px } // -> .k-xxxx .icon  (descendant)
 *       @media (min-width: 40rem) { padding: 1rem; } // inner rules re-scoped
 *     `;
 *     <button class={button}>Save</button>
 *
 * This honours the framework's "runtime only, zero dependencies" stance: a
 * unique content hash means styles can never collide, so no CSS parser or
 * selector rewriting against the live DOM is needed — only string scoping.
 *
 * Supported subset (intentionally bounded, so it stays rock-solid):
 *   - top-level declarations          -> `.k-hash { … }`
 *   - nested blocks with `&`          -> `&` replaced by `.k-hash`
 *   - nested blocks without `&`       -> descendant (`.k-hash <selector>`)
 *   - comma selector lists            -> each part scoped (commas inside
 *                                        `()`/`[]`, e.g. `:not(a, b)`, are kept)
 *   - conditional group at-rules       -> `@media`/`@supports`/`@container`/
 *     (`@media` etc.)                    `@document`/`@layer` recurse and scope
 *                                        their inner rules
 *   - other at-rules (`@keyframes`,    -> passed through verbatim (they are
 *     `@font-face`, …)                   inherently global; manage names yourself)
 *
 * Known limitations (the scope is a small lexical transform, not a full CSS
 * parser — by design, so it stays rock-solid and 100% tested):
 *   - A declaration that sits *before* a nested block must be terminated with
 *     `;` (e.g. `color: red; &:hover { … }`). This matches Sass / native CSS
 *     nesting; an un-terminated declaration is absorbed into the next selector.
 *   - Brace matching is lexical, so a literal `{`/`}` inside a string or a CSS
 *     comment (e.g. `content: "}"`) is misread as a block boundary. Component
 *     styles essentially never need that — use a global stylesheet if you do.
 *   - Top-level declarations are hoisted into a single `.k-hash { … }` rule
 *     emitted before any blocks, so declarations written *after* a block (or
 *     after an `@media`) move ahead of it. Cascade-wise this is almost always
 *     immaterial; keep order-sensitive overrides inside the same block.
 *   - Stylesheet-level at-rules that cannot be nested (`@import`, `@charset`)
 *     are not supported here (they'd land inside the scope rule and be ignored
 *     by the browser); put them in a global stylesheet.
 */
/** At-rules whose body is a list of nested rules (so it must be re-scoped). */
const SCOPED_AT = /^@(media|supports|container|document|layer)\b/i;

/**
 * Scope a block of CSS, hash it, inject a `<style>` once, and return the
 * generated class name. Usable as a tagged template (`` css`…` ``) or with a
 * plain string (`css("…")`); interpolations are stringified.
 */
export function css(
  strings: TemplateStringsArray | string,
  ...values: unknown[]
): string {
  const body =
    typeof strings === "string"
      ? strings
      : strings.reduce(
          (acc, s, i) =>
            acc + s + (i < values.length ? String(values[i]) : ""),
          "",
        );
  const id = hash(body);
  const cls = "k-" + id;
  inject(id, scopeRules(body, "." + cls));
  return cls;
}

// ── Scoping ──────────────────────────────────────────────────────
/** A nested `selector { … }` block found at the top level of a body. */
interface Block {
  prelude: string;
  inner: string;
}

/**
 * Split a CSS body into the declarations sitting at its top level and the
 * nested blocks. Brace depth is tracked so nested braces stay inside `inner`.
 */
function parseBlocks(body: string): { decls: string; blocks: Block[] } {
  const blocks: Block[] = [];
  let decls = "";
  let depth = 0;
  let seg = ""; // depth-0 text since the last block (declarations + a prelude)
  let inner = "";
  let prelude = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "{") {
      if (depth === 0) {
        // Everything up to the last `;` is declarations; the rest is the
        // selector prelude for the block we're entering.
        const semi = seg.lastIndexOf(";");
        decls += seg.slice(0, semi + 1);
        prelude = seg.slice(semi + 1);
        seg = "";
        inner = "";
      } else {
        inner += c;
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude, inner });
      } else if (depth > 0) {
        inner += c;
      } else {
        depth = 0; // tolerate an unbalanced `}`
      }
    } else if (depth === 0) {
      seg += c;
    } else {
      inner += c;
    }
  }
  decls += seg; // trailing declarations after the last block (or the whole body)
  return { decls, blocks };
}

/** Recursively scope `body` so its declarations land under `scope`. */
function scopeRules(body: string, scope: string): string {
  const { decls, blocks } = parseBlocks(body);
  let out = "";
  const d = decls.trim();
  if (d) out += `${scope}{${d}}`;
  for (const { prelude, inner } of blocks) {
    const p = prelude.trim();
    if (p[0] === "@") {
      out += SCOPED_AT.test(p)
        ? `${p}{${scopeRules(inner, scope)}}`
        : `${p}{${inner.trim()}}`;
    } else {
      out += scopeRules(inner, scopeSelector(p, scope));
    }
  }
  return out;
}

/** Scope each comma-separated selector: `&` -> scope, otherwise descendant. */
function scopeSelector(prelude: string, scope: string): string {
  return splitTop(prelude, ",")
    .map((part) => {
      const s = part.trim();
      return s.includes("&") ? s.replace(/&/g, scope) : `${scope} ${s}`;
    })
    .join(",");
}

/** Split on `sep`, ignoring separators nested inside `()` or `[]`. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

// ── Injection ────────────────────────────────────────────────────
/**
 * Styles produced before any `document` exists (e.g. a module-level `css\`…\``
 * evaluated when this module is first imported on a server — before
 * `renderToString` installs its document). They are replayed by
 * {@link flushStyles} once a document is available, so SSR captures them too.
 */
const pending = new Map<string, string>();

/**
 * Append a `<style data-k="id">` to `<head>`, unless one already exists.
 * Dedup is by hash against the live `<head>` (so it survives re-renders without
 * a module cache). In the practically-impossible event of a hash collision the
 * first body wins and the second is skipped — see `hash` for the spread.
 *
 * With no `document` (server import time) the style is recorded as `pending`
 * rather than throwing; {@link flushStyles} replays it into a real `<head>`.
 */
function inject(id: string, cssText: string): void {
  const d = (globalThis as { document?: Document }).document;
  if (!d) {
    if (!pending.has(id)) pending.set(id, cssText);
    return;
  }
  injectInto(d, id, cssText);
}

function injectInto(d: Document, id: string, cssText: string): void {
  const head = d.head;
  for (const n of head.childNodes) {
    if (n.nodeType === 1 && (n as Element).getAttribute("data-k") === id) return;
  }
  const style = d.createElement("style");
  style.setAttribute("data-k", id);
  style.textContent = cssText;
  head.appendChild(style);
}

/**
 * Replay every `pending` style into the current document's `<head>`. Called by
 * the server renderer after it installs its document, so styles registered at
 * import time (before any document existed) still reach the rendered `<head>`.
 * `pending` is kept (not cleared), so each fresh server render re-captures them.
 */
export function flushStyles(): void {
  const d = (globalThis as { document?: Document }).document;
  if (!d) return;
  for (const [id, cssText] of pending) injectInto(d, id, cssText);
}

// ── Hashing ──────────────────────────────────────────────────────
/**
 * A small, stable string hash (djb2 ⊕ FNV-1a, concatenated in base36) — enough
 * spread to make collisions between distinct style blocks practically nil while
 * keeping class names short.
 */
function hash(str: string): string {
  let h1 = 5381; // djb2
  let h2 = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1) ^ c;
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
