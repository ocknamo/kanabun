import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const bin = resolve(import.meta.dir, "../bin/kanabun.ts");

async function runBin(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

describe("bin/kanabun", () => {
  test("--version prints the version and exits 0", async () => {
    const { stdout, code } = await runBin(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  test("an unknown command prints to stderr and exits 1", async () => {
    const { stderr, code } = await runBin(["frobnicate"]);
    expect(code).toBe(1);
    expect(stderr).toContain("unknown command");
  });
});
