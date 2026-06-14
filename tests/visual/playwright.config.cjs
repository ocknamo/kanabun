const path = require("node:path");

// Run the example dev servers from the repo root regardless of where the
// `playwright` CLI is invoked.
const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * Visual-regression config for the runnable examples.
 *
 * Not part of `bun test` (the core unit suite runs against the DOM mock and is
 * runtime-independent). This is a separate, browser-based lane: Playwright is
 * CI-only tooling provided by the container image, never a `package.json`
 * dependency — so the zero-dependency rule is untouched.
 *
 * Baselines are environment-specific (fonts / sub-pixel AA / Chromium build),
 * so they MUST be generated in the same pinned container the CI gate uses
 * (`mcr.microsoft.com/playwright:v1.56.1-jammy`). Regenerate them with the
 * "Update visual baselines" workflow (or the equivalent `docker run`), never on
 * a laptop. See tests/visual/README.md.
 */
module.exports = {
  testDir: __dirname,
  // `*.visual.cjs`, not `*.spec.*` — keeps these out of `bun test`, whose
  // matcher would otherwise collect them and fail (they use Playwright's
  // runner, not bun:test).
  testMatch: "**/*.visual.cjs",
  // One committed baseline per spec file and project, e.g.
  //   __screenshots__/counter.visual.cjs/counter-pc.png
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  expect: {
    // A small tolerance for sub-pixel noise. Tighten (maxDiffPixels) or loosen
    // per example as needed; a too-loose ratio hides small regressions.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  // Playwright boots both example servers and waits for them to be reachable.
  // In CI it requires a fresh server; locally it reuses an already-running one.
  webServer: [
    {
      command: "bun examples/counter/index.html",
      cwd: repoRoot,
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "bun examples/todomvc/index.html",
      cwd: repoRoot,
      env: { PORT: "3101" },
      url: "http://localhost:3101",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "pc", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 800 } } },
  ],
};
