import { describe, expect, test } from "bun:test";
import {
  MockDocument,
  MockEvent,
  asEl,
  asMock,
  asNode,
  createContainer,
  docBody,
  docHead,
  installDOM,
  serialize,
} from "./dom-mock";

describe("MockEvent", () => {
  test("preventDefault flips defaultPrevented", () => {
    const event = new MockEvent("click");
    expect(event.type).toBe("click");
    expect(event.defaultPrevented).toBe(false);
    event.preventDefault();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("MockNode style", () => {
  test("setProperty / getPropertyValue / cssText round-trip", () => {
    const el = createContainer();
    el.style.setProperty("color", "red");
    el.style.setProperty("width", "1px");
    expect(el.style.getPropertyValue("color")).toBe("red");
    expect(el.style.cssText).toBe("color: red; width: 1px;");
  });

  test("an empty value deletes the property; a miss reads as empty", () => {
    const el = createContainer();
    el.style.setProperty("color", "red");
    el.style.setProperty("color", "");
    expect(el.style.getPropertyValue("color")).toBe("");
    expect(el.style.cssText).toBe("");
  });
});

describe("MockNode tree", () => {
  test("firstChild and nextSibling walk siblings; misses are null", () => {
    const parent = createContainer();
    const a = createContainer("span");
    const b = createContainer("b");
    expect(parent.firstChild).toBeNull();
    parent.appendChild(a);
    parent.appendChild(b);
    expect(parent.firstChild).toBe(a);
    expect(a.nextSibling).toBe(b);
    expect(b.nextSibling).toBeNull();
    expect(parent.nextSibling).toBeNull(); // no parent
  });

  test("insertBefore places before the reference and reparents", () => {
    const parent = createContainer();
    const other = createContainer();
    const a = createContainer("span");
    const b = createContainer("b");
    other.appendChild(a); // a starts elsewhere
    parent.appendChild(b);
    parent.insertBefore(a, b); // moves a out of `other`
    expect(other.childNodes).toHaveLength(0);
    expect(parent.childNodes).toEqual([a, b]);
    expect(a.parentNode).toBe(parent);
  });

  test("insertBefore throws when the reference is not a child", () => {
    const parent = createContainer();
    expect(() => parent.insertBefore(createContainer(), createContainer())).toThrow(
      "insertBefore: reference node is not a child",
    );
  });

  test("removeChild detaches; removing a non-child throws", () => {
    const parent = createContainer();
    const child = createContainer("span");
    parent.appendChild(child);
    expect(parent.removeChild(child)).toBe(child);
    expect(child.parentNode).toBeNull();
    expect(() => parent.removeChild(child)).toThrow("removeChild: node is not a child");
  });
});

describe("MockNode attributes", () => {
  test("set / get / has / remove; a miss reads as null", () => {
    const el = createContainer();
    expect(el.getAttribute("id")).toBeNull();
    el.setAttribute("id", "x");
    expect(el.getAttribute("id")).toBe("x");
    expect(el.hasAttribute("id")).toBe(true);
    el.removeAttribute("id");
    expect(el.hasAttribute("id")).toBe(false);
  });
});

describe("MockNode events", () => {
  test("dispatch reaches every listener with init merged and target set", () => {
    const el = createContainer();
    const seen: MockEvent[] = [];
    const listener = (e: MockEvent) => seen.push(e);
    el.addEventListener("keydown", listener);
    el.addEventListener("keydown", listener); // re-adding is a no-op (Set)
    el.addEventListener("keydown", (e) => seen.push(e));
    const event = el.dispatch("keydown", { key: "Enter" });
    expect(seen).toHaveLength(2);
    expect(event.target).toBe(el);
    expect((event as MockEvent & { key?: string }).key).toBe("Enter");
  });

  test("dispatch with no listeners and no init still returns the event", () => {
    const el = createContainer();
    const event = el.dispatch("click");
    expect(event.type).toBe("click");
    expect(event.target).toBe(el);
  });
});

describe("MockNode textContent", () => {
  test("getter joins descendants; on a text node it is the data", () => {
    const doc = new MockDocument();
    const el = doc.createElement("p");
    el.appendChild(doc.createTextNode("a"));
    const inner = doc.createElement("b");
    inner.appendChild(doc.createTextNode("b"));
    el.appendChild(inner);
    expect(el.textContent).toBe("ab");
    expect(doc.createTextNode("t").textContent).toBe("t");
  });

  test("setter replaces children; empty string leaves none; text nodes set data", () => {
    const doc = new MockDocument();
    const el = doc.createElement("p");
    const old = doc.createTextNode("old");
    el.appendChild(old);
    el.textContent = "new";
    expect(old.parentNode).toBeNull();
    expect(el.childNodes).toHaveLength(1);
    expect(el.textContent).toBe("new");
    el.textContent = "";
    expect(el.childNodes).toHaveLength(0);
    const text = doc.createTextNode("x");
    text.textContent = "y";
    expect(text.data).toBe("y");
  });
});

describe("querySelectorAll", () => {
  test("matches attribute presence across the subtree, skipping non-elements", () => {
    const doc = new MockDocument();
    const root = doc.createElement("div");
    root.appendChild(doc.createTextNode("text"));
    const hit = doc.createElement("div");
    hit.setAttribute("data-island", "a");
    const nestedHit = doc.createElement("span");
    nestedHit.setAttribute("data-island", "b");
    hit.appendChild(nestedHit);
    root.appendChild(hit);
    expect(root.querySelectorAll("[data-island]")).toEqual([hit, nestedHit]);
  });

  test("throws on an unsupported selector", () => {
    expect(() => createContainer().querySelectorAll("div")).toThrow(
      'unsupported selector "div"',
    );
  });

  test("the document searches head and body", () => {
    const doc = new MockDocument();
    const inHead = doc.createElement("style");
    inHead.setAttribute("data-x", "");
    doc.head.appendChild(inHead);
    const inBody = doc.createElement("div");
    inBody.setAttribute("data-x", "");
    doc.body.appendChild(inBody);
    expect(doc.querySelectorAll("[data-x]")).toEqual([inHead, inBody]);
  });
});

describe("MockDocument factories", () => {
  test("createElement upper-cases; text and comment nodes carry data", () => {
    const doc = new MockDocument();
    expect(doc.createElement("div").tagName).toBe("DIV");
    expect(doc.createTextNode("t").nodeType).toBe(3);
    const comment = doc.createComment("c");
    expect(comment.nodeType).toBe(8);
    expect(comment.data).toBe("c");
    expect(doc.head.tagName).toBe("HEAD");
    expect(doc.body.tagName).toBe("BODY");
  });
});

describe("serialize", () => {
  test("renders tags with attributes, text, and omits comments", () => {
    const doc = new MockDocument();
    const el = doc.createElement("div");
    el.setAttribute("class", "a");
    el.appendChild(doc.createTextNode("hi"));
    el.appendChild(doc.createComment("gone"));
    expect(serialize(el)).toBe('<div class="a">hi</div>');
  });
});

describe("installDOM", () => {
  test("installs a fresh document and the teardown restores the previous one", () => {
    const g = globalThis as { document?: unknown };
    const before = g.document;
    const teardown = installDOM();
    expect(g.document).toBeInstanceOf(MockDocument);
    const inner = installDOM(); // defined-before case
    expect(g.document).not.toBe(before);
    inner();
    teardown();
    expect(g.document).toBe(before);
  });
});

describe("docHead / docBody", () => {
  test("return the installed document's head and body", () => {
    const teardown = installDOM();
    const doc = (globalThis as unknown as { document: MockDocument }).document;
    expect(docHead()).toBe(doc.head);
    expect(docBody()).toBe(doc.body);
    teardown();
  });

  test("throw a pointer at installDOM when no document is installed", () => {
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    delete g.document;
    try {
      expect(() => docHead()).toThrow("no `document` installed");
      expect(() => docBody()).toThrow("no `document` installed");
    } finally {
      if (prev !== undefined) g.document = prev;
    }
  });
});

describe("casts", () => {
  test("asEl / asNode / asMock are identity casts", () => {
    const node = createContainer();
    expect(asEl(node)).toBe(node as unknown as Element);
    expect(asNode(node)).toBe(node as unknown as Node);
    expect(asMock(node as unknown)).toBe(node);
  });
});

describe("createContainer", () => {
  test("defaults to a div; a custom tag is upper-cased", () => {
    expect(createContainer().tagName).toBe("DIV");
    expect(createContainer("section").tagName).toBe("SECTION");
  });
});

describe("data", () => {
  test("data getter/setter stringify", () => {
    const doc = new MockDocument();
    const text = doc.createTextNode("a");
    text.data = "b";
    expect(text.data).toBe("b");
  });
});
