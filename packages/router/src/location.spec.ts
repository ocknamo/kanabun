import { describe, expect, test } from "bun:test";
import { parsePath, matchPath, matchRoute, resolvePath } from "./index";

describe("parsePath", () => {
  test("splits pathname, search, hash and query", () => {
    const loc = parsePath("/users/42?tab=posts&page=2#bio");
    expect(loc.pathname).toBe("/users/42");
    expect(loc.search).toBe("?tab=posts&page=2");
    expect(loc.hash).toBe("#bio");
    expect(loc.query).toEqual({ tab: "posts", page: "2" });
  });

  test("empty search/hash and empty query for a bare path", () => {
    const loc = parsePath("/");
    expect(loc.pathname).toBe("/");
    expect(loc.search).toBe("");
    expect(loc.hash).toBe("");
    expect(loc.query).toEqual({});
  });
});

describe("matchPath", () => {
  test("matches a static path exactly", () => {
    expect(matchPath("/about", "/about")).toEqual({});
    expect(matchPath("/about", "/about/")).toEqual({}); // trailing slash ignored
  });

  test("rejects a different static path", () => {
    expect(matchPath("/about", "/contact")).toBeNull();
  });

  test("rejects when the path is longer than a static pattern", () => {
    expect(matchPath("/about", "/about/team")).toBeNull();
  });

  test("rejects when the path is shorter than the pattern", () => {
    expect(matchPath("/users/:id", "/users")).toBeNull();
  });

  test("captures a single param", () => {
    expect(matchPath("/users/:id", "/users/42")).toEqual({ id: "42" });
  });

  test("captures multiple params", () => {
    expect(matchPath("/users/:id/posts/:postId", "/users/7/posts/99")).toEqual({
      id: "7",
      postId: "99",
    });
  });

  test("URI-decodes param values", () => {
    expect(matchPath("/q/:term", "/q/hello%20world")).toEqual({ term: "hello world" });
  });

  test("a malformed percent-escape falls back to the raw segment (never throws)", () => {
    // External input could be malformed; matching must not crash.
    expect(matchPath("/q/:term", "/q/%E0%A4%A")).toEqual({ term: "%E0%A4%A" });
    expect(matchPath("/files/*rest", "/files/%C0%80/x")).toEqual({ rest: "%C0%80/x" });
  });

  test("named wildcard captures the remainder", () => {
    expect(matchPath("/files/*rest", "/files/a/b/c.txt")).toEqual({ rest: "a/b/c.txt" });
  });

  test("bare wildcard matches without capturing", () => {
    expect(matchPath("/files/*", "/files/a/b")).toEqual({});
  });

  test("wildcard matches an empty remainder", () => {
    expect(matchPath("/files/*rest", "/files")).toEqual({ rest: "" });
  });

  test("the root pattern matches the root path", () => {
    expect(matchPath("/", "/")).toEqual({});
    expect(matchPath("/", "/about")).toBeNull();
  });
});

describe("matchRoute", () => {
  test("an exact match leaves no rest", () => {
    expect(matchRoute("/users/:id", "/users/42")).toEqual({
      params: { id: "42" },
      rest: null,
    });
  });

  test("a non-match returns null", () => {
    expect(matchRoute("/about", "/contact")).toBeNull();
  });

  test("a prefix (wildcard) match exposes the leftover path raw", () => {
    expect(matchRoute("/users/*", "/users/42/posts")).toEqual({
      params: {},
      rest: "/42/posts",
    });
  });

  test("a prefix that consumes everything leaves rest = '/'", () => {
    expect(matchRoute("/users/*", "/users")).toEqual({ params: {}, rest: "/" });
  });

  test("rest is left undecoded so nested routes decode their own params", () => {
    // The named capture is decoded; `rest` keeps the raw segments.
    expect(matchRoute("/files/*rest", "/files/a%20b/c")).toEqual({
      params: { rest: "a b/c" },
      rest: "/a%20b/c",
    });
  });
});

describe("resolvePath", () => {
  test("an absolute path is returned unchanged", () => {
    expect(resolvePath("/about", "/users/42")).toBe("/about");
    expect(resolvePath("/", "/users/42")).toBe("/");
  });

  test("a bare relative path replaces the last segment", () => {
    expect(resolvePath("edit", "/users/42")).toBe("/users/edit");
    expect(resolvePath("./edit", "/users/42")).toBe("/users/edit");
  });

  test("a trailing slash in the base keeps the relative path nested", () => {
    expect(resolvePath("edit", "/users/42/")).toBe("/users/42/edit");
  });

  test("`..` climbs one level per segment", () => {
    expect(resolvePath("../list", "/users/42")).toBe("/list");
    expect(resolvePath("../../x", "/a/b/c")).toBe("/x");
  });

  test("a query- or hash-only target keeps the current path", () => {
    expect(resolvePath("?tab=bio", "/users/42")).toBe("/users/42?tab=bio");
    expect(resolvePath("#top", "/users/42")).toBe("/users/42#top");
  });

  test("preserves the target's own query and hash", () => {
    expect(resolvePath("/search?q=hi#r", "/users/42")).toBe("/search?q=hi#r");
  });

  test("tolerates a base without a leading slash", () => {
    expect(resolvePath("edit", "users/42")).toBe("/users/edit");
  });
});
