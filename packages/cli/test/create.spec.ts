import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { create, templateFiles } from "../src/create";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kanabun-create-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("create", () => {
  test("scaffolds a runnable project", async () => {
    const projectDir = await create("myapp", { cwd: dir });
    expect(projectDir).toBe(join(dir, "myapp"));

    for (const rel of [
      "package.json",
      "tsconfig.json",
      "index.html",
      "src/main.tsx",
      ".gitignore",
    ]) {
      expect(existsSync(join(projectDir, rel))).toBe(true);
    }

    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("myapp");
    expect(pkg.dependencies["@kanabun/core"]).toBeDefined();
    expect(pkg.scripts.dev).toBe("kanabun dev"); // defaults to the HTML entry
    expect(pkg.scripts.build).toBe("kanabun build");

    const main = await readFile(join(projectDir, "src/main.tsx"), "utf8");
    expect(main).toContain("@kanabun/core");

    const tsconfig = JSON.parse(await readFile(join(projectDir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("@kanabun/core");
  });

  test("throws if the directory already exists", async () => {
    await create("dup", { cwd: dir });
    await expect(create("dup", { cwd: dir })).rejects.toThrow(/already exists/);
  });

  test("throws on an empty name", async () => {
    await expect(create("   ", { cwd: dir })).rejects.toThrow(/name is required/);
  });

  test("templateFiles lists the expected files and interpolates the name", () => {
    const files = templateFiles("widget");
    expect(Object.keys(files).sort()).toEqual([
      ".gitignore",
      "index.html",
      "package.json",
      "src/main.tsx",
      "tsconfig.json",
    ]);
    expect(files["index.html"]).toContain("<title>widget</title>");
  });
});
