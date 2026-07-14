import { describe, expect, test } from "bun:test";
import {
  lint,
  lintSource,
  formatFindings,
  LINT_UNAVAILABLE_ON_TS7,
  type LintFinding,
} from "./lint";

// `kanabun lint` is paused on TypeScript 7 — see the header of `lint.ts`. TS 7
// removed the in-process compiler API the `reactive-call-in-jsx` rule parsed
// with, so until the rule is ported to the native server API the command
// reports itself unavailable rather than silently passing. These tests pin that
// contract; the rule's own fixture tests return with the native-API port. The
// full algorithm remains specified in docs/dx.md §4.

describe("lint — paused on TypeScript 7", () => {
  test("lint() reports an internal failure, not a false clean pass", async () => {
    const result = await lint();
    expect(result.success).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.logs).toEqual([LINT_UNAVAILABLE_ON_TS7]);
  });

  test("lint() ignores options while paused (no filesystem scan)", async () => {
    const result = await lint({ cwd: "/does/not/exist", globs: ["**/*.tsx"] });
    expect(result.success).toBe(false);
    expect(result.logs).toEqual([LINT_UNAVAILABLE_ON_TS7]);
  });

  test("lintSource() throws the unavailable explanation", async () => {
    await expect(lintSource("const A = () => <div>{count()}</div>;")).rejects.toThrow(
      /temporarily disabled on TypeScript 7/,
    );
  });

  test("the unavailable message points at the migration follow-up", () => {
    expect(LINT_UNAVAILABLE_ON_TS7).toContain("native server API");
    expect(LINT_UNAVAILABLE_ON_TS7).toContain("docs/dx.md");
  });
});

describe("formatFindings", () => {
  // formatFindings is parser-independent and stays live for the native-API port,
  // so it keeps its own coverage from hand-built findings.
  test("renders `file:line:col  rule  message` lines", () => {
    const findings: LintFinding[] = [
      {
        file: "a.tsx",
        line: 1,
        column: 22,
        rule: "reactive-call-in-jsx",
        message: "`count()` is called directly in a JSX reactive position.",
      },
      {
        file: "b.tsx",
        line: 4,
        column: 10,
        rule: "reactive-call-in-jsx",
        message: "`theme()` is called directly in a JSX reactive position.",
      },
    ];
    const out = formatFindings(findings);
    expect(out).toBe(
      "a.tsx:1:22  reactive-call-in-jsx  `count()` is called directly in a JSX reactive position.\n" +
        "b.tsx:4:10  reactive-call-in-jsx  `theme()` is called directly in a JSX reactive position.",
    );
  });

  test("renders an empty string for no findings", () => {
    expect(formatFindings([])).toBe("");
  });
});
