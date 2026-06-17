/**
 * @kanabun/cli — the `kanabun` command (create / dev / build).
 *
 * This package is the Bun-dependent layer. It is the only place Bun/Node APIs
 * are used; `@kanabun/core` stays runtime-independent.
 */
import { build } from "./build";
import { create } from "./create";
import { dev, type DevServer } from "./dev";
import { generate } from "./generate";

export { build } from "./build";
export { create, templateFiles } from "./create";
export { dev, createDevHandler } from "./dev";
export { generate } from "./generate";
export type { BuildOptions, BuildResult } from "./build";
export type { CreateOptions } from "./create";
export type { DevOptions, DevServer, DevHandlerOptions } from "./dev";
export type {
  GenerateOptions,
  GenerateResult,
  SSGConfig,
  DocumentContext,
} from "./generate";

const VERSION = "0.0.0";

const HELP = `kanabun — a Bun + TypeScript frontend framework

Usage:
  kanabun create <name>     scaffold a new app
  kanabun dev [entry]       start the dev server (default: index.html)
  kanabun build [entry]     bundle for the browser (default: index.html)
  kanabun generate [entry]  prerender to static HTML (default: ssg.tsx)

Options:
  --outdir <dir>            build output directory (default: dist)
  --no-minify               disable minification for build
  --port <n>                dev server port (default: 3000)
  -h, --help                show this help
  -v, --version             print the version
`;

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
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

/**
 * Run the CLI for the given argv (without the `bun cli.ts` prefix). Returns the
 * running dev server for `dev` (so it can be stopped), otherwise `undefined`.
 * Throws on user errors; the bin turns that into a non-zero exit.
 */
export async function run(argv: string[]): Promise<DevServer | undefined> {
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
      const outdir = typeof flags.outdir === "string" ? flags.outdir : "dist";
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
      const outdir = typeof flags.outdir === "string" ? flags.outdir : "dist";
      const result = await generate({
        entry,
        outdir,
        minify: flags["no-minify"] !== true,
      });
      if (!result.success) {
        throw new Error(`kanabun: generate failed:\n${result.logs.join("\n")}`);
      }
      console.log(`Generated ${result.pages.length} page(s) to ${outdir}`);
      return undefined;
    }
    case "dev": {
      const entry = positionals[0] ?? "index.html";
      let port = 3000;
      if (typeof flags.port === "string") {
        port = Number(flags.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`kanabun: invalid --port \`${flags.port}\`.`);
        }
      }
      const server = dev({ entry, port });
      console.log(`kanabun dev running at ${server.url}`);
      return server;
    }
    default:
      throw new Error(
        `kanabun: unknown command \`${command}\`. Run \`kanabun --help\`.`,
      );
  }
}
