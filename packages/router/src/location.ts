/**
 * kanabun/router — path parsing & matching
 * ------------------------------------------------------------------
 * Pure functions, no DOM and no runtime dependencies (only the standard
 * `URL` global, available in every browser and in Bun). They are the
 * testable heart of the router: everything reactive is built on top.
 */

/** Captured route parameters, e.g. `{ id: "42" }` for `/users/:id`. */
export type RouteParams = Record<string, string>;

/** The current location, parsed into its parts (à la `window.location`). */
export interface RouterLocation {
  /** Path without query/hash, e.g. `/users/42`. */
  pathname: string;
  /** Query string including the leading `?` (or `""`). */
  search: string;
  /** Fragment including the leading `#` (or `""`). */
  hash: string;
  /** Parsed query parameters (last value wins for repeats). */
  query: RouteParams;
}

// A throwaway base — we only ever store/resolve *relative* paths, so the
// origin is irrelevant; `URL` just needs *some* base to parse against.
const BASE = "http://kanabun.local";

/** Parse a raw path string (`/a/b?x=1#h`) into its {@link RouterLocation} parts. */
export function parsePath(raw: string): RouterLocation {
  const url = new URL(raw, BASE);
  const query: RouteParams = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { pathname: url.pathname, search: url.search, hash: url.hash, query };
}

/** Split a path into its non-empty segments (so trailing slashes don't matter). */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split("/")) if (part !== "") out.push(part);
  return out;
}

// URLs are external input (links, the address bar, deep links), so a malformed
// percent-escape must not crash matching — fall back to the raw segment.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The result of matching a route pattern against a path. */
export interface RouteMatch {
  /** Captured params (`:name` segments and a trailing `*name` wildcard). */
  params: RouteParams;
  /**
   * For a **prefix** match — a pattern ending in a `*` wildcard — the leftover
   * path the wildcard absorbed (always leading-slashed, `"/"` when empty), kept
   * *raw* (undecoded) so a **nested** router can match against it and decode its
   * own params. `null` for an exact (non-wildcard) match, which leaves nothing.
   */
  rest: string | null;
}

/**
 * Match `pathname` against a route `pattern`, returning the {@link RouteMatch}
 * (captured params + any unmatched `rest`) or `null` if it doesn't match.
 * Supported pattern syntax:
 *
 *   - **static**   `/about`          — exact segment
 *   - **param**    `/users/:id`      — captures one segment into `params.id`
 *   - **wildcard** `/files/*rest`    — captures the remainder (may be empty)
 *                  `/files/*`        — matches the remainder without capturing
 *
 * Matching is exact (every segment consumed) unless a wildcard absorbs the tail.
 * A wildcard pattern is a **prefix** match: `rest` carries the leftover path so
 * nested routes can match relative to it. Trailing slashes are ignored; param
 * and wildcard values are URI-decoded (but `rest` is not — see {@link RouteMatch}).
 */
export function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  const patternSegs = segments(pattern);
  const pathSegs = segments(pathname);
  const params: RouteParams = {};

  for (let i = 0; i < patternSegs.length; i++) {
    const seg = patternSegs[i]!;
    if (seg[0] === "*") {
      const name = seg.slice(1);
      const restSegs = pathSegs.slice(i);
      if (name !== "") {
        params[name] = restSegs.map(safeDecode).join("/");
      }
      // A wildcard absorbs everything left (possibly nothing); expose it raw as
      // `rest` so a nested router can keep matching from here.
      return { params, rest: "/" + restSegs.join("/") };
    }
    const part = pathSegs[i];
    if (part === undefined) return null; // path is shorter than the pattern
    if (seg[0] === ":") {
      params[seg.slice(1)] = safeDecode(part);
    } else if (seg !== part) {
      return null; // a static segment didn't match
    }
  }

  // No wildcard: the path must have exactly as many segments as the pattern.
  return pathSegs.length === patternSegs.length ? { params, rest: null } : null;
}

/**
 * Match `pathname` against `pattern`, returning just the captured params (or
 * `null`). A thin wrapper over {@link matchRoute} for callers that don't care
 * about the unmatched `rest`.
 */
export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const match = matchRoute(pattern, pathname);
  return match === null ? null : match.params;
}
