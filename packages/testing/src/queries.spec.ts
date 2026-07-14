import { describe, expect, test } from "bun:test";
import { MockDocument, type MockNode } from "./dom-mock";
import {
  childById,
  childByTag,
  elements,
  getByClass,
  getById,
  getByTag,
  getByText,
  hasClass,
  queryAllByClass,
  queryAllById,
  queryAllByTag,
  queryAllByText,
  queryByClass,
  queryById,
  queryByTag,
  queryByText,
  walk,
  within,
} from "./queries";

/**
 * One hand-built tree shared by every case:
 *
 *   <div>            (root)
 *     "text"
 *     <span class="a b" id="outer">
 *       <span class="b" id="inner">   ← nested same tag: childByTag must NOT see it
 *     <p>
 */
function tree(): {
  root: MockNode;
  outer: MockNode;
  inner: MockNode;
  p: MockNode;
} {
  const doc = new MockDocument();
  const root = doc.createElement("div");
  root.appendChild(doc.createTextNode("text"));
  const outer = doc.createElement("span");
  outer.setAttribute("class", "a b");
  outer.setAttribute("id", "outer");
  const inner = doc.createElement("span");
  inner.setAttribute("class", "b");
  inner.setAttribute("id", "inner");
  outer.appendChild(inner);
  root.appendChild(outer);
  const p = doc.createElement("p");
  root.appendChild(p);
  return { root, outer, inner, p };
}

describe("walk / elements", () => {
  test("walk collects every node in document order; elements filters to elements", () => {
    const { root, outer, inner, p } = tree();
    expect(walk(root)).toHaveLength(5); // root, text, outer, inner, p
    expect(elements(root)).toEqual([root, outer, inner, p]);
  });
});

describe("childByTag vs queryByTag", () => {
  test("childByTag looks at direct children only", () => {
    const { root, outer } = tree();
    expect(childByTag(root, "span")).toBe(outer);
    expect(childByTag(root, "b")).toBeUndefined(); // nested tags invisible
  });

  test("queryByTag descends the subtree", () => {
    const { root, outer, inner } = tree();
    expect(queryByTag(root, "span")).toBe(outer);
    expect(queryByTag(outer, "span")).toBe(outer); // includes the root itself
    expect(queryByTag(inner, "p")).toBeUndefined();
  });

  test("queryAllByTag returns every match in document order", () => {
    const { root, outer, inner } = tree();
    expect(queryAllByTag(root, "span")).toEqual([outer, inner]);
    expect(queryAllByTag(root, "ul")).toEqual([]);
  });
});

describe("childById vs queryById", () => {
  test("childById looks at direct children only", () => {
    const { root, outer } = tree();
    expect(childById(root, "outer")).toBe(outer);
    expect(childById(root, "inner")).toBeUndefined(); // nested ids invisible
  });

  test("queryById descends the subtree", () => {
    const { root, inner } = tree();
    expect(queryById(root, "inner")).toBe(inner);
    expect(queryById(root, "missing")).toBeUndefined();
  });

  test("queryAllById returns every match (the mock allows duplicate ids)", () => {
    const { root, outer } = tree();
    expect(queryAllById(root, "outer")).toEqual([outer]);
    expect(queryAllById(root, "missing")).toEqual([]);
  });
});

describe("text queries", () => {
  //   <p> "Hello " <b> "world"
  function textTree(): { p: MockNode; b: MockNode } {
    const doc = new MockDocument();
    const p = doc.createElement("p");
    p.appendChild(doc.createTextNode("Hello "));
    const b = doc.createElement("b");
    b.appendChild(doc.createTextNode("world"));
    p.appendChild(b);
    return { p, b };
  }

  test("queryByText matches an element's own text — the innermost element wins", () => {
    const { p, b } = textTree();
    expect(queryByText(p, "world")).toBe(b);
    expect(queryByText(p, "Hello ")).toBe(p); // own text excludes <b>
    // textContent ("Hello world") is NOT the match target — no element owns it.
    expect(queryByText(p, "Hello world")).toBeUndefined();
  });

  test("queryByText accepts a RegExp", () => {
    const { p, b } = textTree();
    expect(queryByText(p, /^wor/)).toBe(b);
    expect(queryByText(p, /^nope/)).toBeUndefined();
  });

  test("queryAllByText returns every own-text match in document order", () => {
    const { p, b } = textTree();
    // Both "Hello " and "world" contain an 'o'; p comes first (document order).
    expect(queryAllByText(p, /o/)).toEqual([p, b]);
    expect(queryAllByText(p, "world")).toEqual([b]);
    expect(queryAllByText(p, "nope")).toEqual([]);
  });
});

describe("getBy* (the single-match throwing tier)", () => {
  test("return the sole match", () => {
    const { root, outer, inner, p } = tree();
    expect(getByTag(root, "p")).toBe(p);
    expect(getByClass(root, "a")).toBe(outer);
    expect(getById(root, "inner")).toBe(inner);
    expect(getByText(root, "text")).toBe(root);
  });

  test("a miss throws, naming what was sought", () => {
    const { root } = tree();
    expect(() => getByTag(root, "ul")).toThrow("Unable to find a <ul> element");
    expect(() => getByClass(root, "nope")).toThrow('an element with class "nope"');
    expect(() => getById(root, "nope")).toThrow('an element with id "nope"');
    expect(() => getByText(root, "nope")).toThrow('an element with text "nope"');
    expect(() => getByText(root, /nope/)).toThrow(
      "an element with text matching /nope/",
    );
  });

  test("multiple matches throw, naming the count (unlike a first-match query)", () => {
    const { root } = tree();
    // Two <span>s and two elements carrying class "b" (outer + inner).
    expect(() => getByTag(root, "span")).toThrow(
      "Found 2 matches for a <span> element (expected exactly one)",
    );
    expect(() => getByClass(root, "b")).toThrow("Found 2 matches");
  });

  test("the error carries the serialized tree", () => {
    const { root } = tree();
    expect(() => getByTag(root, "ul")).toThrow(
      'in:\n<div>text<span class="a b" id="outer">',
    );
  });
});

describe("within", () => {
  test("binds every query to the root", () => {
    const { root, outer, inner, p } = tree();
    const q = within(root);
    expect(q.getByTag("p")).toBe(p);
    expect(q.getByClass("a")).toBe(outer);
    expect(q.getById("inner")).toBe(inner);
    expect(q.getByText("text")).toBe(root);
    expect(q.queryByTag("ul")).toBeUndefined();
    expect(q.queryAllByTag("span")).toEqual([outer, inner]);
    expect(q.queryByClass("b")).toBe(outer);
    expect(q.queryAllByClass("b")).toEqual([outer, inner]);
    expect(q.queryById("missing")).toBeUndefined();
    expect(q.queryAllById("inner")).toEqual([inner]);
    expect(q.queryByText(/tex/)).toBe(root);
    expect(q.queryAllByText("text")).toEqual([root]);
  });
});

describe("class queries", () => {
  test("hasClass splits the class attribute; a missing attribute is false", () => {
    const { outer, p } = tree();
    expect(hasClass(outer, "a")).toBe(true);
    expect(hasClass(outer, "b")).toBe(true);
    expect(hasClass(outer, "ab")).toBe(false);
    expect(hasClass(p, "a")).toBe(false);
  });

  test("queryByClass / queryAllByClass search the subtree", () => {
    const { root, outer, inner } = tree();
    expect(queryByClass(root, "a")).toBe(outer);
    expect(queryByClass(root, "missing")).toBeUndefined();
    expect(queryAllByClass(root, "b")).toEqual([outer, inner]);
    expect(queryAllByClass(root, "missing")).toEqual([]);
  });
});
