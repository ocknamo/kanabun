import { describe, expect, test } from "bun:test";
import { defaultDocument, type DocumentContext } from "./document";

describe("defaultDocument", () => {
  const ctx: DocumentContext = {
    html: "<p>body</p>",
    head: '<style data-k="x">.a{}</style>',
    path: "/about/",
    script: '<script type="module" src="/main.js"></script>',
    base: "/",
  };

  test("wraps the markup in a full page with title, head, and script", () => {
    const page = defaultDocument(ctx, "my title");
    expect(page).toContain("<!doctype html>");
    expect(page).toContain("<title>my title</title>");
    expect(page).toContain('<meta name="viewport"');
    expect(page).toContain('<style data-k="x">');
    expect(page).toContain('<div id="app"><p>body</p></div>');
    expect(page).toContain('src="/main.js"');
  });

  test("omitting the script leaves a static-only page", () => {
    const page = defaultDocument({ ...ctx, script: "" }, "t");
    expect(page).not.toContain("<script");
  });
});
