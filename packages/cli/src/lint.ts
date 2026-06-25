/**
 * `kanabun lint` — first-party static analysis, not an ESLint plugin.
 *
 * kanabun has **no compiler** and ships **zero runtime dependencies**, so the
 * reactivity convention (a function is reactive, a called value is read once)
 * is normally enforced by discipline. This command catches the one slip the
 * type system can't (see `docs/dx.md`): calling an accessor *directly* in a
 * reactive position — `{count()}` where `{count}` (or `{() => …}`) was meant —
 * which silently reads once and stops updating.
 *
 * It reuses the project's pinned `typescript` dev dependency via a plain
 * `import("typescript")` (no auto-install, nothing added to the runtime); the
 * parser only ever runs as opt-in, dev-only authoring tooling. Like `build` /
 * `generate`, it never throws — failures come back as `logs`.
 */
import { relative, resolve } from "node:path";
import type * as TS from "typescript";
import { errorMessages } from "./errors";

/** A single lint problem at a source location. */
export interface LintFinding {
  /** File path (relative to {@link LintOptions.cwd} when reported by {@link lint}). */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** The rule that produced this finding (e.g. `"reactive-call-in-jsx"`). */
  rule: string;
  /** Human-readable description + suggested fix. */
  message: string;
}

export interface LintOptions {
  /** File globs (or paths) to lint. Defaults to `["**\/*.tsx"]`. */
  globs?: string[];
  /** Directory globs are resolved against. Defaults to the current directory. */
  cwd?: string;
}

export interface LintResult {
  /** True when there were no findings and no internal errors. */
  success: boolean;
  /** Every problem found, in file/scan order. */
  findings: LintFinding[];
  /** Internal error messages (bad cwd, parser load failure, …). Not findings. */
  logs: string[];
}

const RULE = "reactive-call-in-jsx";

/**
 * Mirror the DOM runtime's rule (`dom.ts` → `applyProp`): a prop named `on*`
 * (length > 2) is always an event listener, never a reactive thunk — so a call
 * in its value is correct, not a slip. Keeping this identical to the runtime
 * means the linter never flags what the runtime treats as an event.
 */
function isEventName(name: string): boolean {
  return name.length > 2 && name[0] === "o" && name[1] === "n";
}

/**
 * A callee that looks like a reactive accessor read: a bare identifier
 * (`count`) or a property/element access chain (`store.count`, `obj["sig"]`).
 * Excludes calls whose callee is itself a call (`a()()`) or other shapes, where
 * intent is murkier — keeping false positives down for this syntactic rule.
 */
function isAccessorLikeCallee(ts: typeof TS, callee: TS.Expression): boolean {
  return (
    ts.isIdentifier(callee) ||
    ts.isPropertyAccessExpression(callee) ||
    ts.isElementAccessExpression(callee)
  );
}

/**
 * Analyze a single TSX source string and return its findings. Exposed (and used
 * by {@link lint}) so the rule can be unit-tested from fixture strings without
 * touching the filesystem. `fileName` is only used to label findings.
 *
 * Note: unlike {@link lint}, this is not wrapped in the never-throw contract —
 * it rejects if the TypeScript parser can't be loaded. (Parsing itself never
 * throws: `createSourceFile` tolerates syntax errors, producing a partial AST.)
 */
export async function lintSource(
  source: string,
  fileName = "input.tsx",
): Promise<LintFinding[]> {
  const ts = await import("typescript");
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  return collectFindings(ts, sf, fileName);
}

/** Walk the AST and flag accessor calls sitting in JSX reactive positions. */
function collectFindings(
  ts: typeof TS,
  sf: TS.SourceFile,
  fileName: string,
): LintFinding[] {
  const findings: LintFinding[] = [];

  const report = (call: TS.CallExpression): void => {
    const callee = call.expression.getText(sf);
    const { line, character } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    findings.push({
      file: fileName,
      line: line + 1,
      column: character + 1,
      rule: RULE,
      message:
        `\`${callee}()\` is called directly in a JSX reactive position, so it is ` +
        `read once and the view won't update. Pass \`${callee}\` to keep it ` +
        `reactive, or wrap it in a thunk: \`() => ${callee}()\`.`,
    });
  };

  // Scan one reactive-position expression for zero-arg accessor calls. Stop
  // descending at two kinds of boundary, so each is handled exactly once:
  //   - a nested function (arrow/function) is a deferred thunk — its calls run
  //     later and stay reactive, so they are not slips;
  //   - a nested JSX element/fragment opens its own reactive positions (its
  //     children and attributes), which the main `visit` walk reaches on its
  //     own. Descending into it here would double-count those calls.
  const scanReactive = (expr: TS.Expression): void => {
    const walk = (node: TS.Node): void => {
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isJsxElement(node) ||
        ts.isJsxFragment(node) ||
        ts.isJsxSelfClosingElement(node)
      ) {
        return;
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        isAccessorLikeCallee(ts, node.expression)
      ) {
        report(node);
      }
      ts.forEachChild(node, walk);
    };
    walk(expr);
  };

  const visit = (node: TS.Node): void => {
    if (ts.isJsxExpression(node) && node.expression) {
      const parent = node.parent;
      if (ts.isJsxAttribute(parent)) {
        // An attribute value. Skip event props (`on*`), which are listeners.
        const name = ts.isIdentifier(parent.name)
          ? parent.name.text
          : parent.name.getText(sf);
        if (!isEventName(name)) scanReactive(node.expression);
      } else if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
        // A child expression (`<div>{…}</div>`, `<>{…}</>`).
        scanReactive(node.expression);
      }
      // Other parents (e.g. a spread `{...x}`) are not reactive positions.
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return findings;
}

/**
 * Lint every file matched by `globs` and collect their findings. Never throws:
 * an internal failure (an unreadable cwd, a parser that won't load) comes back
 * as `success: false` with the reason in `logs`, mirroring {@link build} /
 * {@link generate}. Findings themselves are not errors — `success` is simply
 * "clean", so the CLI can distinguish a failed run from a run that found problems.
 */
export async function lint(options: LintOptions = {}): Promise<LintResult> {
  const cwd = resolve(options.cwd ?? ".");
  const globs = options.globs ?? ["**/*.tsx"];
  const findings: LintFinding[] = [];
  try {
    const seen = new Set<string>();
    for (const pattern of globs) {
      const glob = new Bun.Glob(pattern);
      for await (const match of glob.scan({ cwd, absolute: true })) {
        // node_modules is third-party; never lint it.
        if (match.includes("/node_modules/") || seen.has(match)) continue;
        seen.add(match);
        const source = await Bun.file(match).text();
        const rel = relative(cwd, match);
        for (const f of await lintSource(source, rel)) findings.push(f);
      }
    }
    return { success: findings.length === 0, findings, logs: [] };
  } catch (error) {
    return { success: false, findings, logs: errorMessages(error) };
  }
}

/** Format findings as `file:line:col  rule  message` lines (one per finding). */
export function formatFindings(findings: LintFinding[]): string {
  return findings
    .map((f) => `${f.file}:${f.line}:${f.column}  ${f.rule}  ${f.message}`)
    .join("\n");
}
