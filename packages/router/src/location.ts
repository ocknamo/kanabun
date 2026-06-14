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

/**
 * Match `pathname` against a route `pattern`, returning the captured params or
 * `null` if it doesn't match. Supported pattern syntax:
 *
 *   - **static**   `/about`          — exact segment
 *   - **param**    `/users/:id`      — captures one segment into `params.id`
 *   - **wildcard** `/files/*rest`    — captures the remainder (may be empty)
 *                  `/files/*`        — matches the remainder without capturing
 *
 * Matching is exact (every segment consumed) unless a wildcard absorbs the tail.
 * Trailing slashes are ignored. Param and wildcard values are URI-decoded.
 */
export function matchPath(pattern: string, pathname: string): RouteParams | null {
  const patternSegs = segments(pattern);
  const pathSegs = segments(pathname);
  const params: RouteParams = {};

  for (let i = 0; i < patternSegs.length; i++) {
    const seg = patternSegs[i]!;
    if (seg[0] === "*") {
      const name = seg.slice(1);
      if (name !== "") {
        params[name] = pathSegs.slice(i).map(decodeURIComponent).join("/");
      }
      return params; // a wildcard absorbs everything left (possibly nothing)
    }
    const part = pathSegs[i];
    if (part === undefined) return null; // path is shorter than the pattern
    if (seg[0] === ":") {
      params[seg.slice(1)] = decodeURIComponent(part);
    } else if (seg !== part) {
      return null; // a static segment didn't match
    }
  }

  // No wildcard: the path must have exactly as many segments as the pattern.
  return pathSegs.length === patternSegs.length ? params : null;
}
