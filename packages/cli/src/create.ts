/**
 * `kanabun create <name>` — scaffold a new kanabun app.
 *
 * Writes a minimal, runnable project (HTML entry + a counter component +
 * tsconfig wired to the kanabun JSX runtime). Bun/Node-only APIs are used here,
 * never in `@kanabun/core`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface CreateOptions {
  /** Directory to create the project under. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** The files written for a freshly-created project, keyed by relative path. */
export function templateFiles(name: string): Record<string, string> {
  return {
    "package.json":
      JSON.stringify(
        {
          name,
          version: "0.0.0",
          private: true,
          type: "module",
          scripts: {
            dev: "kanabun dev",
            build: "kanabun build",
          },
          dependencies: { "@kanabun/core": "^0.0.0" },
          devDependencies: { "@kanabun/cli": "^0.0.0", "@types/bun": "latest" },
        },
        null,
        2,
      ) + "\n",
    "tsconfig.json":
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            lib: ["ESNext", "DOM", "DOM.Iterable"],
            strict: true,
            types: ["bun"],
            jsx: "react-jsx",
            jsxImportSource: "@kanabun/core",
            noEmit: true,
          },
          include: ["src"],
        },
        null,
        2,
      ) + "\n",
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`,
    "src/main.tsx": `import { signal, render } from "@kanabun/core";

function App() {
  const count = signal(0);
  return (
    <button type="button" onClick={() => count.update((n) => n + 1)}>
      count is {count}
    </button>
  );
}

const root = document.getElementById("app");
if (root) render(() => <App />, root);
`,
    ".gitignore": "node_modules\ndist\n",
  };
}

/**
 * Scaffold a new project named `name`. Returns the absolute project directory.
 * Throws if the target directory already exists.
 */
export async function create(name: string, options: CreateOptions = {}): Promise<string> {
  if (name.trim() === "") throw new Error("kanabun: project name is required.");
  const dir = resolve(options.cwd ?? process.cwd(), name);
  if (existsSync(dir)) {
    throw new Error(`kanabun: directory already exists: ${dir}`);
  }
  // The project name is the target directory's basename, so a path like
  // `create ./apps/web` yields the package name "web", not the whole path.
  const files = templateFiles(basename(dir));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
  return dir;
}
