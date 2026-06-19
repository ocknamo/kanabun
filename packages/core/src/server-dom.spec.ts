import { describe, expect, test } from "bun:test";
import { ServerDocument, ServerNode, serialize } from "./server-dom";

describe("ServerDocument factories", () => {
  test("createElement / createTextNode / createComment carry node types", () => {
    const d = new ServerDocument();
    expect(d.createElement("div").nodeType).toBe(1);
    expect(d.createElement("DIV").tagName).toBe("DIV");
    const t = d.createTextNode("hi");
    expect(t.nodeType).toBe(3);
    expect(t.data).toBe("hi");
    const c = d.createComment("x");
    expect(c.nodeType).toBe(8);
    expect(c.data).toBe("x");
  });

  test("head is an element named HEAD", () => {
    const d = new ServerDocument();
    expect(d.head.nodeType).toBe(1);
    expect(d.head.tagName).toBe("HEAD");
  });

  test("createElement accepts valid tag names (plain/custom/namespaced)", () => {
    const d = new ServerDocument();
    for (const tag of ["div", "my-widget", "svg:path", "h1", "x.y", "x_y"]) {
      expect(() => d.createElement(tag)).not.toThrow();
    }
  });

  test("createElement rejects invalid tag names (real-DOM fail-safe, no SSR injection)", () => {
    const d = new ServerDocument();
    // S6 PoC: an untrusted element type that closes the tag and injects markup.
    expect(() => d.createElement("img src=x onerror=alert(1)")).toThrow(
      "InvalidCharacterError",
    );
    expect(() => d.createElement("a>b")).toThrow("InvalidCharacterError");
    expect(() => d.createElement("1abc")).toThrow("InvalidCharacterError");
    expect(() => d.createElement("")).toThrow("InvalidCharacterError");
  });
});

describe("tree mutation", () => {
  test("appendChild / insertBefore / removeChild and sibling links", () => {
    const d = new ServerDocument();
    const ul = d.createElement("ul");
    const a = d.createElement("li");
    const b = d.createElement("li");
    ul.appendChild(a);
    ul.insertBefore(b, a); // b before a
    expect(ul.childNodes).toEqual([b, a]);
    expect(ul.firstChild).toBe(b);
    expect(b.nextSibling).toBe(a);
    expect(a.nextSibling).toBeNull();
    ul.removeChild(b);
    expect(ul.childNodes).toEqual([a]);
    expect(a.parentNode).toBe(ul);
  });

  test("re-parenting detaches from the previous parent", () => {
    const d = new ServerDocument();
    const p1 = d.createElement("div");
    const p2 = d.createElement("div");
    const child = d.createElement("span");
    p1.appendChild(child);
    p2.appendChild(child);
    expect(p1.childNodes).toEqual([]);
    expect(p2.childNodes).toEqual([child]);
  });

  test("nextSibling of a detached node is null", () => {
    const n = new ServerNode(1);
    expect(n.nextSibling).toBeNull();
  });

  test("insertBefore with a non-child reference throws", () => {
    const d = new ServerDocument();
    const parent = d.createElement("div");
    const stranger = d.createElement("div");
    expect(() => parent.insertBefore(d.createElement("p"), stranger)).toThrow(
      "reference node is not a child",
    );
  });

  test("removeChild of a non-child throws", () => {
    const d = new ServerDocument();
    const parent = d.createElement("div");
    expect(() => parent.removeChild(d.createElement("p"))).toThrow(
      "node is not a child",
    );
  });
});

describe("attributes & properties", () => {
  test("set / get / remove attribute", () => {
    const el = new ServerNode(1);
    el.tagName = "A";
    el.setAttribute("href", "/x");
    expect(el.getAttribute("href")).toBe("/x");
    expect(el.getAttribute("missing")).toBeNull();
    el.removeAttribute("href");
    expect(el.getAttribute("href")).toBeNull();
  });

  test("setAttribute accepts valid names (data-/aria-/namespaced/dotted)", () => {
    const el = new ServerNode(1);
    el.tagName = "DIV";
    for (const name of ["data-k", "aria-label", "xlink:href", "x.y", "_x", ":x"]) {
      expect(() => el.setAttribute(name, "v")).not.toThrow();
      expect(el.getAttribute(name)).toBe("v");
    }
  });

  test("setAttribute rejects invalid names (real-DOM fail-safe, no SSR injection)", () => {
    const el = new ServerNode(1);
    el.tagName = "DIV";
    // The spread-prop attribute-name injection PoC: a key that closes the tag.
    expect(() => el.setAttribute("x><img src=x onerror=alert(1)", "y")).toThrow(
      "InvalidCharacterError",
    );
    expect(() => el.setAttribute("a b", "y")).toThrow("InvalidCharacterError");
    expect(() => el.setAttribute("1abc", "y")).toThrow("InvalidCharacterError");
    expect(() => el.setAttribute("", "y")).toThrow("InvalidCharacterError");
    // The injected name never reaches serialization.
    expect(serialize(el)).toBe("<div></div>");
  });

  test("value / checked / selected reflect into attributes", () => {
    const el = new ServerNode(1);
    el.tagName = "INPUT";
    (el as unknown as { value: unknown }).value = 42;
    (el as unknown as { checked: unknown }).checked = true;
    expect(el.getAttribute("value")).toBe("42");
    expect(el.getAttribute("checked")).toBe("");
    (el as unknown as { checked: unknown }).checked = false;
    expect(el.getAttribute("checked")).toBeNull();
    (el as unknown as { selected: unknown }).selected = true;
    expect(el.getAttribute("selected")).toBe("");
    (el as unknown as { selected: unknown }).selected = false;
    expect(el.getAttribute("selected")).toBeNull();
  });

  test("addEventListener is a no-op (does not throw or serialize)", () => {
    const el = new ServerNode(1);
    el.tagName = "BUTTON";
    expect(() => el.addEventListener()).not.toThrow();
    expect(serialize(el)).toBe("<button></button>");
  });
});

describe("textContent", () => {
  test("element textContent reads/sets a single text child", () => {
    const d = new ServerDocument();
    const el = d.createElement("p");
    el.appendChild(d.createTextNode("a"));
    el.appendChild(d.createTextNode("b"));
    expect(el.textContent).toBe("ab");
    el.textContent = "x";
    expect(el.childNodes.length).toBe(1);
    expect(el.textContent).toBe("x");
    el.textContent = "";
    expect(el.childNodes.length).toBe(0);
  });

  test("text-node textContent is its data", () => {
    const t = new ServerNode(3);
    t.textContent = "hi";
    expect(t.textContent).toBe("hi");
    expect(t.data).toBe("hi");
  });
});

describe("serialize", () => {
  test("escapes text and attribute values", () => {
    const d = new ServerDocument();
    const el = d.createElement("div");
    el.setAttribute("title", `a"b<c>&`);
    el.appendChild(d.createTextNode("<x> & </x>"));
    expect(serialize(el)).toBe(
      '<div title="a&quot;b&lt;c&gt;&amp;">&lt;x&gt; &amp; &lt;/x&gt;</div>',
    );
  });

  test("void elements have no closing tag", () => {
    const d = new ServerDocument();
    const br = d.createElement("br");
    expect(serialize(br)).toBe("<br>");
    const img = d.createElement("img");
    img.setAttribute("src", "/a.png");
    expect(serialize(img)).toBe('<img src="/a.png">');
  });

  test("style declarations serialize to a style attribute", () => {
    const d = new ServerDocument();
    const el = d.createElement("div");
    el.style.setProperty("color", "red");
    el.style.setProperty("margin", "0");
    expect(serialize(el)).toBe('<div style="color: red; margin: 0;"></div>');
  });

  test("an explicit style attribute wins over the style bag", () => {
    const d = new ServerDocument();
    const el = d.createElement("div");
    el.style.setProperty("color", "red");
    el.setAttribute("style", "color: blue");
    expect(serialize(el)).toBe('<div style="color: blue"></div>');
  });

  test("style/script bodies are raw (not HTML-escaped); non-text ignored", () => {
    const d = new ServerDocument();
    const style = d.createElement("style");
    style.textContent = ".a > .b { content: '&' }";
    style.appendChild(d.createElement("span")); // ignored in rawtext
    expect(serialize(style)).toBe("<style>.a > .b { content: '&' }</style>");
  });

  test("raw-text bodies cannot break out of <style>/<script> (SSR XSS sink)", () => {
    const d = new ServerDocument();
    // S2 PoC: untrusted value interpolated into the `css` helper output.
    const style = d.createElement("style");
    style.textContent = ".k{}</style><img src=x onerror=alert(1)>";
    const styleOut = serialize(style);
    expect(styleOut).not.toContain("</style><img");
    expect(styleOut).toBe(
      "<style>.k{}<\\/style><img src=x onerror=alert(1)></style>",
    );

    // S7 PoC (shared raw-text sink): untrusted text as a <script> child.
    const script = d.createElement("script");
    script.textContent = "0;</script><img src=x onerror=alert(1)>";
    const scriptOut = serialize(script);
    expect(scriptOut).not.toContain("</script><img");
    expect(scriptOut).toBe(
      "<script>0;<\\/script><img src=x onerror=alert(1)></script>",
    );

    // Case-insensitive: the parser closes on `</STYLE` too.
    const upper = d.createElement("style");
    upper.textContent = "a</STYLE>b";
    expect(serialize(upper)).toBe("<style>a<\\/STYLE>b</style>");
  });

  test("comment node", () => {
    const d = new ServerDocument();
    expect(serialize(d.createComment(""))).toBe("<!---->");
    expect(serialize(d.createComment("hi"))).toBe("<!--hi-->");
  });
});
