#!/usr/bin/env bun
// Batch publish all workspace packages to npm.
//
// Pre-publish phase: bun test, tsc --noEmit, example builds.
// Publish phase: npm publish for each package under packages/*,
//   in dependency order (dependencies published before dependents).
//
// Usage:
//   bun run scripts/publish.ts [options]
//
// Options:
//   --dry-run             Run pre-publish checks and show what would be published, but don't publish.
//   --access <level>      npm access level: "public" or "restricted" (default: public).
//   --tag <tag>           npm dist-tag (default: latest).
//   --yes                 Skip the confirmation prompt.
//   --allow-zero-version  Permit publishing a package whose version is still 0.0.0.
//
// Internal workspace deps (e.g. "@kanabun/core": "*") are kept as "*" on disk so
// that `npm install` in CI doesn't choke on the workspace: protocol. Right before
// each `npm publish`, this script rewrites those "*" entries to "^<version>" of the
// matching workspace package, then restores the original file afterwards — so the
// *published* package.json pins a concrete version while local dev stays on "*".

import { readdirSync, readSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

// --- Parse args ---
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipConfirm = args.includes("--yes");
const allowZeroVersion = args.includes("--allow-zero-version");

function requireArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val || val.startsWith("--")) {
    console.error(`Error: ${flag} requires a value (e.g. ${flag} <value>)`);
    process.exit(1);
  }
  return val;
}

const access = requireArgValue("--access") ?? "public";
if (access !== "public" && access !== "restricted") {
  console.error(
    `Error: --access must be "public" or "restricted" (got "${access}")`
  );
  process.exit(1);
}
const tag = requireArgValue("--tag");

// --- Helper: run a shell command, exit on failure ---
async function run(cmd: string, cwd = root): Promise<void> {
  console.log(`\n$ ${cmd}`);
  const proc = Bun.spawn(["sh", "-c", cmd], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`\nFailed (exit ${code}): ${cmd}`);
    process.exit(code);
  }
}

// ============================================================
// Pre-publish checks
// ============================================================
console.log("=== Pre-publish checks ===");

// 1. Tests
await run("bun test");

// 2. Type check
await run("bunx tsc --noEmit");

// 3. Build all examples to catch JSX/import regressions
const examplesDir = join(root, "examples");
const exampleNames = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

for (const name of exampleNames) {
  const entry = join(examplesDir, name, "main.tsx");
  if (await Bun.file(entry).exists()) {
    await run(
      `bun build ${entry} --target browser --outfile /tmp/kanabun-example-${name}.js`
    );
  }
}

console.log("\n=== Pre-publish checks passed ===\n");

// ============================================================
// Collect packages
// ============================================================
const pkgsDir = join(root, "packages");
const pkgDirs = readdirSync(pkgsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(pkgsDir, d.name));

interface PkgInfo {
  dir: string;
  name: string;
  version: string;
  private?: boolean;
  deps: string[];
}

const pkgInfos: PkgInfo[] = await Promise.all(
  pkgDirs.map(async (dir) => {
    const pkg = await Bun.file(join(dir, "package.json")).json();
    const deps = Object.keys({
      ...pkg.dependencies,
      ...pkg.peerDependencies,
    });
    return {
      dir,
      name: pkg.name as string,
      version: pkg.version as string,
      private: pkg.private as boolean | undefined,
      deps,
    };
  })
);

// Skip private packages
const publishable = pkgInfos.filter((p) => !p.private);

if (publishable.length === 0) {
  console.error("No publishable packages found (all are private).");
  process.exit(1);
}

// Sort packages topologically so dependencies are published before dependents
function topologicalSort(pkgs: PkgInfo[]): PkgInfo[] {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const visited = new Set<string>();
  const result: PkgInfo[] = [];

  function visit(pkg: PkgInfo): void {
    if (visited.has(pkg.name)) return;
    visited.add(pkg.name);
    for (const dep of pkg.deps) {
      const depPkg = byName.get(dep);
      if (depPkg) visit(depPkg);
    }
    result.push(pkg);
  }

  for (const pkg of pkgs) visit(pkg);
  return result;
}

const sorted = topologicalSort(publishable);

console.log("Packages to publish (in order):");
for (const { name, version } of sorted) {
  console.log(`  ${name}@${version}`);
}

if (dryRun) {
  console.log("\n[dry-run] No packages were published.");
  process.exit(0);
}

// Guard against publishing the placeholder 0.0.0 version by accident.
// npm rejects re-publishing an already-published version, so shipping 0.0.0
// burns it permanently. Require an explicit opt-in.
const zeroVersion = sorted.filter((p) => p.version === "0.0.0");
if (zeroVersion.length > 0 && !allowZeroVersion) {
  console.error(
    `Refusing to publish packages still at version 0.0.0:\n` +
      zeroVersion.map((p) => `  ${p.name}`).join("\n") +
      `\nBump the version, or pass --allow-zero-version to override.`
  );
  process.exit(1);
}

// ============================================================
// Confirm
// ============================================================
if (!skipConfirm) {
  process.stdout.write("\nPublish the above packages? [y/N] ");
  const buf = new Uint8Array(32);
  const n = readSync(0, buf);
  const answer = new TextDecoder().decode(buf.slice(0, n)).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }
}

// ============================================================
// Publish
// ============================================================
console.log("\n=== Publishing ===\n");

const flags = ["--access", access, ...(tag ? ["--tag", tag] : [])].join(" ");

// Map of workspace package name -> version, used to pin internal "*" deps.
const versionByName = new Map(publishable.map((p) => [p.name, p.version]));

// Temporarily rewrite internal "@kanabun/* ": "*" deps to "^<version>" so the
// published package.json pins a concrete version, then restore the file.
// Returns a restore() callback (no-op if nothing was rewritten).
async function pinInternalDeps(dir: string): Promise<() => Promise<void>> {
  const pkgPath = join(dir, "package.json");
  const original = await Bun.file(pkgPath).text();
  const pkg = JSON.parse(original);

  let changed = false;
  for (const field of ["dependencies", "peerDependencies"] as const) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const depName of Object.keys(deps)) {
      const version = versionByName.get(depName);
      if (version && deps[depName] === "*") {
        deps[depName] = `^${version}`;
        changed = true;
      }
    }
  }

  if (!changed) return async () => {};
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return async () => {
    await Bun.write(pkgPath, original);
  };
}

for (const { dir, name } of sorted) {
  console.log(`Publishing ${name}...`);
  // restore() must run even on failure, so don't use run() here (it calls
  // process.exit, which would skip the finally and leave package.json rewritten).
  const restore = await pinInternalDeps(dir);
  let code: number;
  try {
    const cmd = `npm publish ${flags}`;
    console.log(`\n$ ${cmd}`);
    const proc = Bun.spawn(["sh", "-c", cmd], {
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    });
    code = await proc.exited;
  } finally {
    await restore();
  }
  if (code !== 0) {
    console.error(`\nFailed (exit ${code}): npm publish for ${name}`);
    process.exit(code);
  }
}

console.log("\n=== All packages published successfully ===");
