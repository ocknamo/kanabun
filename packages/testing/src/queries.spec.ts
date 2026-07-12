import { describe, expect, test } from "bun:test";
import { MockDocument, type MockNode } from "./dom-mock";
import {
  childById,
  childByTag,
  elements,
  hasClass,
  queryAllByClass,
  queryAllByTag,
  queryByClass,
  queryById,
  queryByTag,
  walk,
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
