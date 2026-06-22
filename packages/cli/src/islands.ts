/**
 * `buildIslands` — per-island bundle splitting (the payload win).
 *
 * Core's `<Island>` makes hydration partial in *execution* (only marked
 * components run on the client), but on its own a page still ships every island's
 * code. This is the build half: it gives each island its own chunk and emits a
 * tiny **bootstrap** that, at runtime, downloads only the chunks for the islands
 * actually present on the page (via core's `hydrateIslandsLazy`).
 *
 * How it works:
 *   1. Bundle every island as its own entrypoint with `splitting: true`, so each
 *      becomes a chunk (e.g. `counter.js`) and shared code (the core runtime) is
 *      hoisted into shared chunks rather than duplicated. A generated runtime
 *      entry re-exports `hydrateIslandsLazy` so the bootstrap can reach it.
 *   2. Write a small bootstrap (`islands.js`) — plain ES modules, not bundled —
 *      that maps each island name to a dynamic `import()` of its chunk and hands
 *      them to `hydrateIslandsLazy`. The browser loads `islands.js`, which pulls
 *      in only the chunks for the islands that scan present on the page.
 *
 * Keeping the bootstrap unbundled (the browser resolves its imports natively)
 * means the only bundler work is the static, multi-entry island build. Bun work,
 * so it lives in the CLI; `@kanabun/core` stays runtime-independent. See
 * `docs/decisions.md` → "Islands / partial hydration".
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { errorMessages } from "./errors";
import { normalizeBase } from "./paths";

export interface BuildIslandsOptions {
  /**
   * Map of island name → client entry module. Each entry must default-export the
   * component, and its `name` must match the `data-island` the server wrote.
   * Resolved relative to the cwd. Entries must have distinct file basenames (the
   * chunk is named after the file).
   */
  islands: Record<string, string>;
  /** Output directory. Defaults to `dist`. */
  outdir?: string;
  /** Minify output. Defaults to `true`. */
  minify?: boolean;
  /**
   * Public base path the site is served from (e.g. `"/repo/"`). Prefixed onto
   * the bootstrap `<script>` src so it resolves under a sub-path. Defaults to
   * `"/"`.
   */
  base?: string;
}

export interface BuildIslandsResult {
  success: boolean;
  /**
   * The `<script type="module" src=…>` tag for the generated bootstrap, with the
   * base prefix applied — drop it into the server-rendered page.
   */
  script: string;
  /** Absolute paths of every emitted file (island chunks, runtime, bootstrap). */
  outputs: string[];
  logs: string[];
}

// The generated runtime entry's basename (distinctive, so it can't collide with a
// user's island file basename — which is guarded anyway).
const RUNTIME_NAME = "kanabun-islands-runtime";

/** Map a source entry path to the chunk filename Bun emits for it (`[name].js`). */
function chunkFile(entry: string): string {
  return `${basename(entry).replace(/\.[jt]sx?$/, "")}.js`;
}

function failure(message: string): BuildIslandsResult {
  return { success: false, script: "", outputs: [], logs: [message] };
}

/**
 * Code-split the given islands and emit a bootstrap that hydrates only the ones a
 * page contains. Never throws: a failure (bad entry, build error) is reported as
 * `success: false` with the messages in `logs` — mirroring {@link build}.
 */
export async function buildIslands(
  options: BuildIslandsOptions,
): Promise<BuildIslandsResult> {
  const outdir = resolve(options.outdir ?? "dist");
  const entries = Object.entries(options.islands);
  if (entries.length === 0) {
    return failure("kanabun: buildIslands needs at least one island.");
  }
  const base = normalizeBase(options.base ?? "/");

  // Each island's chunk is named after its file; distinct basenames keep them
  // from overwriting one another (and the runtime chunk).
  const chunkByName = new Map(entries.map(([name, entry]) => [name, chunkFile(entry)]));
  const files = [...chunkByName.values(), `${RUNTIME_NAME}.js`];
  if (new Set(files).size !== files.length) {
    return failure("kanabun: island entries must have distinct file names.");
  }

  // The runtime entry (re-exporting hydrateIslandsLazy) lives in a temp dir inside
  // the first entry's directory, so `@kanabun/core` resolves from the same
  // node_modules the islands do; the dir is removed afterwards.
  const tmpDir = join(dirname(resolve(entries[0]![1])), `.kanabun-islands-${crypto.randomUUID()}`);
  const runtimeEntry = join(tmpDir, `${RUNTIME_NAME}.ts`);
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(runtimeEntry, `export { hydrateIslandsLazy } from "@kanabun/core";\n`);

    // Multi-entry + splitting: each island and the runtime become their own chunk
    // with shared code hoisted. A failed build throws an `AggregateError`,
    // unpacked by the outer `catch` via `errorMessages` (same path `build()` uses).
    const built = await Bun.build({
      entrypoints: [...entries.map(([, entry]) => resolve(entry)), runtimeEntry],
      outdir,
      target: "browser",
      minify: options.minify ?? true,
      splitting: true,
      naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
    });

    // The bootstrap is plain ES modules (not bundled): the browser resolves its
    // imports, dynamically pulling in only the islands present on a page.
    const loaders = entries
      .map(([name]) => {
        // Both the name and the chunk path are string-escaped, so an unusual file
        // name can't break the generated module.
        const spec = JSON.stringify(`./${chunkByName.get(name)!}`);
        return `  ${JSON.stringify(name)}: () => import(${spec}),`;
      })
      .join("\n");
    const bootstrap =
      `import { hydrateIslandsLazy } from "./${RUNTIME_NAME}.js";\n` +
      `hydrateIslandsLazy({\n${loaders}\n});\n`;
    const bootstrapPath = join(outdir, "islands.js");
    await writeFile(bootstrapPath, bootstrap);

    const script = `<script type="module" src="${base}islands.js"></script>`;
    return {
      success: true,
      script,
      outputs: [...built.outputs.map((output) => output.path), bootstrapPath],
      logs: [],
    };
  } catch (error) {
    return { success: false, script: "", outputs: [], logs: errorMessages(error) };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
