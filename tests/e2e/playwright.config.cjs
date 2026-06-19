/**
 * End-to-end config for behavioural (non-visual) browser tests.
 *
 * Separate lane from `tests/visual` and from `bun test`: these drive a real
 * Chromium against the **kanabun dev server** to verify runtime behaviour that
 * the unit suite (DOM mock) and the visual gate (screenshots) can't — currently
 * CSS hot-swap. Like the visual lane, Playwright is CI-only tooling from the
 * container image, never a `package.json` dependency, so the zero-dependency
 * rule holds.
 *
 * No `webServer` here: each spec spawns the dev server itself against a
 * throwaway temp fixture (so it can mutate files on disk without touching the
 * repo). No screenshots, so no environment-pinned baselines — this can run on a
 * laptop or in any CI container with Bun + Chromium.
 */
module.exports = {
  testDir: __dirname,
  // `*.e2e.cjs`, not `*.spec.*` — keeps these out of `bun test` (whose matcher
  // would collect them and fail; they use Playwright's runner, not bun:test).
  testMatch: "**/*.e2e.cjs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Hot-swap goes through a file watcher → WebSocket round-trip, so assertions
  // poll for the effect rather than asserting once. Give them headroom on slow
  // CI runners.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  projects: [{ name: "chromium", use: {} }],
};
