# Security audit & known risks

*English | [日本語](./security.ja.md)*

A record of the security findings from a whole-framework audit. **All tracked
findings are now addressed** (S1–S7); each section keeps the original
proof-of-concept and records the fix, so the history stays auditable.
The threat model covers (1) common web risks such as XSS, (2) memory leaks, and
(3) latent risks from re-implementing a Web API ourselves.

Each finding was reproduced with a concrete proof-of-concept, not inferred.
Severity follows the project convention: 🔴 must-fix / 🟡 recommended / 🔵 minor.

## Summary

| ID | Severity | Area | One-line |
| --- | --- | --- | --- |
| [S1](#s1--ssr-attribute-name-injection-via-spread-props) | ✅ 🔴 | XSS (SSR) | Spread-prop attribute **names** are emitted unescaped and unvalidated — **fixed** |
| [S2](#s2--style-escape-via-css-interpolation) | ✅ 🔴 | XSS (SSR) | `css` interpolation can break out of the `<style>` raw-text body — **fixed** |
| [S3](#s3--unsanitized-url-schemes-on-hrefsrc) | ✅ 🟡 | XSS | `<Link>` now rejects `javascript:`/`data:`/`vbscript:`; core `href`/`src` documented as the dev's responsibility — **fixed** |
| [S4](#s4--servernode-diverges-from-the-real-dom) | ✅ 🟡 | Web-API reimpl. | `ServerNode` now validates attribute **and** tag names like the real DOM — **fixed** |
| [S5](#s5--dev-server-uncaught-decodeuricomponent-error) | ✅ 🟡 | Dev server | `decodeURIComponent` is now wrapped; a malformed escape 404s instead of throwing — **fixed** |
| [S6](#s6--ssr-tag-name-injection-via-dynamic-element-type) | ✅ 🟡 | XSS (SSR) | `createElement` now validates the tag name; an untrusted tag throws — **fixed** |
| [S7](#s7--unescaped-script-and-style-element-content) | ✅ 🟡 | XSS | SSR breakout neutralised (shared with S2) + a dev-time warning on raw-text children — **fixed** |

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

**✅ Fixed.** `ServerNode.setAttribute` now validates the name against
`VALID_ATTR_NAME` (`/^[A-Za-z_:][-A-Za-z0-9_:.]*$/`) and throws
`InvalidCharacterError` on an invalid name, like the real DOM's fail-safe. An
attacker-controlled spread key can no longer reach the serializer, so it cannot
close the tag. The pattern is **conservative**: it rejects every name the real
DOM rejects (and so closes the XSS sink), plus a few rare-but-legal names the
real DOM would accept (e.g. a leading hyphen, or non-ASCII letters) — erring on
the safe side. The client/server asymmetry that hid the bug is gone for the
injection cases. This narrows S4 (the shared root cause) for the attribute-name
case; the tag-name case is closed by S6.

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

**✅ Fixed.** `serialize`'s raw-text path now passes the body through
`escapeRawText`, which breaks the case-insensitive `</style` / `</script`
sequences by inserting a backslash (`<\/style` / `<\/script`). That backslash is
a harmless no-op in both CSS (`\/` is an escaped solidus) and JS (`<\/script>`
is a valid escape), so well-formed developer CSS/JS is unchanged, but an
interpolated value can no longer close the `<style>`/`<script>` and escape into
HTML. The client path (`style.textContent = …`) was already safe. This is a
shared sink with **S7**, so it also closes S7's **SSR** breakout (the client-side
`<script>`-execution facet of S7 is separate; see S7).

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

**✅ Fixed.** `<Link>` now detects a script-executing scheme
(`javascript:`/`data:`/`vbscript:`, after stripping the embedded ASCII
whitespace/control characters a browser would ignore) and renders an **inert
anchor** — no `href` is emitted, and the click handler skips `navigate` — so a
click can no longer reach the dangerous URL. Ordinary external links
(`https:`, `mailto:`, `//host`) are unaffected. The lower-level core sinks
(`setAttr` on a raw `href`/`src`, and `useNavigate`'s programmatic target) remain
the developer's responsibility, as in Solid/Svelte — documented on `LinkProps`
and here — but the one place the framework itself follows a URL on the user's
behalf (`<Link>`) is now guarded.

## S4 — `ServerNode` diverges from the real DOM

**Where:** `packages/core/src/server-dom.ts`

The root cause behind S1: `ServerNode` does not enforce the real DOM's
invariants (attribute-name validation, tag-name validation in `createElement`,
etc.). This is the classic "re-implemented a Web API" risk — client and server
behaviour diverge, and the server is the one that skips the guard. A small
validation layer before serialisation, matching the real DOM's minimum checks,
would close this class of issue.

**✅ Fixed.** Both concrete divergences that mattered are closed:
`ServerNode.setAttribute` validates the attribute name (S1) and
`ServerDocument.createElement` now validates the tag name (S6), each throwing
`InvalidCharacterError` like the real DOM. The server no longer accepts a name
the client would reject, so the asymmetry that hid these XSS sinks is gone.

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

**✅ Fixed.** `createDevHandler` now wraps `decodeURIComponent` in a `try/catch`
that returns a 404 on a malformed escape (`/%ZZ`, a lone `%`), so a bad request
can no longer throw out of the handler.

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

**✅ Fixed.** `ServerDocument.createElement` now validates the tag against
`VALID_TAG_NAME` (`/^[A-Za-z][A-Za-z0-9_:.-]*$/`) and throws
`InvalidCharacterError` on an illegal name, like the real DOM's fail-safe. The
PoC tag can no longer reach the serializer, so it cannot close the tag. The
pattern is conservative (it accepts ordinary and custom-element names while
rejecting everything the real DOM rejects), and it closes the tag-name facet of
S4 — the shared root cause.

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

**✅ Fixed.** Two layers now cover this:

1. **SSR breakout** — the S2 fix (`escapeRawText` in `serialize`) neutralises
   `</script` / `</style` for the SSR raw-text path, so the markup-breakout PoC
   above no longer escapes the element.
2. **Dev-time guardrail** — `createElement` now emits a deduped dev-time warning
   (opt-in, via `isDev()` / `kanabun dev`) whenever a child is placed inside a
   `<script>`/`<style>` element, since that content is raw text and is never
   HTML-escaped. The scoped `css` helper sets `style.textContent` directly (not
   via children), so legitimate styles don't trip the warning.

The one remaining facet is **inherent DOM behaviour, not a framework bug**: a
`<script>` element created on the client and inserted into the document executes
its text content — that is what the real DOM does for any `<script>` node, so the
fix is the dev warning that steers untrusted data away from this position rather
than a silent behaviour change.

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
