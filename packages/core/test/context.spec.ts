import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  createContext,
  useContext,
  createRoot,
  effect,
  signal,
  render,
  jsx,
  For,
} from "../src/index";
import { installDOM, createContainer, serialize, type MockNode } from "./dom-mock";

const asEl = (n: MockNode) => n as unknown as Element;

describe("createContext / useContext", () => {
  test("returns the default value when no Provider is above the reader", () => {
    const Theme = createContext("light");
    createRoot((dispose) => {
      expect(useContext(Theme)).toBe("light");
      dispose();
    });
  });

  test("a Provider supplies its value to a function child's descendants", () => {
    const Theme = createContext("light");
    let seen: string | undefined;
    createRoot((dispose) => {
      Theme.Provider({
        value: "dark",
        children: () => {
          seen = useContext(Theme);
          return null;
        },
      });
      dispose();
    });
    expect(seen).toBe("dark");
  });

  test("plain (eager) children only ever see the default — function children are required", () => {
    const Theme = createContext("light");
    // The child is evaluated *before* the Provider runs, so it reads the default.
    const eagerlyRead = (() => {
      let v: string | undefined;
      createRoot((dispose) => {
        const child = ((): null => {
          v = useContext(Theme);
          return null;
        })();
        Theme.Provider({ value: "dark", children: child });
        dispose();
      });
      return v;
    })();
    expect(eagerlyRead).toBe("light");
  });

  test("nested Providers — the nearest value wins, and siblings are isolated", () => {
    const Theme = createContext("light");
    const inner: string[] = [];
    const outer: string[] = [];
    createRoot((dispose) => {
      Theme.Provider({
        value: "dark",
        children: () => {
          outer.push(useContext(Theme));
          Theme.Provider({
            value: "solarized",
            children: () => {
              inner.push(useContext(Theme));
              return null;
            },
          });
          // After the nested Provider returns, this scope still sees "dark".
          outer.push(useContext(Theme));
          return null;
        },
      });
      dispose();
    });
    expect(inner).toEqual(["solarized"]);
    expect(outer).toEqual(["dark", "dark"]);
  });

  test("independent contexts do not collide", () => {
    const Theme = createContext("light");
    const Lang = createContext("en");
    let theme: string | undefined;
    let lang: string | undefined;
    createRoot((dispose) => {
      Theme.Provider({
        value: "dark",
        children: () => {
          // No Lang.Provider above → Lang falls back to its default.
          theme = useContext(Theme);
          lang = useContext(Lang);
          return null;
        },
      });
      dispose();
    });
    expect(theme).toBe("dark");
    expect(lang).toBe("en");
  });

  test("a reactive value (accessor) lets consumers react to changes", () => {
    const Count = createContext<() => number>(() => 0);
    const count = signal(1);
    const log: number[] = [];
    createRoot((dispose) => {
      Count.Provider({
        value: count, // pass the accessor itself — the reactive convention
        children: () => {
          const read = useContext(Count);
          effect(() => {
            log.push(read());
          });
          return null;
        },
      });

      expect(log).toEqual([1]);
      count.set(2);
      count.set(3);
      expect(log).toEqual([1, 2, 3]);
      dispose();
    });
  });

  test("the Provider scope is disposed with its owner (cleanups run)", () => {
    const Theme = createContext("light");
    const cleaned: string[] = [];
    const dispose = createRoot((d) => {
      Theme.Provider({
        value: "dark",
        children: () => {
          effect(() => {
            return () => {
              cleaned.push("inner");
            };
          });
          return null;
        },
      });
      return d;
    });
    expect(cleaned).toEqual([]);
    dispose();
    expect(cleaned).toEqual(["inner"]);
  });

  test("useContext walks up past intermediate scopes that provide nothing", () => {
    const Theme = createContext("light");
    let seen: string | undefined;
    createRoot((dispose) => {
      Theme.Provider({
        value: "dark",
        children: () => {
          // An ordinary effect creates an owner with no context of its own;
          // the read inside still resolves "dark" by walking further up.
          effect(() => {
            seen = useContext(Theme);
          });
          return null;
        },
      });
      dispose();
    });
    expect(seen).toBe("dark");
  });
});

describe("context through control flow (JSX integration)", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installDOM();
  });
  afterEach(() => {
    teardown();
  });

  test("<For> rows resolve a Provider above the list", () => {
    // Each <For> row runs in its own createRoot; the owner.owner link is what
    // lets the row reach the Provider's scope. This guards that link.
    const Theme = createContext("light");
    const items = signal([1, 2]);
    const container = createContainer();
    render(
      () =>
        jsx(Theme.Provider, {
          value: "dark",
          children: () =>
            jsx(For, {
              each: () => items(),
              children: (n: number) =>
                jsx("p", { children: `${n}:${useContext(Theme)}` }),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>1:dark</p><p>2:dark</p></div>");

    // Newly-created rows (created lazily on update) still see the Provider.
    items.set([1, 2, 3]);
    expect(serialize(container)).toBe(
      "<div><p>1:dark</p><p>2:dark</p><p>3:dark</p></div>",
    );
  });
});
