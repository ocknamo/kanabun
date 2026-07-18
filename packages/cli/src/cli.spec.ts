import { describe, expect, test } from "bun:test";
import { parseArgs, run } from "./index";
import { mkdtemp, readdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("parseArgs", () => {
  test("parses a command, positionals, and flags", () => {
    const r = parseArgs([
      "build",
      "src/main.tsx",
      "--outdir",
      "out",
      "--no-minify",
      "--no-sourcemap",
    ]);
    expect(r.command).toBe("build");
    expect(r.positionals).toEqual(["src/main.tsx"]);
    expect(r.flags.outdir).toBe("out");
    expect(r.flags["no-minify"]).toBe(true);
    expect(r.flags["no-sourcemap"]).toBe(true);
  });

  test("a leading flag means no command", () => {
    const r = parseArgs(["--version"]);
    expect(r.command).toBeUndefined();
    expect(r.flags.version).toBe(true);
  });

  test("supports short flags", () => {
    const r = parseArgs(["dev", "-h"]);
    expect(r.command).toBe("dev");
    expect(r.flags.h).toBe(true);
  });

  test("handles empty argv", () => {
    const r = parseArgs([]);
    expect(r.command).toBeUndefined();
    expect(r.positionals).toEqual([]);
    expect(r.flags).toEqual({});
  });
});

/** Capture console.log output produced while running `fn`. */
async function capture(fn: () => Promise<unknown>): Promise<string> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return logs.join("\n");
}

describe("run", () => {
  test("--version prints the version", async () => {
    expect(await capture(() => run(["--version"]))).toMatch(/\d+\.\d+\.\d+/);
  });

  test("version command prints the version", async () => {
    expect(await capture(() => run(["version"]))).toMatch(/\d+\.\d+\.\d+/);
  });

  test("--help and no args print usage", async () => {
    expect(await capture(() => run(["--help"]))).toContain("Usage:");
    expect(await capture(() => run([]))).toContain("Usage:");
  });

  test("unknown command throws", async () => {
    await expect(run(["frobnicate"])).rejects.toThrow(/unknown command/);
  });

  test("create requires a project name", async () => {
    await expect(run(["create"])).rejects.toThrow(/requires a project name/);
  });

  test("create scaffolds in the current directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-run-create-"));
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const out = await capture(() => run(["create", "app"]));
      expect(out).toContain("Created");
      expect(existsSync(join(dir, "app", "package.json"))).toBe(true);
    } finally {
      process.chdir(prevCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("build reports the output, and a failure throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-run-build-"));
    try {
      const out = await capture(() =>
        run([
          "build",
          resolve(root, "examples/counter/main.tsx"),
          "--outdir",
          join(dir, "dist"),
          "--no-minify",
        ]),
      );
      expect(out).toContain("Built");

      await expect(
        run(["build", resolve(root, "examples/counter/nope.tsx"), "--outdir", join(dir, "dist")]),
      ).rejects.toThrow(/build failed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("build emits a sourcemap by default and skips it with --no-sourcemap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-run-nomap-"));
    const entry = resolve(root, "examples/counter/main.tsx");
    try {
      await capture(() => run(["build", entry, "--outdir", join(dir, "with")]));
      expect((await readdir(join(dir, "with"))).some((f) => f.endsWith(".js.map"))).toBe(true);

      await capture(() =>
        run(["build", entry, "--outdir", join(dir, "without"), "--no-sourcemap"]),
      );
      expect((await readdir(join(dir, "without"))).some((f) => f.endsWith(".js.map"))).toBe(
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("generate reports the page count, and a failure throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-run-generate-"));
    try {
      const out = await capture(() =>
        run([
          "generate",
          resolve(root, "examples/ssg/ssg.tsx"),
          "--outdir",
          join(dir, "site"),
          "--base",
          "/app/",
          "--no-minify",
        ]),
      );
      expect(out).toContain("Generated 2 page(s)");
      const index = await readFile(join(dir, "site", "index.html"), "utf8");
      expect(index).toContain('src="/app/main.js"');

      await expect(
        run(["generate", join(dir, "missing.tsx"), "--outdir", join(dir, "site")]),
      ).rejects.toThrow(/generate failed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lint prints findings and exits non-zero, then passes a clean tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-run-lint-"));
    const prev = process.cwd();
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      // A bad file in cwd → default `**/*.tsx` glob → findings printed + throw.
      await writeFile(join(dir, "bad.tsx"), "const A = () => <div>{count()}</div>;");
      process.chdir(dir);
      await expect(run(["lint"])).rejects.toThrow(/lint reported problems/);
      expect(logs.join("\n")).toContain("reactive-call-in-jsx");

      // Clean tree → "No lint problems found." and no throw.
      logs.length = 0;
      await rm(join(dir, "bad.tsx"));
      await writeFile(join(dir, "ok.tsx"), "const B = () => <div>{count}</div>;");
      await run(["lint"]);
      expect(logs.join("\n")).toContain("No lint problems found.");
    } finally {
      console.log = original;
      process.chdir(prev);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("serve starts an SSR server from a config module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-serve-fix-"));
    try {
      await writeFile(
        join(dir, "ssr.ts"),
        `export default { render: (p) => "cli serve " + p, title: "cli" };\n`,
      );
      let server;
      const out = await capture(async () => {
        server = await run(["serve", join(dir, "ssr.ts"), "--port", "0"]);
      });
      try {
        expect(out).toContain("kanabun serve running at");
        expect(server!.port).toBeGreaterThan(0);
        const page = await (await fetch(`${server!.url}x`)).text();
        expect(page).toContain("cli serve /x");
      } finally {
        server!.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("preview builds the SSG entry and serves it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanabun-run-preview-"));
    try {
      let server;
      const out = await capture(async () => {
        server = await run([
          "preview",
          resolve(root, "examples/ssg/ssg.tsx"),
          "--outdir",
          join(dir, "site"),
          "--port",
          "0",
          "--no-minify",
        ]);
      });
      try {
        expect(out).toContain("kanabun preview running at");
        const index = await (await fetch(server!.url)).text();
        expect(index).toContain("<title>kanabun SSG</title>");
      } finally {
        server!.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("serve rejects an invalid --port before importing anything", async () => {
    await expect(run(["serve", "whatever.ts", "--port", "nope"])).rejects.toThrow(
      /invalid --port/,
    );
  });

  test("dev rejects an invalid --port (non-numeric or out of range)", async () => {
    const html = resolve(root, "examples/counter/index.html");
    await expect(run(["dev", html, "--port", "abc"])).rejects.toThrow(/invalid --port/);
    await expect(run(["dev", html, "--port", "99999"])).rejects.toThrow(/invalid --port/);
  });

  test("dev returns a stoppable server", async () => {
    const original = console.log;
    console.log = () => {};
    let server;
    try {
      server = await run([
        "dev",
        resolve(root, "examples/counter/index.html"),
        "--port",
        "0",
      ]);
    } finally {
      console.log = original;
    }
    expect(server).toBeDefined();
    expect(server!.port).toBeGreaterThan(0);
    server!.stop();
  });
});
