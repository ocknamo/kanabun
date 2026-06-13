/**
 * `kanabun build` — bundle an app for the browser.
 *
 * This is the Bun-dependent layer: it wraps `Bun.build` (no esbuild/Vite
 * dependency). Nothing here leaks into `@kanabun/core`.
 */
import { resolve } from "node:path";

export interface BuildOptions {
  /** Entry file (e.g. `src/main.tsx`) or an HTML entry. */
  entry: string;
  /** Output directory. Defaults to `dist`. */
  outdir?: string;
  /** Minify output. Defaults to `true`. */
  minify?: boolean;
  /** Emit sourcemaps. Defaults to `"linked"`. */
  sourcemap?: "none" | "linked" | "inline" | "external";
}

export interface BuildResult {
  success: boolean;
  outputs: string[];
  logs: string[];
}

/**
 * Bundle `entry` to `outdir` targeting the browser. Never throws: a failure
 * (build error or an unresolvable entry) is reported as `success: false` with
 * the messages in `logs`.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const outdir = resolve(options.outdir ?? "dist");
  try {
    const result = await Bun.build({
      entrypoints: [resolve(options.entry)],
      outdir,
      target: "browser",
      minify: options.minify ?? true,
      sourcemap: options.sourcemap ?? "linked",
    });
    return {
      success: result.success,
      outputs: result.outputs.map((output) => output.path),
      logs: result.logs.map(String),
    };
  } catch (error) {
    return {
      success: false,
      outputs: [],
      logs: [error instanceof Error ? error.message : String(error)],
    };
  }
}
