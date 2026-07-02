/**
 * @kanabun/cli — the `kanabun` command (create / dev / build).
 *
 * This package is the Bun-dependent layer. It is the only place Bun/Node APIs
 * are used; `@kanabun/core` stays runtime-independent.
 */
import { dirname, resolve } from "node:path";
import { build } from "./build";
import { create } from "./create";
import { dev, type DevServer } from "./dev";
import { generate } from "./generate";
import { formatFindings, lint } from "./lint";
import { preview } from "./preview";
import { serve, type SSRConfig, type SSRServer } from "./serve";

export { build } from "./build";
export { create, templateFiles } from "./create";
export { dev, createDevHandler } from "./dev";
export { generate } from "./generate";
export { buildIslands } from "./islands";
export { lint, lintSource, formatFindings } from "./lint";
export { preview } from "./preview";
export { serve, createSSRHandler } from "./serve";
export type { BuildOptions, BuildResult } from "./build";
export type { CreateOptions } from "./create";
export type { DevOptions, DevServer, DevHandlerOptions } from "./dev";
export type { DocumentContext } from "./document";
export type { GenerateOptions, GenerateResult, SSGConfig } from "./generate";
export type { BuildIslandsOptions, BuildIslandsResult } from "./islands";
export type { LintOptions, LintResult, LintFinding } from "./lint";
export type { PreviewOptions, PreviewServer } from "./preview";
export type { SSRConfig, ServeOptions, SSRServer } from "./serve";

const VERSION = "0.0.0";

const HELP = `kanabun — a Bun + TypeScript frontend framework

Usage:
  kanabun create <name>     scaffold a new app
  kanabun dev [entry]       start the dev server (default: index.html)
  kanabun build [entry]     bundle for the browser (default: index.html)
  kanabun generate [entry]  prerender to static HTML (default: ssg.tsx)
  kanabun serve [entry]     start an SSR server (default: ssr.tsx)
  kanabun preview [entry]   build the SSG output and serve it (default: ssg.tsx)
  kanabun lint [globs...]   check reactive-convention slips (default: **/*.tsx)

Options:
  --outdir <dir>            build output directory (default: dist)
  --base <path>             public base path for generate/serve (default: /)
  --no-minify               disable minification for build
  --port <n>                server port (default: $PORT or 3000)
  -h, --help                show this help
  -v, --version             print the version
`;

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** Return `flags[key]` if it is a string, otherwise `def` (default `undefined`). */
function stringFlag(flags: ParsedArgs["flags"], key: string): string | undefined;
function stringFlag(flags: ParsedArgs["flags"], key: string, def: string): string;
function stringFlag(
  flags: ParsedArgs["flags"],
  key: string,
  def?: string,
): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : def;
}

/** Minimal argv parser: `command`, positionals, and `--flag [value]` / `-x`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  // The command is the first arg only when it isn't a flag (so `--version` with
  // no command still parses as a flag rather than an unknown command).
  let command: string | undefined;
  let start = 0;
  if (argv.length > 0 && !argv[0]!.startsWith("-")) {
    command = argv[0];
    start = 1;
  }
  for (let i = start; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      flags[arg.slice(1)] = true;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

/** Parse and validate the `--port` flag; `undefined` when it wasn't given. */
function portFlag(flags: ParsedArgs["flags"]): number | undefined {
  const portStr = stringFlag(flags, "port");
  if (portStr === undefined) return undefined;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`kanabun: invalid --port \`${portStr}\`.`);
  }
  return port;
}

/**
 * Run the CLI for the given argv (without the `bun cli.ts` prefix). Returns the
 * running server for `dev`/`serve`/`preview` (so it can be stopped), otherwise
 * `undefined`. Throws on user errors; the bin turns that into a non-zero exit.
 */
export async function run(argv: string[]): Promise<DevServer | SSRServer | undefined> {
  const { command, positionals, flags } = parseArgs(argv);

  if (flags.version === true || flags.v === true || command === "version") {
    console.log(VERSION);
    return undefined;
  }
  if (
    flags.help === true ||
    flags.h === true ||
    command === undefined ||
    command === "help"
  ) {
    console.log(HELP);
    return undefined;
  }

  switch (command) {
    case "create": {
      const name = positionals[0];
      if (name === undefined) {
        throw new Error("kanabun: `create` requires a project name.");
      }
      const dir = await create(name);
      console.log(`Created ${dir}`);
      console.log(`\nNext steps:\n  cd ${name}\n  bun install\n  bun run dev`);
      return undefined;
    }
    case "build": {
      const entry = positionals[0] ?? "index.html";
      const outdir = stringFlag(flags, "outdir", "dist");
      const result = await build({
        entry,
        outdir,
        minify: flags["no-minify"] !== true,
      });
      if (!result.success) {
        throw new Error(`kanabun: build failed:\n${result.logs.join("\n")}`);
      }
      console.log(`Built ${result.outputs.length} file(s) to ${outdir}`);
      return undefined;
    }
    case "generate": {
      const entry = positionals[0] ?? "ssg.tsx";
      const outdir = stringFlag(flags, "outdir", "dist");
      const result = await generate({
        entry,
        outdir,
        minify: flags["no-minify"] !== true,
        base: stringFlag(flags, "base"),
      });
      if (!result.success) {
        throw new Error(`kanabun: generate failed:\n${result.logs.join("\n")}`);
      }
      console.log(`Generated ${result.pages.length} page(s) to ${outdir}`);
      return undefined;
    }
    case "lint": {
      const globs = positionals.length > 0 ? positionals : undefined;
      const result = await lint({ globs });
      if (result.findings.length > 0) console.log(formatFindings(result.findings));
      if (!result.success) {
        // An internal failure (logs) vs. lint problems — same non-zero exit,
        // different detail.
        const reason =
          result.logs.length > 0
            ? `\n${result.logs.join("\n")}`
            : ` ${result.findings.length} problem(s) found.`;
        throw new Error(`kanabun: lint reported problems.${reason}`);
      }
      console.log("No lint problems found.");
      return undefined;
    }
    case "serve": {
      const port = portFlag(flags); // validate before importing the config
      const entry = resolve(positionals[0] ?? "ssr.tsx");
      const mod = (await import(entry)) as { default?: SSRConfig };
      const config = (mod.default ?? (mod as unknown as SSRConfig)) as SSRConfig;
      const server = await serve(config, {
        dir: dirname(entry),
        port,
        minify: flags["no-minify"] !== true,
        base: stringFlag(flags, "base"),
      });
      console.log(`kanabun serve running at ${server.url}`);
      return server;
    }
    case "preview": {
      const server = await preview({
        entry: positionals[0] ?? "ssg.tsx",
        outdir: stringFlag(flags, "outdir"),
        port: portFlag(flags),
        minify: flags["no-minify"] !== true,
        base: stringFlag(flags, "base"),
      });
      console.log(`kanabun preview running at ${server.url} (built to ${server.outdir})`);
      return server;
    }
    case "dev": {
      const entry = positionals[0] ?? "index.html";
      const server = dev({ entry, port: portFlag(flags) });
      console.log(`kanabun dev running at ${server.url}`);
      return server;
    }
    default:
      throw new Error(
        `kanabun: unknown command \`${command}\`. Run \`kanabun --help\`.`,
      );
  }
}
