import { describe, expect, test, afterAll } from "bun:test";
import { lint, lintSource, formatFindings } from "./lint";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Rule names found, in order — a compact assertion target. */
async function rules(source: string): Promise<string[]> {
  return (await lintSource(source)).map((f) => f.rule);
}

describe("lintSource — reactive-call-in-jsx", () => {
  test("flags a bare accessor call in a child position", async () => {
    const findings = await lintSource("const A = () => <div>{count()}</div>;");
    expect(findings.length).toBe(1);
    expect(findings[0]!.rule).toBe("reactive-call-in-jsx");
    expect(findings[0]!.message).toContain("`count()`");
    expect(findings[0]!.message).toContain("() => count()");
  });

  test("does not flag the reactive form `{count}`", async () => {
    expect(await rules("const A = () => <div>{count}</div>;")).toEqual([]);
  });

  test("does not flag a thunk child `{() => count()}`", async () => {
    expect(await rules("const A = () => <div>{() => count()}</div>;")).toEqual([]);
  });

  test("does not flag a function-expression child", async () => {
    expect(
      await rules("const A = () => <div>{function () { return count(); }}</div>;"),
    ).toEqual([]);
  });

  test("flags an accessor call in a non-event attribute", async () => {
    expect(await rules('const A = () => <a class={theme()}>x</a>;')).toEqual([
      "reactive-call-in-jsx",
    ]);
  });

  test("does not flag a call inside an `on*` event handler value", async () => {
    expect(await rules("const A = () => <button onClick={handler()}>x</button>;")).toEqual(
      [],
    );
  });

  test("flags inside a compound expression (read once → not reactive)", async () => {
    expect(await rules("const A = () => <div>{count() + 1}</div>;")).toEqual([
      "reactive-call-in-jsx",
    ]);
  });

  test("flags an accessor read inside an object/style value", async () => {
    expect(await rules("const A = () => <div style={{ color: theme() }}>x</div>;")).toEqual(
      ["reactive-call-in-jsx"],
    );
  });

  test("does not flag calls inside a nested arrow (already deferred)", async () => {
    expect(
      await rules("const A = () => <div>{items().map((x) => render(x()))}</div>;"),
    ).toEqual(["reactive-call-in-jsx"]); // only the top-level items(), not x()
  });

  test("does not flag a call with arguments", async () => {
    expect(await rules("const A = () => <div>{format(value)}</div>;")).toEqual([]);
  });

  test("flags a property/element access callee", async () => {
    expect(
      await rules('const A = () => <div>{store.count()}{store["n"]()}</div>;'),
    ).toEqual(["reactive-call-in-jsx", "reactive-call-in-jsx"]);
  });

  test("does not flag when the callee is itself a call (`a()()`)", async () => {
    // The outer call's callee is a CallExpression, not an accessor read; the
    // inner `a()` has no arguments and an identifier callee, so it is flagged
    // once (the reactivity-loss is real), but the outer is not double-counted.
    expect(await rules("const A = () => <div>{a()()}</div>;")).toEqual([
      "reactive-call-in-jsx",
    ]);
  });

  test("counts each call once when a reactive position nests JSX", async () => {
    // The outer `{…}` holds a ternary whose branch is `<span>{title()}</span>`.
    // `cond()` belongs to the outer position; `title()` to the inner one — each
    // must be reported exactly once (no double-count from overlapping walks).
    const findings = await lintSource(
      "const A = () => <div>{cond() ? <span>{title()}</span> : null}</div>;",
    );
    expect(findings.map((f) => f.rule)).toEqual([
      "reactive-call-in-jsx",
      "reactive-call-in-jsx",
    ]);
    expect(new Set(findings.map((f) => `${f.line}:${f.column}`)).size).toBe(2);
  });

  test("counts once through several levels of nested JSX", async () => {
    const findings = await lintSource(
      "const A = () => <div>{<a>{<b>{deep()}</b>}</a>}</div>;",
    );
    expect(findings.length).toBe(1);
  });

  test("flags a read-once accessor inside a render-callback JSX child", async () => {
    // With no compiler, `{item()}` reads once even inside a `<For>` callback;
    // the reactive form is `{item}`. So it is (deliberately) flagged — the rule
    // is syntactic and treats every bare accessor read the same way.
    expect(
      await rules(
        "const A = () => <For each={items}>{(item) => <li>{item()}</li>}</For>;",
      ),
    ).toEqual(["reactive-call-in-jsx"]);
  });

  test("flags accessor calls in a fragment child", async () => {
    expect(await rules("const A = () => <>{count()}</>;")).toEqual([
      "reactive-call-in-jsx",
    ]);
  });

  test("ignores a spread child / empty expression", async () => {
    expect(await rules("const A = (props) => <div {...spread()}>{}</div>;")).toEqual([]);
  });

  test("scans a namespaced attribute name without throwing", async () => {
    // `xlink:href` parses as a namespaced JSX attribute (a non-identifier name);
    // it is not `on*`, so its value is scanned — exercising the `.getText`
    // branch for non-identifier attribute names.
    expect(await rules("const A = () => <svg xlink:href={url()} />;")).toEqual([
      "reactive-call-in-jsx",
    ]);
  });

  test("reports 1-based line and column at the call", async () => {
    const [finding] = await lintSource("\n  <div>{count()}</div>;", "x.tsx");
    expect(finding!.file).toBe("x.tsx");
    expect(finding!.line).toBe(2);
    expect(finding!.column).toBe(9); // 2 spaces + "<div>{" → `count` at col 9
  });
});

describe("formatFindings", () => {
  test("renders `file:line:col  rule  message` lines", async () => {
    const findings = await lintSource("const A = () => <div>{count()}</div>;", "a.tsx");
    const out = formatFindings(findings);
    expect(out).toContain("a.tsx:1:");
    expect(out).toContain("reactive-call-in-jsx");
    expect(out).toContain("`count()`");
  });
});

describe("lint — filesystem", () => {
  const dirsP = mkdtemp(join(tmpdir(), "kanabun-lint-"));

  afterAll(async () => {
    await rm(await dirsP, { recursive: true, force: true });
  });

  test("finds problems across matched files, relativizing paths", async () => {
    const dir = join(await dirsP, "project");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bad.tsx"), "const A = () => <div>{count()}</div>;");
    await writeFile(join(dir, "good.tsx"), "const B = () => <div>{count}</div>;");

    const result = await lint({ cwd: dir });
    expect(result.success).toBe(false);
    expect(result.logs).toEqual([]);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]!.file).toBe("bad.tsx");
  });

  test("returns success on a clean tree", async () => {
    const dir = join(await dirsP, "clean");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "ok.tsx"), "const B = () => <div>{count}</div>;");
    const result = await lint({ cwd: dir });
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("ignores node_modules", async () => {
    const dir = join(await dirsP, "with-deps");
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(
      join(dir, "node_modules", "dep.tsx"),
      "const A = () => <div>{count()}</div>;",
    );
    await writeFile(join(dir, "app.tsx"), "const B = () => <div>{count}</div>;");
    const result = await lint({ cwd: dir });
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("dedupes a file matched by overlapping globs", async () => {
    const dir = join(await dirsP, "overlap");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "x.tsx"), "const A = () => <div>{count()}</div>;");
    const result = await lint({ cwd: dir, globs: ["**/*.tsx", "x.tsx"] });
    expect(result.findings.length).toBe(1);
  });

  test("never throws — a bad cwd is reported in logs", async () => {
    const result = await lint({ cwd: join(await dirsP, "does-not-exist") });
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });
});
