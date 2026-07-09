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
 * ## ⚠️ Temporarily disabled on TypeScript 7
 *
 * The `reactive-call-in-jsx` rule parsed each TSX source **in-process** with the
 * TypeScript compiler API, loaded via a plain `import("typescript")`. TypeScript
 * 7 (the native port) **removed that in-process API**: the parser now lives
 * inside the native binary and is reachable only through a spawned server API
 * (`typescript/unstable/sync`), with the AST types/guards split out under
 * `typescript/unstable/ast`. There is no in-process `createSourceFile` any more.
 *
 * Rather than force a subprocess-based rewrite in as part of the TS 7 toolchain
 * bump, the linter is **paused**: `lint()` reports it as an internal failure
 * (never a false "clean" pass) and `lintSource()` throws the same explanation.
 * The public surface (`lint` / `lintSource` / `formatFindings` and the result
 * types) is preserved so the port is a drop-in. The full rule algorithm remains
 * specified in `docs/dx.md` §4 and recoverable from git history.
 *
 * Follow-up: re-implement the walk on `typescript/unstable/ast` + the native
 * server API once that has stabilised (tracked in `docs/dx.md` / `roadmap.md`).
 */

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

/**
 * Why `kanabun lint` currently reports a failure instead of running its rules.
 * See the module header: TypeScript 7 removed the in-process parser the linter
 * relied on. Kept as a single constant so `lint`/`lintSource` stay in sync and
 * tests assert one source of truth.
 */
export const LINT_UNAVAILABLE_ON_TS7 =
  '`kanabun lint` is temporarily disabled on TypeScript 7. TS 7 removed the ' +
  'in-process compiler API (`import("typescript")`) the linter parsed sources ' +
  "with; the port to the native server API (`typescript/unstable/sync`) is a " +
  "tracked follow-up (see docs/dx.md §4). No sources were analyzed.";

/**
 * Analyze a single TSX source string and return its findings.
 *
 * **Paused on TypeScript 7** — see the module header. Until the rule is ported
 * to the native parser this always throws {@link LINT_UNAVAILABLE_ON_TS7},
 * preserving the previous contract (this function rejected when the parser could
 * not be loaded). Kept exported so the port stays a drop-in and callers/tests do
 * not have to change shape.
 */
export async function lintSource(
  _source: string,
  _fileName = "input.tsx",
): Promise<LintFinding[]> {
  throw new Error(LINT_UNAVAILABLE_ON_TS7);
}

/**
 * Lint every file matched by `globs` and collect their findings. Never throws:
 * an internal failure comes back as `success: false` with the reason in `logs`,
 * mirroring {@link build} / {@link generate}.
 *
 * **Paused on TypeScript 7** — see the module header. The linter cannot parse
 * sources in-process any more, so rather than scan the tree and silently report
 * a (false) clean pass, it returns `success: false` with
 * {@link LINT_UNAVAILABLE_ON_TS7} in `logs` and no findings.
 */
export async function lint(_options: LintOptions = {}): Promise<LintResult> {
  return { success: false, findings: [], logs: [LINT_UNAVAILABLE_ON_TS7] };
}

/** Format findings as `file:line:col  rule  message` lines (one per finding). */
export function formatFindings(findings: LintFinding[]): string {
  return findings
    .map((f) => `${f.file}:${f.line}:${f.column}  ${f.rule}  ${f.message}`)
    .join("\n");
}
