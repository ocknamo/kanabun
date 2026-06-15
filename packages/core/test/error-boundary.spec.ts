import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  signal,
  effect,
  createRoot,
  catchError,
  render,
  jsx,
  ErrorBoundary,
} from "../src/index";
import { installDOM, createContainer, serialize, type MockNode } from "./dom-mock";

const asEl = (n: MockNode) => n as unknown as Element;

// ── catchError: the reactive primitive (no DOM needed) ──────────────
describe("catchError", () => {
  test("returns the value when nothing throws", () => {
    let caught: unknown = "untouched";
    const result = catchError(
      () => 42,
      (e) => {
        caught = e;
      },
    );
    expect(result).toBe(42);
    expect(caught).toBe("untouched");
  });

  test("catches a synchronous throw, calls the handler, returns undefined", () => {
    let caught: unknown;
    const result = catchError(
      () => {
        throw new Error("boom");
      },
      (e) => {
        caught = e;
      },
    );
    expect(result).toBeUndefined();
    expect((caught as Error).message).toBe("boom");
  });

  test("catches an error thrown by a descendant effect when it later re-runs", () => {
    const trigger = signal(0);
    let caught: unknown;
    createRoot(() => {
      catchError(
        () => {
          effect(() => {
            if (trigger()) throw new Error("late");
          });
        },
        (e) => {
          caught = e;
        },
      );
    });
    // The effect ran once cleanly (trigger 0): no error yet.
    expect(caught).toBeUndefined();
    trigger.set(1); // re-runs the effect, which now throws
    expect((caught as Error).message).toBe("late");
  });

  test("the nearest boundary wins (inner before outer)", () => {
    const trigger = signal(0);
    let inner: unknown;
    let outer: unknown;
    createRoot(() => {
      catchError(
        () => {
          catchError(
            () => {
              effect(() => {
                if (trigger()) throw new Error("x");
              });
            },
            (e) => {
              inner = e;
            },
          );
        },
        (e) => {
          outer = e;
        },
      );
    });
    trigger.set(1);
    expect((inner as Error).message).toBe("x");
    expect(outer).toBeUndefined();
  });

  test("rethrows when there is no boundary above the failing computation", () => {
    const trigger = signal(0);
    createRoot(() => {
      effect(() => {
        if (trigger()) throw new Error("unguarded");
      });
    });
    expect(() => trigger.set(1)).toThrow("unguarded");
  });
});

// ── <ErrorBoundary>: the component ──────────────────────────────────
describe("<ErrorBoundary>", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installDOM();
  });
  afterEach(() => {
    teardown();
  });

  test("renders children normally when nothing throws", () => {
    const container = createContainer();
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: jsx("p", { children: "fallback" }),
          children: () => jsx("span", { children: "ok" }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><span>ok</span></div>");
  });

  test("shows the fallback when a child throws during creation", () => {
    const container = createContainer();
    const Boom = () => {
      throw new Error("kaboom");
    };
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: (err: unknown) => jsx("p", { children: `caught: ${String(err)}` }),
          children: () => jsx(Boom, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>caught: Error: kaboom</p></div>");
  });

  test("accepts a static (non-function) fallback", () => {
    const container = createContainer();
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: jsx("p", { children: "static" }),
          children: () => {
            throw new Error("nope");
          },
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>static</p></div>");
  });

  test("catches an error thrown by a child's reactive update", () => {
    const container = createContainer();
    const boom = signal(false);
    const Child = () =>
      jsx("p", {
        children: () => {
          if (boom()) throw new Error("late");
          return "ok";
        },
      });
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: () => jsx("span", { children: "fallback" }),
          children: () => jsx(Child, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>ok</p></div>");
    boom.set(true);
    expect(serialize(container)).toBe("<div><span>fallback</span></div>");
  });

  test("reset clears the error and rebuilds the children", () => {
    const container = createContainer();
    const boom = signal(true);
    let doReset!: () => void;
    const Child = () =>
      jsx("p", {
        children: () => {
          if (boom()) throw new Error("e");
          return "recovered";
        },
      });
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: (_err: unknown, reset: () => void) => {
            doReset = reset;
            return jsx("button", { children: "retry" });
          },
          children: () => jsx(Child, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><button>retry</button></div>");
    boom.set(false); // fix the underlying cause before retrying
    doReset();
    expect(serialize(container)).toBe("<div><p>recovered</p></div>");
  });

  test("nested boundaries: the inner one catches an update throw, the outer is untouched", () => {
    const container = createContainer();
    const boom = signal(false);
    const Child = () =>
      jsx("p", {
        children: () => {
          if (boom()) throw new Error("inner");
          return "ok";
        },
      });
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: () => jsx("b", { children: "outer-fallback" }),
          children: () =>
            jsx(ErrorBoundary, {
              fallback: () => jsx("i", { children: "inner-fallback" }),
              children: () => jsx(Child, {}),
            }),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>ok</p></div>");
    // Must not loop (this used to hit the flush safety valve): the *inner*
    // boundary catches, and the outer keeps rendering its subtree.
    boom.set(true);
    expect(serialize(container)).toBe("<div><i>inner-fallback</i></div>");
  });

  test("reset that fails again falls straight back to the fallback", () => {
    const container = createContainer();
    let doReset!: () => void;
    let renders = 0;
    const AlwaysBoom = () => {
      throw new Error("always");
    };
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: (_err: unknown, reset: () => void) => {
            renders++;
            doReset = reset;
            return jsx("p", { children: "boom" });
          },
          children: () => jsx(AlwaysBoom, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>boom</p></div>");
    expect(renders).toBe(1);
    doReset(); // rebuild throws again — stay on the fallback, no loop
    expect(serialize(container)).toBe("<div><p>boom</p></div>");
    expect(renders).toBe(2);
  });

  test("tears down the failed subtree so it stops reacting once the fallback shows", () => {
    const container = createContainer();
    const boom = signal(false);
    const other = signal(0);
    let runs = 0;
    const Child = () =>
      jsx("p", {
        children: () => {
          runs++;
          other(); // subscribe to an unrelated signal
          if (boom()) throw new Error("x");
          return "ok";
        },
      });
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: () => jsx("i", { children: "fb" }),
          children: () => jsx(Child, {}),
        }),
      asEl(container),
    );
    boom.set(true); // throw → fallback
    expect(serialize(container)).toBe("<div><i>fb</i></div>");
    const after = runs;
    // The failed subtree was disposed, so unrelated updates no longer re-run it.
    other.set(1);
    other.set(2);
    expect(runs).toBe(after);
  });

  test("disposing the render tears down the guarded children", () => {
    const container = createContainer();
    const tick = signal(0);
    let runs = 0;
    const Child = () =>
      jsx("p", {
        children: () => {
          runs++;
          return String(tick());
        },
      });
    const dispose = render(
      () =>
        jsx(ErrorBoundary, {
          fallback: jsx("i", { children: "fb" }),
          children: () => jsx(Child, {}),
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><p>0</p></div>");
    const before = runs;
    dispose();
    expect(serialize(container)).toBe("<div></div>");
    tick.set(1); // the child's reactive scope is torn down — it must not re-run
    expect(runs).toBe(before);
  });

  test("a single failure is reported once even if siblings throw together", () => {
    const container = createContainer();
    const boom = signal(false);
    let fallbacks = 0;
    const Boomer = () =>
      jsx("i", {
        children: () => {
          if (boom()) throw new Error("multi");
          return "ok";
        },
      });
    render(
      () =>
        jsx(ErrorBoundary, {
          fallback: () => {
            fallbacks++;
            return jsx("span", { children: "fallback" });
          },
          children: () => [jsx(Boomer, {}), jsx(Boomer, {})],
        }),
      asEl(container),
    );
    expect(serialize(container)).toBe("<div><i>ok</i><i>ok</i></div>");
    boom.set(true); // both siblings throw in the same flush
    expect(serialize(container)).toBe("<div><span>fallback</span></div>");
    // The boundary settled on the fallback once, not once per failing sibling.
    expect(fallbacks).toBe(1);
  });
});
