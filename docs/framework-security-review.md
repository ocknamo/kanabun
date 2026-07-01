# Framework security review — attack-vector-driven

*English | [日本語](./framework-security-review.ja.md)*

This report is a **second, externally-driven** security review of kanabun. Where
[`security.md`](./security.md) records the findings of an internal whole-framework
audit (S1–S7, all fixed), this one starts from the *outside*: it surveys the
High-or-above CVEs of the major front-end frameworks (Angular / AngularJS, React,
Vue, Svelte / SvelteKit, Solid), distils them into a set of **typical attack
vectors**, then checks kanabun against each one — and explains *why* a given
vector does or does not apply, with a code reference and, where practical, a
reproduced check.

The conclusion up front: **no new vulnerability was found.** kanabun's tiny
surface (runtime JSX, signals, no compiler, no server framework, zero runtime
dependencies) structurally excludes most of the classes below, and the handful
that *could* apply were already closed by S1–S7. Each verdict is spelled out.

Severity uses the project convention: 🔴 must-fix / 🟡 recommended / 🔵 minor /
✅ not applicable or already mitigated.

---

## Part 1 — Survey of High+ CVEs and the attack vectors they represent

The CVEs below are grouped by the **vector class** they exemplify, not by
framework. Each class becomes a review item in Part 2.

### The CVE landscape (representative High/Critical items)

| Framework | CVE / advisory | Class | One-line |
| --- | --- | --- | --- |
| Angular | CVE-2025-66412 (8.5) | Sanitizer bypass | Stored XSS via mis-classified SVG/MathML attributes bypassing the sanitizer |
| Angular | CVE-2026-32635 (8.6) | Sanitizer bypass | i18n-marked `href`/`src` skips URL sanitization |
| Angular | CVE-2026-52725 / CVE-2026-50557 | Sanitizer bypass | Namespaced `<svg:script>` / attribute bypasses compile-time script-stripping |
| AngularJS | CVE-2022-27665 & class | Client-side template injection | `{{…}}` expression evaluated in the browser → sandbox escape → XSS |
| React | CVE-2025-55182 "React2Shell" (10.0) | Insecure deserialization | RSC deserializes attacker POST body → RCE on the server |
| React | CVE-2025-55184 / CVE-2025-67779 (7.5) | DoS | RSC request handling exhausts CPU/memory |
| Vue | CVE-2024-6783 | Prototype-pollution → XSS | Polluted `Object.prototype.staticClass/staticStyle` renders into the DOM |
| vue-i18n | CVE-2025-27597 (8.9) | Prototype pollution | Message-compiler prototype pollution → DoS/possible code exec |
| Svelte | CVE-2026-27121 | SSR spread-attribute XSS | Attacker-controlled spread emits an inline `onclick`/`onerror` |
| Svelte | CVE-2026-27122 | Dynamic tag injection | `<svelte:element this={tag}>` with an untrusted tag closes the tag |
| Svelte | CVE-2026-27902 | Hydration-marker injection | Untrusted data in an HTML comment / hydration marker breaks out |
| SvelteKit | CVE-2025-32388 | Reflected XSS | Iterating `searchParams` renders unsanitized param *names* |
| SvelteKit | CVE-2026-22803 / CVE-2025-67647 | SSRF | Spoofed `Host` header → server-side request to internal services |
| devalue | CVE-2026-22774/22775 | DoS | Unvalidated Base64 in hydration parse → CPU/memory exhaustion |
| Solid | CVE-2025-27109 | Fragment escaping gap | JSX expressions inside JSX fragments were not escaped on SSR |
| Solid | (advisory) escapeHTML | Attribute escaping gap | `<` not escaped in attribute values in one path |

Sources are linked at the end.

### The distilled attack vectors

From the landscape above, the recurring root-cause classes are:

- **A1 — SSR/serializer XSS.** Untrusted data reaches the HTML string through a
  position the serializer emits raw or under-escapes: attribute *values*,
  attribute *names*, tag *names*, or raw-text (`<script>`/`<style>`) bodies.
  *(Angular sanitizer bypasses, Solid fragment/attr gaps, Svelte 27122, SvelteKit
  32388.)*
- **A2 — Spread-attribute event-handler injection.** A component spreads
  attacker-controlled keys and an `on*` handler is emitted as an inline
  attribute. *(Svelte CVE-2026-27121.)*
- **A3 — Dynamic element/tag injection.** A tag name chosen at runtime from
  untrusted input closes the tag or names a dangerous element. *(Svelte
  CVE-2026-27122.)*
- **A4 — Client-side template injection / expression sandbox escape.** The
  framework evaluates template expressions found in rendered content.
  *(AngularJS `{{…}}`.)*
- **A5 — Prototype pollution → XSS/DoS.** A recursive merge or a nested query
  parser writes through `__proto__`, and a later render reads the polluted global
  prototype. *(Vue CVE-2024-6783, vue-i18n CVE-2025-27597.)*
- **A6 — Unsafe URL schemes on `href`/`src`.** `javascript:`/`data:`/`vbscript:`
  is followed on click. *(Cross-framework XSS class; the framework-owned risk is
  where the router follows a URL for you.)*
- **A7 — Insecure deserialization of client↔server payloads.** A serialized
  request/hydration payload is deserialized with too much trust. *(React
  CVE-2025-55182.)*
- **A8 — Server request-handling: SSRF / DoS.** The server framework trusts the
  `Host` header, or parses hydration input without bounds. *(SvelteKit
  CVE-2026-22803, devalue DoS.)*
- **A9 — Dev-server / build tooling: path traversal & crashes.** The dev server
  serves files outside the root, or a malformed request crashes the handler.
- **A10 — ReDoS.** A framework regex backtracks catastrophically on crafted
  input.
- **A11 — Hydration-marker / comment injection.** Untrusted data inside a
  hydration marker or HTML comment breaks out. *(Svelte CVE-2026-27902.)*
- **A12 — Client-side memory exhaustion.** Reactivity leaks scopes/listeners
  until the tab dies (the client analogue of the server DoS class).

---

## Part 2 — kanabun reviewed against each vector

Each item states the verdict, the reasoning tied to specific code, and the
evidence. Eight of the claims below are backed by a reproduced check
(V1–V8, run against the real source; all pass).

### A1 — SSR/serializer XSS ✅ mitigated (S1/S2/S4/S6/S7)

kanabun's *only* HTML-string-producing path is `serialize()` in
`packages/core/src/server-dom.ts`. Every position an attacker could reach is
guarded:

- **Attribute values** — `escapeAttr` neutralises `& < > "` and values are
  always double-quoted (`server-dom.ts:48`, emitted at `:249`). This closes the
  Solid `escapeHTML`-doesn't-escape-`<` class. *(V7: a `title` of
  `"><img …>` renders as `&quot;&gt;&lt;img …`.)*
- **Text children** — `escapeText` neutralises `& < >` (`:44`, `:245`). Ordinary
  `{userInput}` is never an injection. *(V6.)*
- **Attribute names** — `ServerNode.setAttribute` validates against
  `VALID_ATTR_NAME` and throws like the real DOM (`:167`). An attacker-controlled
  spread *key* (`<div {...user} />`) can no longer close the tag — this was **S1**.
  *(V2.)*
- **Tag names** — `ServerDocument.createElement` validates against
  `VALID_TAG_NAME` and throws (`:224`). An untrusted element type
  (`jsx(userTag, …)`) can no longer inject markup — this was **S6**, the direct
  analogue of Svelte CVE-2026-27122. *(V8.)*
- **Raw-text bodies** — `<script>`/`<style>` bodies are emitted verbatim (correct
  per HTML spec), but `escapeRawText` breaks the case-insensitive `</script` /
  `</style` breakout sequence (`:64`, applied at `:263`). This was **S2/S7**.
  *(V5: a `css` interpolation of `</style><img …>` cannot escape the `<style>`.)*

The Angular sanitizer-bypass CVEs (SVG/MathML/namespace) have **no analogue**:
kanabun has no HTML sanitizer to bypass. It never parses an untrusted HTML string
into DOM — there is no `[innerHTML]` binding, no `dangerouslySetInnerHTML`, no
`v-html`. Content becomes DOM only through `createTextNode`/`setAttribute`
(client) or the escaped serializer (server). A grep for `innerHTML`,
`insertAdjacentHTML`, `document.write`, `outerHTML` across the source returns
nothing. The whole "did the sanitizer's allow-list mis-classify this element?"
question cannot arise because there is no allow-list and no string-to-DOM parse.

### A2 — Spread-attribute event-handler injection ✅ structurally excluded

This is the exact sink of **Svelte CVE-2026-27121**. In kanabun, `on*` props are
handled by `applyProp` (`dom.ts:96`) with `addEventListener` and are **never**
written as attributes; on the server, `ServerNode.addEventListener` is a no-op
(`server-dom.ts:181`) and drops them entirely. So spreading
`{...{ onclick: "alert(1)" }}` attaches no attribute and serializes nothing.
*(V1: `<div {...{onclick:"alert(1)"}}>x</div>` renders exactly `<div>x</div>`.)*
The `on*`-is-always-a-listener rule is a framework invariant, not a per-call
decision, so there is no code path where an attacker-supplied `on*` becomes
inline HTML.

### A3 — Dynamic element/tag injection ✅ mitigated (S6)

kanabun *does* ship a dynamic-host component — `<Dynamic component={…}>`
(`dynamic.ts`) — and the low-level `jsx(type, …)` accepts a string tag. Both
route through `createElement`, and on the server through
`ServerDocument.createElement`, which now validates the tag name and throws on an
illegal one (`server-dom.ts:224`). So even if a developer wires an untrusted
value into `<Dynamic>`'s `component` or into `jsx`, a tag like
`img src=x onerror=…` fails safe instead of serializing. *(V8.)* On the client the
real `document.createElement` already throws `InvalidCharacterError` on the same
input, so client and server now agree — the asymmetry that hid Svelte's bug is
gone.

### A4 — Client-side template injection / sandbox escape ✅ not applicable by design

AngularJS's class of bug requires a **template evaluator**: the framework scans
rendered content for `{{ expression }}` and *evaluates* it. kanabun has no such
thing. There is no template language, no `{{…}}` interpolation, no expression
parser, no sandbox to escape. JSX is compiled by TypeScript/Bun to plain function
calls (`jsx(...)`) at build time; at runtime a "reactive value" is just a
JavaScript function the runtime calls (`dom.ts:105`), never a string it parses
and evals. A grep for `eval(`, `new Function`, and dynamic-code construction
across the source returns nothing. Untrusted data placed as a child is a *string*
that becomes a text node — it is never treated as a template. The entire class is
excluded by the "no compiler, no template DSL" founding constraint.

### A5 — Prototype pollution → XSS/DoS ✅ structurally excluded

Two candidate sinks exist and both are safe:

- **`mergeProps` / `splitProps`** (`props.ts`) copy with `Object.keys` +
  `Object.defineProperty` — own enumerable keys only. A source key named
  `__proto__` becomes an *own* property of the result (via `defineProperty`),
  **not** a write to `Object.prototype`. *(V3: merging
  `{"__proto__":{"polluted":1}}` leaves `Object.prototype.polluted`
  undefined.)* There is no recursive deep-merge — the Vue `staticClass`/
  `staticStyle` gadget (walking a nested AST/object and assigning through it) has
  no counterpart.
- **Router query parsing** (`location.ts:29`) uses the standard
  `URLSearchParams`, which produces flat string→string pairs. There is no
  `qs`-style `a[b]=c` nested-bracket parser, so `?__proto__[x]=y` yields a plain
  key `"__proto__[x]"`, not a prototype write. *(V4.)*

The island props path (`islands.ts:208`) does `JSON.parse` attacker-*readable*
(server-authored) markup, but `JSON.parse` does not pollute the prototype (a
`"__proto__"` key becomes an own property of the parsed object), and the docs
already mark island props as server-authored data, not a trust boundary.

### A6 — Unsafe URL schemes on `href`/`src` ✅ mitigated (S3) for the framework-owned case

The general principle across frameworks: raw `href="javascript:…"` on a
developer-authored element is the developer's responsibility (Solid, Svelte, and
kanabun all take this stance — documented on `LinkProps` and in S3). The part the
*framework* owns is any place it follows a URL on the user's behalf. That is
exactly `<Router>`'s `<Link>` / `useNavigate`, and it is guarded: `isUnsafeHref`
(`router.ts:329`) strips the ASCII whitespace/control characters a browser would
ignore, then rejects `javascript:`/`data:`/`vbscript:`; an unsafe `<Link>` renders
an **inert anchor** with no `href` (`router.ts:374`), and `handleClick` skips
`navigate`. External/scheme links (`https:`, `mailto:`, `//host`) still work.
This was **S3**. Note the router never performs an open-redirect-style
server-side redirect (there is no server framework), so the SvelteKit redirect-to-
SSRF chain has no analogue here.

### A7 — Insecure deserialization of client↔server payloads ✅ not applicable

React's **React2Shell** (CVE-2025-55182) is an RSC-specific flaw: a server
endpoint deserializes an attacker's POST body into live objects/functions and
executes them. kanabun has **no server component protocol, no RPC, no server
actions, and no custom deserializer.** `renderToString` (`server.ts`) is a pure
one-way function: view thunk → HTML string. It never reads a request body and
never deserializes client input. The only deserialization anywhere is
`JSON.parse` of island props — and those are *server-authored* data embedded in
markup the server itself produced, parsed into inert plain objects, never into
executable code. There is no path from an inbound network payload to code
execution.

### A8 — Server request-handling: SSRF / DoS ✅ not applicable (no server framework)

The SvelteKit `Host`-header SSRF (CVE-2026-22803) and the devalue hydration DoS
(CVE-2026-22774/5) both live in a **server framework / adapter** that handles
requests and parses hydration input. kanabun deliberately ships no such layer:
`packages/core` is runtime-independent (no `Bun.*`/`node:*`), and the only
request-handling code in the repo is the **dev server** (`cli/src/dev.ts`),
covered under A9. There is no production request handler that reads a `Host`
header, and no hydration-payload parser with an unbounded decode — hydration in
kanabun re-runs the app and rebuilds DOM from the same source (`dom.ts:319`), it
does not parse a serialized state blob. The DoS-via-parse class therefore has no
entry point.

### A9 — Dev-server / build tooling: path traversal & crashes ✅ solid

The dev server is dev-only and localhost-facing, but it is still hardened:

- **Path traversal** — `createDevHandler` (`dev.ts:246`) resolves the served root
  with `realpathSync`, then applies *two* containment checks: a lexical one on the
  resolved path (blocks `../` and `%2e%2e%2f`, since `decodeURIComponent` runs
  first) **and** a `realpath` check that blocks a symlink *inside* the root that
  points outside it (`dev.ts:295–297`). Both must pass or the request 404s.
- **Malformed-escape crash** — `decodeURIComponent` is wrapped in `try/catch`
  returning a 404, so `/%ZZ` or a lone `%` can't throw out of the handler
  (`dev.ts:281`). This was **S5**.
- **Build-time route escape** — SSG's `generate` rejects a route whose file
  escapes `outdir` (`generate.ts:149`), a guardrail on build-time config.

Injected dev preludes (`swapCss`, `devOverlay`) are framework-authored source
serialized via `.toString()`; they interpolate no request data, so there is no
reflected-XSS surface in the dev HTML.

### A10 — ReDoS ✅ none

Every regex in the framework is anchored and free of nested/overlapping
quantifiers, so none backtracks catastrophically: `VALID_ATTR_NAME` /
`VALID_TAG_NAME` (`server-dom.ts`), `isExternal` / `UNSAFE_SCHEME`
(`router.ts`), `SCOPED_AT` (`css.ts`), and `MODULE_RE` / the `<base>`/`<head>`
matchers (`dev.ts`) are all linear. None is applied to unbounded untrusted input
in a hot loop in a way that could be weaponised. The `css` scoper is a
character-by-character lexer, not a backtracking regex.

### A11 — Hydration-marker / comment injection ✅ not applicable

Svelte's CVE-2026-27902 comes from encoding state into HTML **comments** used as
hydration markers, where untrusted data can break out of the comment. kanabun's
hydration is marker-free: `hydrate` (`dom.ts:319`) does **not** adopt server
nodes against positional markers — it clears the container and re-renders from
the same component source (a deliberate consequence of the no-compiler design,
documented in `dom.ts` and `decisions.md`). No state is smuggled through comments
or hydration markers, so there is nothing to break out of. The comment nodes the
runtime *does* create (reactive-slot / portal anchors, `dom.ts:161`,
`portal.ts:43`) always have an empty or constant string body — never untrusted
data — and on the server `serialize` would escape a comment's content anyway.

### A12 — Client-side memory exhaustion ✅ solid (no leak found)

The owner-tree + `onCleanup` model disposes reactive scopes deterministically:
`createRoot`, effect re-runs (`disposeOwned`, `reactive.ts:269`), `mapArray`'s
per-item roots with unused-item disposal (`control-flow.ts:67`), the router's
`disposableSlot` (`router.ts:231`), `resource`'s version-based cancellation
(`async.ts:127`), and `<Suspense>`/`<ErrorBoundary>` all tear down on disposal.
Event listeners are registered once at element creation, never inside an effect
(`dom.ts:97`), so they do not accumulate across re-renders. The effect flush has
a `MAX_FLUSH_ITERATIONS` safety valve (`reactive.ts:62`) that throws on a
runaway update loop rather than hanging the tab. No unbounded growth tied to
untrusted input was found.

---

## Verdict

| Vector | Verdict | Basis |
| --- | --- | --- |
| A1 SSR/serializer XSS | ✅ mitigated | S1/S2/S4/S6/S7; V2/V5/V6/V7/V8 |
| A2 Spread event-handler | ✅ excluded | `addEventListener` only; V1 |
| A3 Dynamic tag injection | ✅ mitigated | S6 tag validation; V8 |
| A4 Template injection / sandbox | ✅ N/A | no template DSL, no eval |
| A5 Prototype pollution | ✅ excluded | own-key copy; V3/V4 |
| A6 Unsafe URL schemes | ✅ mitigated | S3 `<Link>` guard |
| A7 Insecure deserialization | ✅ N/A | no RSC/RPC/deserializer |
| A8 Server SSRF / DoS | ✅ N/A | no server framework |
| A9 Dev-server traversal/crash | ✅ solid | S5 + dual containment |
| A10 ReDoS | ✅ none | anchored, non-backtracking |
| A11 Hydration-marker injection | ✅ N/A | marker-free hydration |
| A12 Client memory exhaustion | ✅ solid | owner-tree disposal |

**No new finding.** The dominant reason kanabun avoids these classes is
*structural*: no HTML sanitizer to bypass (A1-Angular), no template evaluator
(A4), no recursive prop-merge or nested query parser (A5), no server component /
RPC / deserializer (A7), and no request-handling server framework (A8). The
vectors that its runtime JSX + SSR *could* have exposed (A1 serializer positions,
A2 event spread, A3 dynamic tags, A6 router URLs) were identified and closed in
the S1–S7 audit, and remain closed as verified by V1–V8.

---

## References

**Angular / AngularJS**
- CVE-2025-66412 — Stored XSS via SVG/MathML attribute mis-classification: <https://github.com/angular/angular/security/advisories/GHSA-v4hv-rgfq-gp49>
- CVE-2026-32635 — i18n sanitization bypass: <https://securityonline.info/translation-trap-high-severity-angular-xss-flaw-cve-2026-32635/>
- CVE-2026-52725 — Namespace sanitization bypass: <https://advisories.gitlab.com/npm/@angular/compiler/CVE-2026-50557/>
- AngularJS client-side template injection & sandbox escape: <https://portswigger.net/research/xss-without-html-client-side-template-injection-with-angularjs>, <https://portswigger.net/research/dom-based-angularjs-sandbox-escapes>

**React**
- CVE-2025-55182 "React2Shell" (RSC deserialization RCE): <https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components>, <https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182>
- CVE-2025-55184 / DoS + source exposure: <https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components>

**Vue**
- CVE-2024-6783 — XSS via prototype pollution (`staticClass`/`staticStyle`): <https://www.cve.news/cve-2024-6783/>
- vue-i18n CVE-2025-27597 — prototype pollution: <https://github.com/intlify/vue-i18n/security/advisories/GHSA-9r9m-ffp6-9x4v>

**Svelte / SvelteKit**
- CVE-2026-27121 — SSR spread-attribute XSS (event handlers): <https://github.com/sveltejs/svelte/security/advisories/GHSA-f7gr-6p89-r883>
- CVE-2026-27122 — `<svelte:element this={tag}>` tag injection: <https://www.sentinelone.com/vulnerability-database/cve-2026-27122/>
- SvelteKit CVE-2025-32388 — XSS via tracked `searchParams`: <https://github.com/advisories/GHSA-6q87-84jw-cjhp>
- SvelteKit CVE-2026-22803 / adapter-node — Host-header SSRF, and devalue DoS: <https://svelte.dev/blog/cves-affecting-the-svelte-ecosystem>

**Solid**
- CVE-2025-27109 — XSS via unescaped JSX fragments on SSR: <https://github.com/solidjs/solid/security/advisories/GHSA-3qxh-p7jc-5xh6>
- SolidJS security guide (attribute escaping / innerHTML): <https://docs.solidjs.com/solid-start/guides/security>
