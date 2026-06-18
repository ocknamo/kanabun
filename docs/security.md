# Security audit & known risks

*English | [日本語](./security.ja.md)*

A record of the security findings from a whole-framework audit. These are
**not yet fixed** — they are tracked here so we can address them deliberately.
The threat model covers (1) common web risks such as XSS, (2) memory leaks, and
(3) latent risks from re-implementing a Web API ourselves.

Each finding was reproduced with a concrete proof-of-concept, not inferred.
Severity follows the project convention: 🔴 must-fix / 🟡 recommended / 🔵 minor.

## Summary

| ID | Severity | Area | One-line |
| --- | --- | --- | --- |
| [S1](#s1--ssr-attribute-name-injection-via-spread-props) | 🔴 | XSS (SSR) | Spread-prop attribute **names** are emitted unescaped and unvalidated |
| [S2](#s2--style-escape-via-css-interpolation) | 🔴 | XSS (SSR) | `css` interpolation can break out of the `<style>` raw-text body |
| [S3](#s3--unsanitized-url-schemes-on-hrefsrc) | 🟡 | XSS | No URL-scheme check on `href`/`src` (`javascript:` passes through) |
| [S4](#s4--servernode-diverges-from-the-real-dom) | 🟡 | Web-API reimpl. | `ServerNode` omits the real DOM's validation, hiding bugs server-side |
| [S5](#s5--dev-server-uncaught-decodeuricomponent-error) | 🟡 | Dev server | `decodeURIComponent` on the path can throw an uncaught `URIError` |
| [S6](#s6--ssr-tag-name-injection-via-dynamic-element-type) | 🟡 | XSS (SSR) | An untrusted **tag name** (`jsx(tag, …)`) is emitted unvalidated |
| [S7](#s7--unescaped-script-and-style-element-content) | 🟡 | XSS | `<script>` / `<style>` element children are emitted raw (and execute on the client) |

S6/S7 were found in the **second pass**, after surveying recent vulnerability
classes in other frameworks (see [References](#references)). Both share a root
cause with S1/S4: the runtime trusts inputs that the real DOM would reject, and
the SSR serializer treats some positions as raw.

Out of scope (intentionally not tracked): the CSS hash-collision "first wins"
behaviour and the dev-only unbounded `seen` warning set — both judged to have no
practical security impact.

### What is already solid

- **Text and attribute-value escaping.** `escapeText` / `escapeAttr` in
  `server-dom.ts` correctly neutralise `& < >` (and `"` for attribute values,
  which are always double-quoted), so ordinary `{userInput}` children and
  attribute values are not an XSS vector.
- **Memory management.** The owner-tree + `onCleanup` model disposes reactive
  scopes correctly across `createRoot`, `effect` re-runs (`disposeOwned`),
  `mapArray` (per-item roots, unused-item disposal), the router's
  `disposableSlot`, `resource` (version-based cancellation), and `<Suspense>`.
  Event listeners are registered once at element creation (never inside an
  effect), so they don't accumulate. No significant leak was found.
- **Dev-server path traversal.** `cli/src/dev.ts` contains traversal with both a
  lexical `..` check and a `realpath` containment check (catching symlinks that
  escape the served root).
- **Event handlers are never serialized (vs Svelte [CVE-2026-27121]).** `on*`
  props are attached with `addEventListener`, never written as attributes, and
  the server DOM's `addEventListener` is a no-op. So spreading attacker-controlled
  data containing `onclick`/`onerror` does **not** emit an inline handler — the
  exact sink of the Svelte spread-attribute SSR XSS. Verified: `<div {...{onclick:
  "alert(1)"}}>` renders `<div>x</div>`.
- **No prototype pollution (vs Vue [CVE-2024-6783], qs-style merges).**
  `mergeProps`/`splitProps` use `Object.keys` + `Object.defineProperty` (own keys
  only, and `__proto__` becomes an own property, not a prototype write), and the
  router parses queries with the standard `URLSearchParams` (no nested
  `a[b]=c` parsing). Verified: a `{"__proto__":{"polluted":1}}` source and a
  `?__proto__[x]=y` query both leave `Object.prototype` untouched.
- **No ReDoS.** The only regexes (`isExternal`, `SCOPED_AT`, dev's `MODULE_RE`)
  are anchored and free of nested quantifiers, so none backtracks catastrophically.
- **Attribute values escape `<` (vs the SolidJS `escapeHTML` gap).** `escapeAttr`
  escapes `< > & "`, so the well-known "`<` not escaped in attributes" trick does
  not apply.

---

## S1 — SSR attribute-name injection via spread props

**Where:** `packages/core/src/server-dom.ts` (`serialize`, `ServerNode.setAttribute`)

`serialize()` escapes attribute **values** but emits the attribute **name**
verbatim, and `ServerNode.setAttribute` — unlike the real DOM — performs no name
validation:

```ts
// server-dom.ts — serialize()
for (const [k, v] of node.attributes) attrs += ` ${k}="${escapeAttr(v)}"`; // k unescaped
// server-dom.ts — setAttribute(): real DOM throws InvalidCharacterError on a bad name
setAttribute(name, value) { this.attributes.set(name, String(value)); }
```

When a component spreads an object whose **keys** are attacker-controlled
(`<div {...userObject} />`), a key can close the tag and inject markup.

**Proof of concept** (reproduced):

```
key:  'x><img src=x onerror=alert(1)'
out:  <div x><img src=x onerror=alert(1)="y"></div>   ← tag escaped, XSS
```

The dangerous part is the **asymmetry**: on the client the real `setAttribute`
throws on an invalid name (fail-safe), but the server silently accepts it.

**Fix direction:** restrict attribute names to a safe set (e.g.
`/^[A-Za-z_:][-A-Za-z0-9_:.]*$/`) in `serialize` (or `setAttribute`), skipping or
throwing on invalid names so the server matches real-DOM behaviour.

## S2 — `<style>` escape via `css` interpolation

**Where:** `packages/core/src/css.ts` (`css`), `server-dom.ts` (`serialize`, raw-text path)

The public `css` helper concatenates interpolated values with
`String(values[i])`. `<style>` is a raw-text element, so `serialize()` emits its
body **unescaped** (correct per HTML spec). An interpolated value containing a
closing tag therefore escapes the `<style>`.

**Proof of concept** (reproduced):

```
css`... ${ "</style><img src=x onerror=alert(1)>" }`
head: <style data-k="...">.k-...{</style><img src=x onerror=alert(1)>}</style>  ← XSS
```

The client path (`style.textContent = cssText`) is safe; this surfaces **only on
SSR**. The doc comment already warns against interpolating untrusted input into
`<style>`/`<script>`, but the `css` interpolation syntax invites the misuse.

**Fix direction:** when serialising raw-text bodies (or in `css`'s output),
neutralise the case-insensitive sequences `</style` and `</script`. The HTML
spec forbids those inside raw text, so neutralising them is safe.

## S3 — Unsanitized URL schemes on `href`/`src`

**Where:** `packages/core/src/dom.ts` (`setAttr`), `packages/router/src/router.ts` (`Link`)

URL-bearing attributes are passed through unchecked, so
`href="javascript:alert(1)"` is emitted as-is (reproduced). Many frameworks
(Solid, Svelte) also leave this to the developer, so it is partly an accepted
risk — but note that the router's `<Link>` treats `javascript:` as an "external"
link (`isExternal()` matches the scheme) and **falls through to the browser's
default**, so a click executes it.

**Fix direction:** document the responsibility clearly, and in `<Link>` reject
dangerous schemes (`javascript:`, `data:`) rather than treating them as external.

## S4 — `ServerNode` diverges from the real DOM

**Where:** `packages/core/src/server-dom.ts`

The root cause behind S1: `ServerNode` does not enforce the real DOM's
invariants (attribute-name validation, tag-name validation in `createElement`,
etc.). This is the classic "re-implemented a Web API" risk — client and server
behaviour diverge, and the server is the one that skips the guard. A small
validation layer before serialisation, matching the real DOM's minimum checks,
would close this class of issue.

## S5 — Dev server: uncaught `decodeURIComponent` error

**Where:** `packages/cli/src/dev.ts`

```ts
const pathname = decodeURIComponent(new URL(req.url).pathname);
```

A malformed percent-escape (`/%ZZ`, a lone `%`) makes `decodeURIComponent` throw
a `URIError` that is not caught in the handler. This is dev-only and fails per
request (the server stays up), but wrapping the decode in a `try/catch` that
falls back to a 404 is the robust fix. The traversal containment checks
themselves are sound.

## S6 — SSR tag-name injection via dynamic element type

**Where:** `packages/core/src/server-dom.ts` (`ServerDocument.createElement`, `serialize`)

`ServerDocument.createElement(tag)` stores `tag.toUpperCase()` with no
validation, and `serialize` emits `` `<${tag}…>` `` directly. The real DOM's
`createElement` throws `InvalidCharacterError` on an illegal tag name, so a
malicious tag fails safe on the client but injects markup on the server. This is
the same class as Svelte's [CVE-2026-27122] (`<svelte:element this={tag}>`).

kanabun has no built-in dynamic-tag component, so this requires a developer to
pass an untrusted value as the element type — e.g. `jsx(userTag, props)` or a
wrapper that does. It is therefore lower-likelihood than S1, but the same root
cause (S4).

**Proof of concept** (reproduced):

```
jsx("img src=x onerror=alert(1)", …)
out: <img src=x onerror=alert(1)></img src=x onerror=alert(1)>   ← XSS
```

**Fix direction:** validate the tag name (e.g. `/^[a-zA-Z][a-zA-Z0-9-]*$/`) in
`ServerDocument.createElement`, matching the real DOM, so an invalid tag throws
rather than serializing.

## S7 — Unescaped script and style element content

**Where:** `packages/core/src/server-dom.ts` (`serialize`, raw-text path); `dom.ts` (client)

`serialize` treats `<script>` and `<style>` as raw-text and emits their child
text **unescaped** (correct per HTML spec). So `<script>{userData}</script>` or
`<style>{userData}</style>` injects markup on SSR. Unlike S2 this is not specific
to the `css` helper — it is any untrusted text placed as a `<script>`/`<style>`
child. It also bites on the **client**: a `<script>` element created via
`createElement` and inserted into the document executes its text content.

**Proof of concept** (reproduced, SSR):

```
jsx("script", { children: "0;</script><img src=x onerror=alert(1)>" })
out: <script>0;</script><img src=x onerror=alert(1)></script>   ← XSS
```

This is closely related to S2 (same raw-text sink). Most frameworks make placing
untrusted data here awkward by construction (cf. React, which has no plain-text
`<script>` children path); kanabun offers no guardrail or warning.

**Fix direction:** at minimum, neutralise `</script` / `</style` in serialized
raw-text (shared fix with S2), and document that untrusted data must never be a
`<script>`/`<style>` child. Optionally, a dev-time warning when a reactive/string
child is placed inside a raw-text element.

## References

Recent vulnerability classes in other frameworks that informed the second-pass
audit (S6/S7 and the "already solid" comparisons):

- Svelte — SSR XSS via spread attributes (event handlers): [CVE-2026-27121] /
  advisory [GHSA-f7gr-6p89-r883].
- Svelte — SSR XSS via `<svelte:element this={tag}>` (tag-name injection):
  [CVE-2026-27122].
- Svelte — SSR XSS via HTML comment injection in hydration markers: CVE-2026-27902.
- Vue — XSS via prototype pollution (`Object.prototype.staticClass/staticStyle`):
  [CVE-2024-6783].
- SolidJS — XSS via unescaped JSX fragment / `escapeHTML` not escaping `<` in
  attributes: advisory GHSA-3qxh-p7jc-5xh6 and the SolidJS security guide.

[CVE-2026-27121]: https://github.com/sveltejs/svelte/security/advisories/GHSA-f7gr-6p89-r883
[GHSA-f7gr-6p89-r883]: https://github.com/sveltejs/svelte/security/advisories/GHSA-f7gr-6p89-r883
[CVE-2026-27122]: https://www.sentinelone.com/vulnerability-database/cve-2026-27122/
[CVE-2024-6783]: https://www.sentinelone.com/vulnerability-database/cve-2024-6783/
