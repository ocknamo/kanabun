import { describe, expect, test } from "bun:test";
import { sep } from "node:path";
import { normalizeBase, resolveWithin } from "./paths";

describe("normalizeBase", () => {
  test("normalizes to a single leading and trailing slash", () => {
    expect(normalizeBase("/")).toBe("/");
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("repo")).toBe("/repo/");
    expect(normalizeBase("//repo///")).toBe("/repo/");
    expect(normalizeBase("/a/b/")).toBe("/a/b/");
  });
});

describe("resolveWithin", () => {
  const root = `${sep}srv${sep}site`;

  test("joins a contained path under the root", () => {
    expect(resolveWithin(root, "/index.html")).toBe(`${root}${sep}index.html`);
    expect(resolveWithin(root, "/a/b.js")).toBe(`${root}${sep}a${sep}b.js`);
  });

  test("the root itself is contained (join keeps the trailing separator)", () => {
    expect(resolveWithin(root, "/")).toBe(`${root}${sep}`);
  });

  test("rejects a path that escapes the root", () => {
    expect(resolveWithin(root, "/../evil")).toBeUndefined();
    expect(resolveWithin(root, "/a/../../evil")).toBeUndefined();
  });
});
