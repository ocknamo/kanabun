import { describe, expect, test } from "bun:test";
import { parsePath, matchPath } from "../src/index";

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
